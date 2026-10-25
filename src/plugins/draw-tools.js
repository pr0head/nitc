// Draw tools: a drawing layer over the map (line / triangle), with colour,
// clone, edit (drag vertices), snap to portals, delete, clear and IITC
// DrawTools JSON import/export. Toolbar icon under favorites: click to open
// (shows the tool panel + drawings), click again to hide both (drawings kept).
//
// Clone copies a shape past one of its vertices: click a vertex and the other
// vertices stay put — how nested fields over a shared base get drawn. It then
// switches to edit, since the copy's new vertex is a placeholder to drag.
//
// Clicking the active tool's icon again switches it off and discards whatever
// was half-drawn. Free-form polygons can't be drawn, but imported ones render
// and edit — the format is unchanged.
//
// Geometry belongs to a plan: every save is announced as 'drawChanged' and the
// plans module persists it; a plan switch hands shapes back via 'drawLoad'.
//
// Format = IITC DrawTools JSON: [{type:'polyline'|'polygon', latLngs:[{lat,lng}], color?}]
import L from 'leaflet';
import './draw-tools.css';
import { bus, tools } from '../state/bus.js';
import { prefs } from '../state/prefs.js';
import { plans } from './plans.js';
import { ringArea, fmtArea } from '../map/geo.js';
import { addToolbarAction } from '../ui/toolbar.js';
import { confirmBox, promptBox, alertBox } from '../ui/dialog.js';
import { esc } from '../ui/esc.js';

const DRAW = ['line', 'triangle'];
const svg = (s, body) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const I = {
  draw: svg(18, '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>'),
  line: svg(16, '<circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><line x1="6.5" y1="17.5" x2="17.5" y2="6.5"/>'),
  tri: svg(16, '<polygon points="12,4 20,20 4,20"/>'),
  clone: svg(16, '<polygon points="9,2 16,14 2,14"/><polygon points="15,10 22,22 8,22"/>'),
  edit: svg(16, '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  // horseshoe magnet: outer + inner arc over the top, legs down, pole bands
  snap: svg(16, '<path d="M4 12v6h4v-6a4 4 0 0 1 8 0v6h4v-6a8 8 0 0 0-16 0z"/><path d="M4 16h4M16 16h4"/>'),
  del: svg(16, '<circle cx="12" cy="12" r="9"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/>'),
  copy: svg(16, '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  imp: svg(16, '<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/>'),
  clear: svg(16, '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  // a stack of sheets (the list) and a sheet with a plus (a new one)
  plans: svg(16, '<path d="M8 3h9a2 2 0 0 1 2 2v11"/><rect x="3" y="7" width="12" height="14" rx="2"/><path d="M6.5 12h5M6.5 16h3"/>'),
  newPlan: svg(16, '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 8v8M8 12h8"/>'),
};

export function mountDrawTools(container, engine) {
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

  let active = false, tool = null, color = '#ff2d2d';
  let pts = [], temp = null;
  const layer = L.layerGroup();      // finished shapes
  const editLayer = L.layerGroup();  // vertex handles (edit/clone)
  let shapeLayers = [];              // index → Leaflet layer
  let model = [];                    // filled from the active plan

  const save = () => bus.emit('drawChanged', model);
  // a plan switch (or a cleared plan) replaces the model wholesale;
  // setTool(null) drops a half-drawn shape and redraws
  bus.on('drawLoad', (arr) => { model = Array.isArray(arr) ? arr : []; setTool(null); });

  // ---- toolbar button + panel ----
  const { item, btn } = addToolbarAction(container, {
    icon: I.draw, title: 'Рисование', onClick: () => (active ? deactivate() : activate()),
  });
  const panel = document.createElement('div'); panel.className = 'draw-panel'; panel.hidden = true;
  item.append(panel);

  const toolBtns = {};
  function section() { const s = document.createElement('div'); s.className = 'draw-sec'; panel.append(s); return s; }
  function toolBtn(sec, key, icon, title, onClick) {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'draw-btn'; b.title = title; b.innerHTML = icon;
    b.addEventListener('click', onClick); sec.append(b);
    if (key) toolBtns[key] = b;
  }

  const secDraw = section();
  toolBtn(secDraw, 'line', I.line, 'Линия (2 точки) — повторный клик отменяет', () => toggleTool('line'));
  toolBtn(secDraw, 'triangle', I.tri, 'Треугольник (3 точки) — повторный клик отменяет', () => toggleTool('triangle'));
  toolBtn(secDraw, 'clone', I.clone, 'Клон: нажмите вершину, чтобы скопировать фигуру за неё, затем перетащите', () => toggleTool('clone'));
  const colorInp = document.createElement('input');
  colorInp.type = 'color'; colorInp.className = 'draw-color'; colorInp.value = color; colorInp.title = 'Цвет';
  colorInp.addEventListener('input', () => { color = colorInp.value; });
  secDraw.append(colorInp);

  const secEdit = section();
  toolBtn(secEdit, 'snap', I.snap, 'Привязать вершины к ближайшим порталам', snapAll);
  toolBtn(secEdit, 'edit', I.edit, 'Правка: перетаскивание вершин', () => toggleTool('edit'));
  toolBtn(secEdit, 'delete', I.del, 'Удаление: нажмите на фигуру', () => toggleTool('delete'));

  const secTools = section();
  toolBtn(secTools, null, I.imp, 'Импорт IITC JSON', importJson);
  toolBtn(secTools, null, I.copy, 'Экспорт (копировать IITC JSON)', copyJson);
  toolBtn(secTools, null, I.clear, 'Очистить всё', clearAll);

  const secPlans = section();
  toolBtn(secPlans, null, I.plans, 'Планы: переключить, переименовать, удалить', () => plans.open());
  toolBtn(secPlans, null, I.newPlan, 'Новый план', () => plans.createPrompt());

  // ---- activate / deactivate ----
  function activate() {
    tools.activate('draw'); // closes any other open map tool
    active = true; btn.classList.add('on'); panel.hidden = false;
    model = plans.openLast(); // the plan last worked on, if any
    layer.addTo(map); redraw();
  }
  function deactivate() {
    active = false; btn.classList.remove('on'); panel.hidden = true;
    cancelDraw(); setTool(null);
    map.removeLayer(layer); map.removeLayer(editLayer);
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
    map.getContainer().style.cursor = DRAW.includes(t) || t === 'delete' ? 'crosshair' : '';
    if (t === 'edit' || t === 'clone') { editLayer.addTo(map); renderHandles(); }
    else { editLayer.clearLayers(); map.removeLayer(editLayer); }
    redraw(); // shapes only take clicks while deleting
    // only drawing tools capture portal clicks as vertices; in edit/delete (or
    // none) a portal click still opens its card
    tools.drawMode = active && DRAW.includes(t);
  }

  // ---- drawing ----
  // One click on a portal reports twice — as portalClick (snapped to the
  // portal's exact centre) and as the map's own click a few pixels away — which
  // would push two vertices for one click. Either copy can arrive first, so
  // collapse anything landing on the same spot within the same gesture,
  // keeping whichever copy is snapped to a portal.
  const DUP_MS = 350, DUP_PX = 20;
  let lastPt = null, lastAt = 0, lastSnapped = false;
  function isDup(latlng) {
    if (!lastPt || performance.now() - lastAt > DUP_MS) return false;
    return map.latLngToLayerPoint(lastPt).distanceTo(map.latLngToLayerPoint(latlng)) < DUP_PX;
  }
  function addPoint(latlng, snapped) {
    if (!active || !DRAW.includes(tool)) return;
    if (isDup(latlng)) {
      if (!snapped || lastSnapped || !pts.length) return; // already have the better copy
      pts.pop(); // swap in the snapped one
    }
    lastPt = latlng; lastAt = performance.now(); lastSnapped = !!snapped;
    pts.push(latlng); updateTemp();
    const need = tool === 'line' ? 2 : 3;
    if (pts.length >= need) finalize();
  }
  map.on('click', (e) => addPoint(e.latlng, false));
  // clicking a portal while drawing puts the vertex exactly on it (auto-snap)
  bus.on('portalClick', (p) => { if (p) addPoint(L.latLng(p.lat, p.lng), true); });
  document.addEventListener('keydown', (e) => { if (active && e.key === 'Escape') cancelDraw(); });

  function updateTemp() {
    temp?.remove();
    temp = L.layerGroup().addTo(map);
    if (pts.length > 1) L.polyline(pts, { color, weight: 2, dashArray: '4,4', interactive: false, ...OV }).addTo(temp);
    pts.forEach((p) => L.marker(p, {
      interactive: false, keyboard: false, pane: PANE,
      icon: L.divIcon({ className: 'draw-vtx', iconSize: [12, 12] }),
    }).addTo(temp));
  }
  function cancelDraw() { pts = []; temp?.remove(); temp = null; }
  function finalize() {
    model.push({ type: tool === 'line' ? 'polyline' : 'polygon', color, latLngs: pts.map((p) => ({ lat: p.lat, lng: p.lng })) });
    cancelDraw(); save(); redraw();
  }

  // ---- render ----
  function redraw() {
    layer.clearLayers(); shapeLayers = [];
    model.forEach((s, idx) => {
      const lls = s.latLngs.map((p) => [p.lat, p.lng]);
      // only the delete tool needs shapes to catch clicks — otherwise a shape
      // in this raised pane would swallow clicks meant for the portals under
      // it, exactly the ones new vertices snap to
      const opts = { color: s.color || '#ff2d2d', weight: 2, interactive: active && tool === 'delete', ...OV };
      const el = s.type === 'polygon' ? L.polygon(lls, { fillOpacity: 0.08, ...opts }) : L.polyline(lls, opts);
      el.on('click', (ev) => {
        if (active && tool === 'delete') { L.DomEvent.stop(ev); model.splice(idx, 1); save(); redraw(); }
      });
      el.addTo(layer); shapeLayers[idx] = el;
      // area label, toggled by the layers panel's field highlight. No size
      // threshold: drawn shapes are deliberate and few.
      if (s.type === 'polygon' && lls.length >= 3 && prefs.highlight.fieldArea) {
        L.marker(el.getBounds().getCenter(), {
          interactive: false, keyboard: false, pane: PANE,
          icon: L.divIcon({
            className: 'draw-farea', iconSize: [90, 14], iconAnchor: [45, 7],
            html: `<span style="color:${esc(s.color || '#ff2d2d')}">${fmtArea(ringArea(lls))}</span>`,
          }),
        }).addTo(layer);
      }
    });
    if (active && (tool === 'edit' || tool === 'clone')) renderHandles();
  }
  bus.on('highlightChanged', redraw);

  function renderHandles() {
    editLayer.clearLayers();
    const cloning = tool === 'clone';
    model.forEach((s, si) => s.latLngs.forEach((v, vi) => {
      const h = L.marker([v.lat, v.lng], {
        draggable: !cloning, keyboard: false, pane: PANE,
        icon: L.divIcon({ className: 'draw-handle' + (cloning ? ' draw-clone' : ''), iconSize: [12, 12] }),
      });
      if (cloning) {
        h.on('click', (ev) => { L.DomEvent.stop(ev); cloneAt(si, vi); });
        h.addTo(editLayer);
        return;
      }
      h.on('drag', (ev) => {
        const p = ev.target.getLatLng();
        s.latLngs[vi] = { lat: p.lat, lng: p.lng };
        shapeLayers[si]?.setLatLngs(s.latLngs.map((q) => [q.lat, q.lng]));
      });
      // redraw, not just save: the area label is a separate marker
      h.on('dragend', () => { save(); redraw(); });
      h.addTo(editLayer);
    }));
  }

  // ---- clone ----
  // Every vertex but the clicked one is kept; that one moves outwards, away
  // from the middle of the others, by a fixed number of SCREEN pixels — far
  // enough off the original, close enough to stay in view.
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
    const np = map.layerPointToLatLng(pt.add(dir.multiplyBy(CLONE_PX)));
    const latLngs = s.latLngs.map((v) => ({ lat: v.lat, lng: v.lng }));
    latLngs[vi] = { lat: np.lat, lng: np.lng };
    model.push({ type: s.type, color: s.color || color, latLngs });
    save();
    setTool('edit'); // dragging the placeholder vertex into place is always next
  }

  // ---- ops ----
  function snapAll() {
    const ps = engine.getData().portals;
    if (!ps.length) return;
    const b = map.getBounds(); // only vertices currently on screen
    model.forEach((s) => {
      s.latLngs = s.latLngs.map((v) => {
        if (!b.contains([v.lat, v.lng])) return v;
        let best = null, bd = Infinity;
        for (const p of ps) {
          const d = (p.lat - v.lat) ** 2 + (p.lng - v.lng) ** 2;
          if (d < bd) { bd = d; best = p; }
        }
        return best ? { lat: best.lat, lng: best.lng } : v;
      });
    });
    save(); redraw();
  }
  function copyJson() {
    const txt = JSON.stringify(model);
    if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => promptBox('Скопируйте:', txt, 'OK'));
    else promptBox('Скопируйте:', txt, 'OK');
  }
  async function importJson() {
    const raw = await promptBox('Вставьте IITC DrawTools JSON:', '', 'Импорт');
    if (!raw) return;
    let arr;
    try { arr = JSON.parse(raw); } catch { alertBox('Некорректный JSON'); return; }
    if (!Array.isArray(arr)) { alertBox('Ожидается массив'); return; }
    let added = 0;
    for (const it of arr) {
      if (!it || (it.type !== 'polyline' && it.type !== 'polygon') || !Array.isArray(it.latLngs)) continue;
      if (it.latLngs.length < (it.type === 'polyline' ? 2 : 3)) continue;
      if (!it.latLngs.every((c) => c && typeof c.lat === 'number' && typeof c.lng === 'number')) continue;
      model.push({ type: it.type, latLngs: it.latLngs.map((c) => ({ lat: c.lat, lng: c.lng })), color: it.color || color });
      added++;
    }
    save(); redraw();
    if (!added) alertBox('Не найдено ни одной корректной фигуры polyline/polygon');
  }
  async function clearAll() {
    if (!model.length) return;
    // emptying a plan removes it, name and all — say so before it happens
    const p = plans.active();
    const msg = p ? `Очистить все рисунки? План «${p.name}» будет удалён из списка.` : 'Очистить все рисунки?';
    if (!(await confirmBox(msg, 'Очистить'))) return;
    model = []; save(); redraw();
  }
}
