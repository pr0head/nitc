// Matryoshka: the deepest stack of nested fields over a triangle's base. Tap
// a vertex C of a triangle ABC: the base AB stays, and the fields ABP1 ⊂ ABP2 ⊂
// … are found among the portals on screen. Two answers:
//   inside — the deepest stack that ends at C (the field drawn, filled in);
//   free   — the deepest stack on C's side of AB anywhere on screen, its
//            outermost vertex maybe not C (C's field then goes).
//
// No search over combinations: put every portal P on C's side at its two
// angles, at A (between AB and AP) and at B. Field ABQ covers P exactly when
// both of P's angles are below Q's, so a stack is a chain growing in both —
// the longest chain of a 2D order, at most a million comparisons for a
// thousand portals. The links of a stack never cross each other, so a portal
// whose two links would cross the plan is dropped beforehand. Among stacks
// as deep, the one whose outer vertex is nearest C, and from each vertex the
// nearest one in.
//
// It needs every portal on screen (zoom 15+): with the unlinked ones missing,
// a stack would only be the deepest of what is shown.
import L from 'leaflet';
import { greatArc, arcsCross, distanceM, geodesicPath } from '../map/geo.js';
import { keyOf } from './draw-snap.js';
import { esc } from '../ui/esc.js';

const rad = (d) => (d * Math.PI) / 180;
const vec = (p) => {
  const a = rad(p.lat), l = rad(p.lng);
  return [Math.cos(a) * Math.cos(l), Math.cos(a) * Math.sin(l), Math.sin(a)];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// the angle at X between the great circles X→Y and X→Z
function angle(X, Y, Z) {
  const t = (V) => { const d = dot(X, V); return [V[0] - d * X[0], V[1] - d * X[1], V[2] - d * X[2]]; };
  const u = t(Y), v = t(Z);
  return Math.atan2(Math.hypot(...cross(u, v)), dot(u, v));
}
const EPS = 1e-9;
const far = (a, b) => distanceM([a.lat, a.lng], [b.lat, b.lng]);

// A, B: the base; C: the tapped vertex; portals: what is on screen; arcs: the
// plan's edges but the tapped shape's own → { inside: [P…, C], free: [P…] },
// each from the innermost out
export function nestChains(A, B, C, portals, arcs) {
  const VA = vec(A), VB = vec(B), N = cross(VA, VB);
  const sideC = Math.sign(dot(N, vec(C)));
  const kA = keyOf(A), kB = keyOf(B), kC = keyOf(C);
  const pts = [];
  const seen = new Set([kA, kB]);
  for (const p of [C, ...portals]) {
    const k = keyOf(p);
    if (seen.has(k)) continue;
    seen.add(k);
    const V = vec(p);
    if (Math.sign(dot(N, V)) !== sideC) continue;
    const a = angle(VA, VB, V), b = angle(VB, VA, V);
    if (a < EPS || b < EPS || a + b >= Math.PI) continue;
    if (k !== kC) {
      const edges = [greatArc([A.lat, A.lng], [p.lat, p.lng]), greatArc([B.lat, B.lng], [p.lat, p.lng])];
      if (edges.some((e) => arcs.some((x) => arcsCross(e, x)))) continue;
    }
    pts.push({ p, a, b, c: k === kC });
  }
  pts.sort((x, y) => x.a - y.a);
  // depth of the stack ending at each point, and the point before it
  const n = pts.length, depth = new Array(n).fill(1), prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (!(pts[j].a < pts[i].a - EPS && pts[j].b < pts[i].b - EPS)) continue;
      const d = depth[j] + 1;
      if (d > depth[i] || (d === depth[i] && far(pts[j].p, pts[i].p) < far(pts[prev[i]].p, pts[i].p))) {
        depth[i] = d; prev[i] = j;
      }
    }
  }
  const walk = (i) => { const out = []; for (; i >= 0; i = prev[i]) out.unshift(pts[i].p); return out; };
  const ci = pts.findIndex((x) => x.c);
  let best = -1;
  for (let i = 0; i < n; i++) {
    if (best < 0 || depth[i] > depth[best] || (depth[i] === depth[best] && far(pts[i].p, C) < far(pts[best].p, C))) best = i;
  }
  return { inside: ci >= 0 ? walk(ci) : [C], free: best >= 0 ? walk(best) : [] };
}

// The tool's box: the two answers, a preview of the picked one, "Добавить".
// → { show(shape, vi, chains), close(), isOpen }
export function createNestBox({ map, pane, container, place, onApply, onCancel }) {
  const box = document.createElement('div');
  box.className = 'draw-nest'; box.hidden = true;
  container.append(box);
  L.DomEvent.disableClickPropagation(box);
  const preview = L.layerGroup();
  let cur = null; // { s, A, B, C, opts: [{chain, drop}], pick }

  function draw() {
    preview.clearLayers();
    if (!cur) { preview.remove(); return; }
    preview.addTo(map);
    const o = cur.opts[cur.pick];
    const color = '#ff8c1a';
    for (const p of o.add) {
      L.polyline(geodesicPath([[cur.A.lat, cur.A.lng], [p.lat, p.lng], [cur.B.lat, cur.B.lng]]),
        { color, weight: 2, dashArray: '5,5', interactive: false, pane }).addTo(preview);
      L.circleMarker([p.lat, p.lng], { radius: 6, color, weight: 2, fill: false, interactive: false, pane }).addTo(preview);
    }
    if (o.drop) {
      L.polyline(geodesicPath([[cur.A.lat, cur.A.lng], [cur.C.lat, cur.C.lng], [cur.B.lat, cur.B.lng]]),
        { color: '#ff3b3b', weight: 2, dashArray: '2,6', interactive: false, pane }).addTo(preview);
    }
  }

  function paint() {
    const rows = cur.opts.map((o, i) =>
      `<label class="dn-opt"><input type="radio" name="dn" value="${i}"${i === cur.pick ? ' checked' : ''}>` +
      `<span>${esc(o.title)}: <b>${o.depth} ${layers(o.depth)}</b>` +
      (o.add.length ? ` · +${o.add.length} ${fields(o.add.length)}` : ' · ничего нового') +
      (o.drop ? '<br><small>текущее поле заменится</small>' : '') + '</span></label>').join('');
    box.innerHTML = '<b class="dn-h">Матрёшка</b>' + rows +
      '<div class="dn-btns"><button type="button" class="dn-cancel">Отмена</button>' +
      `<button type="button" class="dn-ok"${cur.opts[cur.pick].add.length ? '' : ' disabled'}>Добавить</button></div>`;
  }

  box.addEventListener('change', (e) => {
    if (e.target.name !== 'dn') return;
    cur.pick = +e.target.value; paint(); draw();
  });
  box.addEventListener('click', (e) => {
    if (e.target.closest('.dn-cancel')) { close(); onCancel(); }
    else if (e.target.closest('.dn-ok')) { const c = cur, o = c.opts[c.pick]; close(); onApply(c.s, c.C, o); }
  });

  // s: the tapped shape; A, B: its base; C: the tapped vertex; chains:
  // nestChains; exists(p): the plan has field ABp already
  function show(s, A, B, C, { inside, free }, exists) {
    const isC = (p) => keyOf(p) === keyOf(C);
    const opts = [{ title: 'Внутри поля', chain: inside, depth: inside.length, add: inside.filter((p) => !exists(p)), drop: false }];
    if (free.length > inside.length) {
      const keep = free.some(isC);
      opts.push({ title: keep ? 'Дальше за вершиной' : 'С другой вершиной', chain: free, depth: free.length, add: free.filter((p) => !isC(p) && !exists(p)), drop: !keep });
    }
    cur = { s, A, B, C, opts, pick: opts.length > 1 && !opts[0].add.length ? 1 : 0 };
    box.hidden = false; paint(); place(box); draw();
  }
  function close() { cur = null; box.hidden = true; draw(); }
  return { show, close, get isOpen() { return !!cur; } };
}

const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const layers = (n) => plural(n, 'слой', 'слоя', 'слоёв');
const fields = (n) => plural(n, 'поле', 'поля', 'полей');
