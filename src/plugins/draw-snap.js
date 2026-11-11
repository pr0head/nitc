// Auto-snap for the draw tools: a vertex always stands on a portal. A tap
// anywhere takes the nearest portal shown on screen (layer filters apply; at a
// far zoom the link/field ends are the portals there are), skipping the
// portals the shape already uses. Nothing to snap to → a reason to show.
//
// That holds while the map knows every portal on screen. Zoomed out, the
// server sends only the linked ones (the grey portals are left out), so a
// vertex can't be told where it belongs: there it snaps only to a dot within
// reach, and is otherwise left free, where it was put. A free vertex snaps to
// the nearest portal close by once the map has the portals in full (zoom in).
//
// Clone takes the free portal nearest (in metres, whatever the zoom) to the
// clicked vertex such that the copy covers that vertex — a nested field over
// the same base — none of its new edges crosses the plan, and the copy is not
// a shape the plan already has.
import { portalVisible, cornerVisible, ll } from '../map/render.js';
import { greatArc, arcsCross, distanceM } from '../map/geo.js';

export const NO_PORTALS = 'Нет порталов для привязки — приблизьте карту или сместитесь туда, где они есть';
export const NO_FREE = 'Свободных порталов на экране нет';
export const NO_CLONE = 'Нет свободного портала за этой вершиной без пересечений с планом';
export const CLONE_HAVE = 'Следующее поле за этой вершиной уже есть в плане';
export const LOOSE = 'Вершина не привязана — приблизьте карту, она встанет на портал';
const AUTO_PX = 30; // a free vertex this close to a portal takes it on zoom-in

export const keyOf = (p) => (+p.lat).toFixed(7) + ',' + (+p.lng).toFixed(7);

// plan edges as arcs, for the crossing test
export function planArcs(model) {
  const out = [];
  for (const s of model) {
    const v = s.latLngs, n = s.type === 'polygon' ? v.length : v.length - 1;
    for (let i = 0; i < n; i++) {
      const a = v[i], b = v[(i + 1) % v.length];
      out.push(greatArc([a.lat, a.lng], [b.lat, b.lng]));
    }
  }
  return out;
}

// p strictly inside the spherical triangle t ({lat,lng} each)
const vec = (p) => {
  const a = (p.lat * Math.PI) / 180, l = (p.lng * Math.PI) / 180;
  return [Math.cos(a) * Math.cos(l), Math.cos(a) * Math.sin(l), Math.sin(a)];
};
const triple = (a, b, c) => a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
function inTriangle(t, p) {
  const [A, B, C] = t.map(vec), P = vec(p);
  const s1 = triple(A, B, P), s2 = triple(B, C, P), s3 = triple(C, A, P), eps = 1e-15;
  return (s1 > eps && s2 > eps && s3 > eps) || (s1 < -eps && s2 < -eps && s3 < -eps);
}
// a shape's vertex set, order aside (a copy equal to a shape already there)
const setOf = (vs) => vs.map(keyOf).sort().join('|');

export function createSnap({ map, engine }) {
  // the portals shown on screen right now, with their screen points
  function targets() {
    const d = engine.getData(), f = engine.prefs.filters, b = map.getBounds(), out = [];
    const add = (p) => { if (b.contains([p.lat, p.lng])) out.push({ p, pt: map.latLngToContainerPoint([p.lat, p.lng]) }); };
    for (const p of d.portals) if (ll(p) && portalVisible(p, f)) add(p);
    for (const p of d.corners || []) if (ll(p) && cornerVisible(p, f)) add(p);
    return out;
  }

  // the map has every portal on screen: no LOD omission, no truncation
  function full() {
    const d = engine.getData();
    return !d.portalsOmitted && d.lod?.has_portals !== false && !d.truncated?.portals;
  }

  // → { p } the nearest free portal to latlng, or { err }
  function nearest(latlng, taken = new Set()) {
    const ts = targets();
    if (!ts.length) return { err: NO_PORTALS };
    const c = map.latLngToContainerPoint(latlng);
    let best = null, bd = Infinity;
    for (const t of ts) {
      if (taken.has(keyOf(t.p))) continue;
      const d = c.distanceTo(t.pt);
      if (d < bd) { bd = d; best = t.p; }
    }
    return best ? { p: best } : { err: NO_FREE };
  }

  // where a vertex put at latlng goes: { p } a portal, { free: true } stay
  // as put (portals not all known), or { err }. reach: px around latlng a dot
  // counts as aimed at while the portals are not all known.
  function place(latlng, taken, reach) {
    if (full()) return nearest(latlng, taken);
    const r = nearest(latlng, taken);
    if (r.p && map.latLngToContainerPoint(latlng).distanceTo(map.latLngToContainerPoint([r.p.lat, r.p.lng])) <= reach) return r;
    return { free: true };
  }

  // a free vertex v (not one of `taken`), now that the portals may be known:
  // → the portal close by to take, or null
  function settle(v, taken) {
    if (!full() || !map.getBounds().contains([v.lat, v.lng])) return null;
    const r = nearest(v, taken);
    if (!r.p) return null;
    const d = map.latLngToContainerPoint([v.lat, v.lng]).distanceTo(map.latLngToContainerPoint([r.p.lat, r.p.lng]));
    return d <= AUTO_PX ? r.p : null;
  }

  // shape s cloned past vertex vi: → { p } the new vertex, or { err }.
  // With the portals not all known, a portal that fits is taken only if it
  // is a dot within reach of `toward` (the screen point out past the vertex):
  // an unlinked portal nearer may be missing. Otherwise { free: true } — the
  // copy's vertex stays at `toward`, to be settled on zoom-in.
  function cloneTarget(model, s, vi, toward, reach) {
    const all = full();
    const ts = targets();
    if (!ts.length) return all ? { err: NO_PORTALS } : { free: true };
    const apex = s.latLngs[vi];
    const kept = s.latLngs.filter((_, i) => i !== vi);
    const taken = new Set(s.latLngs.map(keyOf));
    const arcs = planArcs(model);
    const have = new Set(model.map((x) => setOf(x.latLngs)));
    let dup = false; // a copy that fits is a shape the plan already has
    const fits = ({ p }) => {
      // a triangle: the copy covers the clicked vertex; a line: any end will do
      if (kept.length === 2 && !inTriangle([kept[0], kept[1], p], apex)) return false;
      const edges = kept.map((v) => greatArc([v.lat, v.lng], [p.lat, p.lng]));
      if (edges.some((e) => arcs.some((a) => arcsCross(e, a)))) return false;
      if (have.has(setOf([...kept, p]))) { dup = true; return false; }
      return true;
    };
    const best = ts.filter((t) => !taken.has(keyOf(t.p)))
      .map((t) => ({ ...t, d: distanceM([apex.lat, apex.lng], [t.p.lat, t.p.lng]) }))
      .sort((x, y) => x.d - y.d)
      .find(fits);
    if (all) return best ? { p: best.p } : { err: dup ? CLONE_HAVE : NO_CLONE };
    return best && best.pt.distanceTo(toward) <= reach ? { p: best.p } : { free: true };
  }

  return { targets, nearest, place, settle, cloneTarget, full };
}
