// Draw tools: a drawing layer over the map (line / triangle), with colour,
// clone, edit (drag vertices), delete, clear and IITC
// DrawTools JSON import/export. Switched on and off from the plate menu (the
// state is remembered): on shows the tool panel, docked left as in IITC, and
// the drawings; off hides both (drawings kept).
//
// Every vertex stands on a portal (draw-snap.js): a tap anywhere puts it on
// the nearest portal shown on screen that the shape doesn't use yet, and a
// dragged vertex lands on the nearest one too. Zoomed out, where the map
// lacks the unlinked portals, a vertex put away from any dot stays free
// (a hollow ring) and takes a portal once zoomed in. A tap on a placed vertex takes
// it back. With a mouse, the portal the next vertex would take is ringed and
// the shape-to-be is traced to it; a hint strip by the panel says what the
// tool expects next and why a tap did nothing.
//
// Clone copies a shape past one of its vertices: click a vertex and the other
// vertices stay put — how nested fields over a shared base get drawn. The
// copy's new vertex takes the free portal nearest to that vertex whose copy
// covers it, crosses nothing of the plan and is not a shape already there.
//
// Matryoshka: tap a triangle's vertex and the deepest stack of fields nested
// over the other two is worked out among the portals on screen — inside the
// field, or with another outer vertex (draw-nest.js); a box offers both.
//
// Edit shows one handle per portal, with a count where several shapes stand
// on it. A drag moves one vertex (the latest shape's); with Ctrl (Cmd) held,
// or after a long press on a touch screen, it moves them all — a hub goes to
// another portal with all its fields in one drag.
//
// Clicking the active tool's icon again switches it off and discards whatever
// was half-drawn. Free-form polygons can't be drawn, but imported ones render
// and edit — the format is unchanged.
//
// Geometry belongs to a plan: every save is announced as 'drawChanged' and the
// plans module persists it; a plan switch hands shapes back via 'drawLoad'.
// Export copies the plan on screen; import files what it reads as a new plan.
//
// While the line or triangle tool is on, ★ picks vertices from the favorites
// (draw-favorites.js) — for portals too far apart to tap on one screen.
//
// Shapes are drawn along great circles, like the links they plan (the stored
// vertices are unchanged).
//
// The ruler labels every edge of the plan with its length (draw-lengths.js).
//
// Where the plan crosses links already on the map, a red cross marks the spot;
// a badge atop the panel counts what stands in the plan's way and opens a
// panel with the fewest portals to take it down (draw-crosses.js).
//
// Format = IITC DrawTools JSON: [{type:'polyline'|'polygon', latLngs:[{lat,lng}], color?, nitc?}]
// (nitc: link directions pinned in the link plan, draw-linkplan.js)
import L from 'leaflet';
import './draw-tools.css';
import { bus, tools } from '../state/bus.js';
import { prefs } from '../state/prefs.js';
import { plans } from './plans.js';
import { ringArea, fmtArea, geodesicPath } from '../map/geo.js';
import { labelPx, screenArea } from '../map/label.js';
import { confirmBox, promptBox, alertBox } from '../ui/dialog.js';
import { esc } from '../ui/esc.js';
import { backOpen, backClosed } from '../ui/back.js';
import { STAR } from '../ui/icons.js';
import { createFavPicker } from './draw-favorites.js';
import { createCrossCheck } from './draw-crosses.js';
import { cleanNitc } from './draw-linkplan.js';
import { createLengths } from './draw-lengths.js';
import { createSnap, keyOf, LOOSE, planArcs } from './draw-snap.js';
import { nestChains, createNestBox } from './draw-nest.js';

// a vertex handle's grab area around its dot: a finger needs far more room
// than a mouse
const touch = matchMedia('(pointer: coarse)');
const handleSize = () => (touch.matches ? 44 : 20);
const HOLD_MS = 450; // a press this long on a shared handle grabs every vertex on it

const DRAW = ['line', 'triangle'];
const DEF_COLOR = '#a24ac3'; // as IITC DrawTools: shapes without a colour of their own get it too
const svg = (s, body) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const I = {
  draw: svg(16, '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>'),
  line: svg(16, '<circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><line x1="6.5" y1="17.5" x2="17.5" y2="6.5"/>'),
  tri: svg(16, '<polygon points="12,4 20,20 4,20"/>'),
  clone: svg(16, '<polygon points="9,2 16,14 2,14"/><polygon points="15,10 22,22 8,22"/>'),
  nest: svg(16, '<polygon points="12,3 22,21 2,21"/><polygon points="12,9 17.5,19 6.5,19"/><polygon points="12,14.5 14.2,19 9.8,19"/>'),
  edit: svg(16, '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  // a ruler laid aslant, its ticks along the top edge
  ruler: svg(16, '<path d="M3 15.5L15.5 3 21 8.5 8.5 21z"/><path d="M7.5 11l2 2M10.5 8l2 2M13.5 5l2 2"/>'),
  del: svg(16, '<circle cx="12" cy="12" r="9"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/>'),
  copy: svg(16, '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  imp: svg(16, '<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/>'),
  clear: svg(16, '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  done: svg(16, '<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  // a stack of sheets (the list) and a sheet with a plus (a new one)
  plans: svg(16, '<path d="M8 3h9a2 2 0 0 1 2 2v11"/><rect x="3" y="7" width="12" height="14" rx="2"/><path d="M6.5 12h5M6.5 16h3"/>'),
  newPlan: svg(16, '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 8v8M8 12h8"/>'),
};

export function mountDrawTools(container, engine, menu) {
  const map = engine.map;
  // Own pane above the portals, so shapes and vertex handles stay on top after
  // portals re-render, with its own renderer so map re-renders never restack
  // the drawings under the field fills. The pane itself ignores the pointer:
  // only interactive shapes/handles take clicks, the rest reach the portals.
  const PANE = 'nitcDraw';
  map.createPane(PANE);
  map.getPane(PANE).style.zIndex = 640;
  map.getPane(PANE).style.pointerEvents = 'none';
  const OV = { pane: PANE, renderer: L.svg({ pane: PANE }) };

  let active = false, tool = null, color = DEF_COLOR;
  let pts = [], temp = null;
  let ptIds = [];                    // per vertex: the favorite it was picked from, or null
  const layer = L.layerGroup();      // finished shapes
  const editLayer = L.layerGroup();  // vertex handles (edit/clone)
  let shapeLayers = [];              // index → Leaflet layer
  let model = [];                    // filled from the active plan
  const loose = new Set();           // free vertices (keys) put this session, waiting for the portals
  let nestBox = null;                // the matryoshka's box (set up below)

  const save = () => bus.emit('drawChanged', model);
  // a plan switch (or a cleared plan) replaces the model wholesale;
  // setTool(null) drops a half-drawn shape and redraws
  bus.on('drawLoad', (arr) => { model = Array.isArray(arr) ? arr : []; setTool(null); });

  // ---- menu item + panel ----
  menu.add({
    icon: I.draw, label: 'Рисование', isOn: () => active,
    onClick: () => (active ? deactivate() : activate()),
  });
  const panel = document.createElement('div'); panel.className = 'draw-panel'; panel.hidden = true;
  container.append(panel);
  L.DomEvent.disableClickPropagation(panel);

  // the hint strip, right of the panel's top: the tool's next step, or for a
  // moment why the last tap did nothing
  const hintEl = document.createElement('div'); hintEl.className = 'draw-hint'; hintEl.hidden = true;
  container.append(hintEl);
  let flashT = 0;
  const HINTS = {
    clone: ['Клон', 'Нажмите вершину — копия фигуры встанет на ближайший свободный портал за ней'],
    nest: ['Матрёшка', 'Нажмите вершину треугольника — над двумя другими встанут вложенные поля по порталам на экране'],
    delete: ['Удаление', 'Нажмите на фигуру, чтобы удалить её'],
  };
  function hint() {
    clearTimeout(flashT); hintEl.classList.remove('err');
    let title, text;
    if (DRAW.includes(tool)) {
      const need = tool === 'line' ? 2 : 3;
      title = `${tool === 'line' ? 'Линия' : 'Треугольник'} · вершина ${pts.length + 1} из ${need}`;
      text = 'Нажмите на карту — точка встанет на ближайший портал' +
        (pts.length ? '. Повторное нажатие на вершину убирает её' : '');
    } else if (tool === 'edit') {
      title = 'Правка';
      text = 'Перетащите вершину — она встанет на ближайший портал. ' + (touch.matches
        ? 'Удержание, затем перетаскивание — все фигуры на этом портале'
        : `С ${/Mac|iP/.test(navigator.platform) ? 'Cmd' : 'Ctrl'} — все фигуры на этом портале`);
    } else if (HINTS[tool]) [title, text] = HINTS[tool];
    hintEl.hidden = !active || !title;
    if (hintEl.hidden) return;
    hintEl.innerHTML = `<b>${esc(title)}</b><span>${esc(text)}</span>`;
    placeHint();
  }
  function flash(msg, err = true) {
    hint();
    hintEl.hidden = false; hintEl.classList.toggle('err', err);
    hintEl.innerHTML = `<span>${esc(msg)}</span>`;
    placeHint();
    flashT = setTimeout(hint, 3500);
  }
  const placeHint = () => { hintEl.style.left = panel.offsetLeft + panel.offsetWidth + 8 + 'px'; };

  const toolBtns = {};
  function section() { const s = document.createElement('div'); s.className = 'draw-sec'; panel.append(s); return s; }
  function toolBtn(sec, key, icon, title, onClick) {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'draw-btn'; b.title = title; b.innerHTML = icon;
    b.addEventListener('click', onClick); sec.append(b);
    if (key) toolBtns[key] = b;
  }

  // crossings with existing links, on top: a low screen scrolls the panel
  const secCross = section();
  toolBtn(secCross, null, '', '', () => {});
  const crossBtn = secCross.lastChild; crossBtn.classList.add('draw-xbtn');
  const crosses = createCrossCheck({ map, engine, ov: OV, btn: crossBtn, container, anchor: panel, save: () => save() });

  const secDraw = section();
  toolBtn(secDraw, 'line', I.line, 'Линия (2 точки) — повторный клик отменяет', () => toggleTool('line'));
  toolBtn(secDraw, 'triangle', I.tri, 'Треугольник (3 точки) — повторный клик отменяет', () => toggleTool('triangle'));
  toolBtn(secDraw, null, STAR(16), 'Вершины из избранного', () => picker.open());
  const favBtn = secDraw.lastChild; favBtn.hidden = true; // only with line/triangle on
  toolBtn(secDraw, 'clone', I.clone, 'Клон: нажмите вершину — копия встанет на ближайший свободный портал за ней', () => toggleTool('clone'));
  toolBtn(secDraw, 'nest', I.nest, 'Матрёшка: нажмите вершину треугольника — самая глубокая стопка вложенных полей на экране', () => toggleTool('nest'));
  const colorInp = document.createElement('input');
  colorInp.type = 'color'; colorInp.className = 'draw-color'; colorInp.value = color; colorInp.title = 'Цвет';
  colorInp.addEventListener('input', () => { color = colorInp.value; });
  secDraw.append(colorInp);

  const secEdit = section();
  // the ruler is a view switch, not a tool: it stays lit whatever the tool
  const lengths = createLengths({ map, pane: PANE, defColor: DEF_COLOR });
  toolBtn(secEdit, null, I.ruler, 'Длины линков', () => rulerBtn.classList.toggle('on', lengths.toggle()));
  const rulerBtn = secEdit.lastChild; rulerBtn.classList.toggle('on', lengths.on);
  toolBtn(secEdit, 'edit', I.edit, 'Правка: перетаскивание вершин', () => toggleTool('edit'));
  toolBtn(secEdit, 'delete', I.del, 'Удаление: нажмите на фигуру', () => toggleTool('delete'));

  const secTools = section();
  toolBtn(secTools, null, I.imp, 'Импорт IITC JSON — новым планом', importJson);
  toolBtn(secTools, null, I.copy, 'Экспорт текущего плана (копировать IITC JSON)', copyJson);
  const copyBtn = secTools.lastChild;
  toolBtn(secTools, null, I.clear, 'Очистить всё', clearAll);

  const secPlans = section();
  toolBtn(secPlans, null, I.plans, 'Планы: переключить, переименовать, удалить', () => plans.open());
  toolBtn(secPlans, null, I.newPlan, 'Новый план', () => plans.createPrompt());

  // ---- activate / deactivate ----
  function activate() {
    tools.activate('draw'); // closes any other open map tool
    active = true; panel.hidden = false; prefs.set({ draw: true });
    backOpen(deactivate); // Back leaves the drawing mode
    model = plans.openLast(); // the plan last worked on, if any
    layer.addTo(map); crosses.show(); lengths.show(); redraw();
  }
  function deactivate() {
    active = false; panel.hidden = true; prefs.set({ draw: false });
    backClosed(deactivate);
    cancelDraw(); setTool(null);
    map.removeLayer(layer); map.removeLayer(editLayer); crosses.hide(); lengths.hide();
    tools.drawMode = false;
    tools.release('draw');
  }
  bus.on('toolActivated', (n) => { if (n !== 'draw' && active) deactivate(); });
  // pressing the lit-up tool again turns it off (and drops an unfinished shape)
  function toggleTool(t) { setTool(tool === t ? null : t); }
  function setTool(t) {
    cancelDraw();
    tool = t;
    Object.values(toolBtns).forEach((b) => b.classList.remove('on'));
    if (t && toolBtns[t]) toolBtns[t].classList.add('on');
    favBtn.hidden = !DRAW.includes(t);
    clearPreview(); hint(); nestBox?.close();
    map.getContainer().style.cursor = DRAW.includes(t) || t === 'delete' ? 'crosshair' : '';
    if (t === 'edit' || t === 'clone' || t === 'nest') { editLayer.addTo(map); renderHandles(); }
    else { editLayer.clearLayers(); map.removeLayer(editLayer); }
    redraw(); // shapes only take clicks while deleting
    // only drawing tools capture portal clicks as vertices; in edit/delete (or
    // none) a portal click still opens its card
    tools.drawMode = active && DRAW.includes(t);
  }

  // ---- drawing ----
  // One click on a portal reports twice — as portalClick (at the portal's
  // centre) and as the map's own click a few pixels away. Either copy can
  // arrive first; both snap to the same portal, so the second is dropped —
  // or it would take back the vertex the first one just put.
  const DUP_MS = 350, DUP_PX = 20;
  let lastPt = null, lastAt = 0;
  function isDup(latlng) {
    if (!lastPt || performance.now() - lastAt > DUP_MS) return false;
    return map.latLngToLayerPoint(lastPt).distanceTo(map.latLngToLayerPoint(latlng)) < DUP_PX;
  }
  const snap = createSnap({ map, engine });
  const taken = () => new Set(pts.map(keyOf));
  // with the portals in full, a free vertex close to one takes it
  function settleLoose() {
    if (!active || !loose.size) return;
    // vertex i of vs takes a portal close by, if it is free and there is one
    const settle = (vs, i) => {
      const k = keyOf(vs[i]);
      if (!loose.has(k)) return false;
      const p = snap.settle(vs[i], new Set(vs.filter((_, j) => j !== i).map(keyOf)));
      if (!p) return false;
      loose.delete(k);
      vs[i] = vs === pts ? L.latLng(p.lat, p.lng) : { lat: p.lat, lng: p.lng };
      return true;
    };
    let shapes = false, half = false;
    for (const sh of model) sh.latLngs.forEach((_, i) => { if (settle(sh.latLngs, i)) shapes = true; });
    pts.forEach((_, i) => { if (settle(pts, i)) half = true; });
    if (half) updateTemp();
    if (shapes) { save(); redraw(); }
  }
  bus.on('mapData', settleLoose);
  // the placed vertex under a screen point (as big a target as a handle), or -1
  function vertexAt(latlng) {
    const c = map.latLngToContainerPoint(latlng);
    let hit = -1, bd = handleSize() / 2;
    pts.forEach((p, i) => { const d = map.latLngToContainerPoint(p).distanceTo(c); if (d <= bd) { bd = d; hit = i; } });
    return hit;
  }
  function onTap(latlng) {
    if (!active || !DRAW.includes(tool)) return;
    if (isDup(latlng)) return; // the other copy of a tap already handled
    lastPt = latlng; lastAt = performance.now();
    const hit = vertexAt(latlng);
    if (hit >= 0) { // a tap on a vertex takes it back
      pts.splice(hit, 1); ptIds.splice(hit, 1);
      if (pts.length) updateTemp(); else cancelDraw();
      hint(); return;
    }
    const r = snap.place(latlng, taken(), handleSize() / 2);
    if (r.err) { flash(r.err); return; }
    const v = r.p ? L.latLng(r.p.lat, r.p.lng) : latlng;
    if (r.free) loose.add(keyOf(v));
    pts.push(v); ptIds.push(null);
    if (pts.length >= (tool === 'line' ? 2 : 3)) finalize(); else updateTemp(true);
    if (r.free) flash(LOOSE, false); else hint();
  }
  map.on('click', (e) => onTap(e.latlng));
  bus.on('portalClick', (p) => { if (p) onTap(L.latLng(p.lat, p.lng)); });

  // ---- preview (a mouse only: a finger is not over the map between taps) ----
  // the portal the next vertex would take gets a ring, and the shape-to-be is
  // traced to it; over a placed vertex, that vertex is ringed red instead
  const preview = L.layerGroup();
  let pvFrame = 0, pvAt = null;
  function clearPreview() { preview.clearLayers(); preview.remove(); }
  function drawPreview() {
    pvFrame = 0;
    preview.clearLayers();
    if (!active || !DRAW.includes(tool) || !pvAt) { preview.remove(); return; }
    preview.addTo(map);
    const hit = vertexAt(pvAt);
    if (hit >= 0) {
      L.circleMarker(pts[hit], { radius: 11, color: '#ff2d2d', weight: 2, fill: false, interactive: false, ...OV }).addTo(preview);
      return;
    }
    // zoomed out with no dot in reach the vertex would stay free: traced to
    // the cursor itself, with a dashed ring
    const r = snap.place(pvAt, taken(), handleSize() / 2);
    if (r.err) return;
    const c = r.p ? [r.p.lat, r.p.lng] : [pvAt.lat, pvAt.lng];
    L.circleMarker(c, { radius: r.p ? 11 : 7, color, weight: 2, dashArray: r.p ? null : '3,3', fill: false, interactive: false, ...OV }).addTo(preview);
    const ends = pts.length === 2 && tool === 'triangle' ? [pts[0], pts[1]] : pts.slice(-1);
    for (const e of ends) {
      L.polyline(geodesicPath([[e.lat, e.lng], c]), { color, weight: 2, opacity: 0.7, dashArray: '4,6', interactive: false, ...OV }).addTo(preview);
    }
  }
  if (!touch.matches) {
    map.on('mousemove', (e) => { pvAt = e.latlng; if (!pvFrame) pvFrame = requestAnimationFrame(drawPreview); });
    map.on('mouseout movestart', () => { pvAt = null; preview.clearLayers(); });
  }

  // Escape in the picker closes the picker only
  document.addEventListener('keydown', (e) => { if (active && e.key === 'Escape' && !picker.isOpen) { cancelDraw(); nestBox?.close(); hint(); } });

  // ---- vertices from the favorites ----
  const picker = createFavPicker({
    state: () => ({ name: tool === 'line' ? 'Линия' : 'Треугольник', need: tool === 'line' ? 2 : 3, ids: ptIds }),
    // → true when the pick completed the shape
    onPick(f) {
      if (!active || !DRAW.includes(tool)) return true;
      if (taken().has(keyOf(f))) return false; // the shape stands on it already
      pts.push(L.latLng(f.lat, f.lng)); ptIds.push(f.id);
      lastPt = null; // never merged with a map tap
      if (pts.length < (tool === 'line' ? 2 : 3)) { updateTemp(true); hint(); return false; }
      const b = L.latLngBounds(pts);
      finalize(); hint();
      fit(b);
      return true;
    },
    onUndo() { pts.pop(); ptIds.pop(); if (pts.length) updateTemp(); else cancelDraw(); hint(); },
    // back on the map with a shape half-drawn: bring its vertices into view
    onClose() {
      if (!pts.length) return;
      const b = map.getBounds();
      if (pts.every((p) => b.contains(p))) return;
      fit(L.latLngBounds(pts).extend(b.getCenter()));
    },
  });
  // the whole shape in view, clear of the panel on the left and the plate on top
  const fit = (b) => map.fitBounds(b, {
    paddingTopLeft: [panel.offsetLeft + panel.offsetWidth + 24, 90], paddingBottomRight: [40, 40], maxZoom: 17,
  });

  // added: the last vertex was just put — it pulses once, to show where it landed
  function updateTemp(added = false) {
    temp?.remove();
    temp = L.layerGroup().addTo(map);
    if (pts.length > 1) {
      L.polyline(geodesicPath(pts.map((p) => [p.lat, p.lng])), { color, weight: 2, dashArray: '4,4', interactive: false, ...OV }).addTo(temp);
    }
    pts.forEach((p, i) => L.marker(p, {
      interactive: false, keyboard: false, pane: PANE,
      icon: L.divIcon({
        className: 'draw-vtx' + (added && i === pts.length - 1 ? ' draw-vtx-new' : '') + (loose.has(keyOf(p)) ? ' draw-vtx-loose' : ''),
        iconSize: [12, 12],
      }),
    }).addTo(temp));
  }
  function cancelDraw() { pts = []; ptIds = []; temp?.remove(); temp = null; }
  function finalize() {
    model.push({ type: tool === 'line' ? 'polyline' : 'polygon', color, latLngs: pts.map((p) => ({ lat: p.lat, lng: p.lng })) });
    cancelDraw(); save(); redraw();
  }

  // ---- render ----
  // area labels sized like the field overlay's, by the shape's on-screen area
  let areaLabels = []; // [{ marker, lls }]
  function sizeLabels() {
    for (const { marker, lls } of areaLabels) {
      const el = marker.getElement();
      if (el) el.style.fontSize = labelPx(screenArea(lls.map((ll) => map.latLngToLayerPoint(ll)))) + 'px';
    }
  }
  map.on('zoomend', sizeLabels);

  function redraw() {
    layer.clearLayers(); shapeLayers = []; areaLabels = [];
    model.forEach((s, idx) => {
      const lls = s.latLngs.map((p) => [p.lat, p.lng]);
      // only the delete tool needs shapes to catch clicks — otherwise a shape
      // in this raised pane would swallow clicks meant for the portals under
      // it, exactly the ones new vertices snap to
      const opts = { color: s.color || DEF_COLOR, weight: 2, interactive: active && tool === 'delete', ...OV };
      const geo = geodesicPath(lls, s.type === 'polygon');
      const el = s.type === 'polygon' ? L.polygon(geo, { fillOpacity: 0.08, ...opts }) : L.polyline(geo, opts);
      const del = (ev) => {
        if (active && tool === 'delete') { L.DomEvent.stop(ev); model.splice(idx, 1); save(); redraw(); }
      };
      el.on('click', del);
      el.addTo(layer); shapeLayers[idx] = el;
      for (const v of s.latLngs) {
        if (!loose.has(keyOf(v))) continue;
        L.marker([v.lat, v.lng], {
          interactive: false, keyboard: false, pane: PANE,
          icon: L.divIcon({ className: 'draw-vtx draw-vtx-loose', iconSize: [14, 14] }),
        }).addTo(layer);
      }
      // a 2 px line is hard to hit, unlike a triangle's fill: while deleting,
      // an invisible wide stroke over it takes the tap, as wide as a handle
      if (active && tool === 'delete' && s.type === 'polyline') {
        L.polyline(geo, { ...OV, weight: handleSize(), opacity: 0, interactive: true }).on('click', del).addTo(layer);
      }
      // area label, toggled by the layers panel's field highlight. No size
      // threshold: drawn shapes are deliberate and few.
      if (s.type === 'polygon' && lls.length >= 3 && prefs.highlight.fieldArea) {
        const marker = L.marker(el.getBounds().getCenter(), {
          interactive: false, keyboard: false, pane: PANE,
          icon: L.divIcon({
            className: 'map-lbl', iconSize: null,
            html: `<span style="color:${esc(s.color || DEF_COLOR)}">${fmtArea(ringArea(lls))}</span>`,
          }),
        }).addTo(layer);
        areaLabels.push({ marker, lls });
      }
    });
    sizeLabels(); lengths.update(model);
    if (active && (tool === 'edit' || tool === 'clone' || tool === 'nest')) renderHandles();
    crosses.update(model);
  }
  bus.on('highlightChanged', redraw);

  function renderHandles() {
    editLayer.clearLayers();
    const hs = handleSize();
    if (tool === 'clone' || tool === 'nest') {
      model.forEach((s, si) => {
        if (tool === 'nest' && (s.type !== 'polygon' || s.latLngs.length !== 3)) return; // triangles only
        s.latLngs.forEach((v, vi) => {
          L.marker([v.lat, v.lng], {
            keyboard: false, pane: PANE,
            icon: L.divIcon({ className: 'draw-handle draw-clone', iconSize: [hs, hs] }),
          }).on('click', (ev) => { L.DomEvent.stop(ev); (tool === 'clone' ? cloneAt : nestAt)(si, vi); }).addTo(editLayer);
        });
      });
      return;
    }
    // one handle per point, over the vertices of every shape standing there
    const groups = new Map();
    model.forEach((s, si) => s.latLngs.forEach((v, vi) => {
      const k = keyOf(v);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ s, si, vi });
    }));
    for (const g of groups.values()) {
      const v0 = g[0].s.latLngs[g[0].vi];
      const h = L.marker([v0.lat, v0.lng], {
        draggable: true, keyboard: false, pane: PANE,
        icon: L.divIcon({ className: 'draw-handle', iconSize: [hs, hs], html: g.length > 1 ? `<b>${g.length}</b>` : '' }),
      });
      // what the drag moves: the whole group (Ctrl/Cmd — Leaflet keeps Shift
      // for its box zoom and won't drag with it — or a long press),
      // else the latest shape's vertex alone — the one on top before
      let moved = g.slice(-1), hold = 0;
      const arm = () => { moved = g; h.getElement()?.classList.add('draw-group'); navigator.vibrate?.(30); };
      h.on('add', () => {
        const el = h.getElement();
        el.addEventListener('contextmenu', (e) => e.preventDefault()); // no menu on a long press
        el.addEventListener('pointerdown', (e) => {
          moved = g.slice(-1); el.classList.remove('draw-group'); clearTimeout(hold);
          if (g.length < 2) return;
          if (e.pointerType === 'mouse') { if (e.ctrlKey || e.metaKey) arm(); }
          else hold = setTimeout(arm, HOLD_MS);
        });
        const off = () => clearTimeout(hold);
        el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
      });
      const set = (p) => { for (const { s, vi } of moved) s.latLngs[vi] = { lat: p.lat, lng: p.lng }; };
      h.on('dragstart', () => clearTimeout(hold)); // moved before the press was long: one vertex
      h.on('drag', (ev) => {
        set(ev.target.getLatLng());
        for (const { s, si } of moved) shapeLayers[si]?.setLatLngs(geodesicPath(s.latLngs.map((q) => [q.lat, q.lng]), s.type === 'polygon'));
        crosses.update(model);
      });
      // the drop lands on the nearest portal none of the moved shapes uses
      // otherwise (zoomed out: on a dot within reach, or stays free); with
      // none on screen the vertices go back where they were
      const from = { lat: v0.lat, lng: v0.lng };
      h.on('dragend', (ev) => {
        const at = ev.target.getLatLng();
        const taken = new Set();
        for (const { s, vi } of moved) s.latLngs.forEach((q, i) => { if (i !== vi) taken.add(keyOf(q)); });
        const r = snap.place(at, taken, hs / 2);
        loose.delete(keyOf(from));
        if (r.err) { set(from); flash(r.err); }
        else if (r.free) { set(at); loose.add(keyOf(at)); flash(LOOSE, false); }
        else set(r.p);
        save(); redraw(); // redraw, not just save: the area label is a separate marker
      });
      h.addTo(editLayer);
    }
  }

  // ---- clone ----
  // Every vertex but the clicked one is kept; that one moves to the nearest
  // portal that nests the copy over it (draw-snap.js). `toward`, a fixed number
  // of SCREEN pixels out from the middle of the others, is where it stays free
  // while the portals are not all known.
  const CLONE_PX = 60;
  function cloneAt(si, vi) {
    const s = model[si];
    if (!s || s.latLngs.length < 2) return;
    const pt = map.latLngToLayerPoint([s.latLngs[vi].lat, s.latLngs[vi].lng]);
    let sx = 0, sy = 0, n = 0;
    s.latLngs.forEach((v, i) => {
      if (i === vi) return;
      const q = map.latLngToLayerPoint([v.lat, v.lng]);
      sx += q.x; sy += q.y; n++;
    });
    let dir = pt.subtract(L.point(sx / n, sy / n));
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
    // a vertex on the middle of the others gives no direction; straight up will do
    dir = len < 1 ? L.point(0, -1) : L.point(dir.x / len, dir.y / len);
    const toward = map.layerPointToContainerPoint(pt.add(dir.multiplyBy(CLONE_PX)));
    const r = snap.cloneTarget(model, s, vi, toward, handleSize() / 2);
    if (r.err) { flash(r.err); return; }
    const latLngs = s.latLngs.map((v) => ({ lat: v.lat, lng: v.lng }));
    const np = r.p || map.containerPointToLatLng(toward);
    latLngs[vi] = { lat: np.lat, lng: np.lng };
    if (r.free) { loose.add(keyOf(np)); flash(LOOSE, false); }
    model.push({ type: s.type, color: s.color || color, latLngs });
    save(); redraw(); // clone stays on: the next nesting is one more tap
  }

  // ---- matryoshka ----
  // the two other vertices are the base; the stacks come from draw-nest.js
  // and a box in the hint's place offers them, previewed on the map
  nestBox = createNestBox({
    map, pane: PANE, container,
    place: (box) => {
      hintEl.hidden = true; clearTimeout(flashT);
      box.style.left = panel.offsetLeft + panel.offsetWidth + 8 + 'px';
      box.style.top = getComputedStyle(hintEl).top;
    },
    onCancel: () => hint(),
    onApply(s, C, o) {
      const vi = s.latLngs.findIndex((v) => keyOf(v) === keyOf(C));
      for (const p of o.add) {
        model.push({ type: 'polygon', color: s.color || color, latLngs: s.latLngs.map((v, i) => (i === vi ? { lat: p.lat, lng: p.lng } : { lat: v.lat, lng: v.lng })) });
      }
      if (o.drop) model.splice(model.indexOf(s), 1);
      save(); redraw();
      flash(`Добавлено полей: ${o.add.length}`, false);
    },
  });
  const triKey = (vs) => vs.map(keyOf).sort().join('|');
  function nestAt(si, vi) {
    const s = model[si];
    if (!s) return;
    if (!snap.full()) { flash('Приблизьте карту: для матрёшки нужны все порталы на экране (зум 15 и ближе)'); return; }
    const [A, B] = s.latLngs.filter((_, i) => i !== vi), C = s.latLngs[vi];
    const arcs = planArcs(model.filter((x) => x !== s));
    const chains = nestChains(A, B, C, snap.targets().map((t) => t.p), arcs);
    const have = new Set(model.filter((x) => x.type === 'polygon' && x.latLngs.length === 3).map((x) => triKey(x.latLngs)));
    const exists = (p) => have.has(triKey([A, B, p]));
    if (chains.inside.length < 2 && chains.free.length <= chains.inside.length) {
      flash('Вложить нечего: на экране нет порталов для полей над этим основанием'); return;
    }
    nestBox.show(s, A, B, C, chains, exists);
  }

  // ---- ops ----
  // a copy leaves nothing to see, so the button flashes a tick once it's done
  let copiedT = 0;
  function copied() {
    clearTimeout(copiedT);
    copyBtn.classList.add('done'); copyBtn.innerHTML = I.done;
    copiedT = setTimeout(() => { copyBtn.classList.remove('done'); copyBtn.innerHTML = I.copy; }, 1200);
  }
  function copyJson() {
    const txt = JSON.stringify(model);
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(copied, () => promptBox('Скопируйте:', txt, 'OK'));
    else promptBox('Скопируйте:', txt, 'OK');
  }
  async function importJson() {
    const raw = await promptBox('Вставьте IITC DrawTools JSON:', '', 'Импорт');
    if (!raw) return;
    let arr;
    try { arr = JSON.parse(raw); } catch { alertBox('Некорректный JSON'); return; }
    if (!Array.isArray(arr)) { alertBox('Ожидается массив'); return; }
    const shapes = [];
    for (const it of arr) {
      if (!it || (it.type !== 'polyline' && it.type !== 'polygon') || !Array.isArray(it.latLngs)) continue;
      if (it.latLngs.length < (it.type === 'polyline' ? 2 : 3)) continue;
      if (!it.latLngs.every((c) => c && typeof c.lat === 'number' && typeof c.lng === 'number')) continue;
      const sh = { type: it.type, latLngs: it.latLngs.map((c) => ({ lat: c.lat, lng: c.lng })), color: it.color || color };
      const nitc = cleanNitc(it); // link directions pinned in the link plan
      if (nitc) sh.nitc = nitc;
      shapes.push(sh);
    }
    if (!shapes.length) { alertBox('Не найдено ни одной корректной фигуры polyline/polygon'); return; }
    plans.adopt(shapes); // its own plan, not mixed into the one on screen
  }
  async function clearAll() {
    if (!model.length) return;
    // emptying a plan removes it, name and all — say so before it happens
    const p = plans.active();
    const msg = p ? `Очистить все рисунки? План «${p.name}» будет удалён из списка.` : 'Очистить все рисунки?';
    if (!(await confirmBox(msg, 'Очистить'))) return;
    model = []; save(); redraw();
  }

  if (prefs.draw) activate(); // it was on when the page was left
}
