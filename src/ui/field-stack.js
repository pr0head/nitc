// Field stack: a tap on a field (not on a portal, no map tool open) shows how
// many layers its matryoshka has — the same answer wherever on it the tap
// lands (map/stack.js) — with its two anchors, the server's MU, and how many
// fields cover the tapped point itself when that differs. The stack is
// outlined on the map; a tap elsewhere, Back or Escape closes it.
//
// Only deep ones get a box: MIN_LAYERS in the matryoshka or over the point
// (overlapping stacks; then that count alone). A tap on a shallower field
// does nothing.
//
// An anchor's name comes from the loaded portals, or else from its card (a
// far zoom loads none); a tap on it brings the map to it and opens the card.
//
// Only what is shown counts (the layers filter). The inner fields of a stack
// hug its base, so a view zoomed in on its apex may not have loaded them:
// when the outermost field is not wholly inside the loaded area, one more
// /map request over that field fills it in ("at least N" meanwhile). Where the
// server cut the field list, the count stays "at least".
import L from 'leaflet';
import './field-stack.css';
import { getMap, getPortal } from '../api/intel.js';
import { adaptMap } from '../adapter/model.js';
import { stackAt } from '../map/stack.js';
import { geodesicPath } from '../map/geo.js';
import { fcol, fieldVisible } from '../map/render.js';
import { prefs } from '../state/prefs.js';
import { bus } from '../state/bus.js';
import { backOpen, backClosed } from './back.js';
import { esc } from './esc.js';

const PANE = 'nitcStack';
const MIN_LAYERS = 8; // shallower stacks get no box
const ANCHOR_ZOOM = 16; // a tapped anchor is shown at least this close

const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const layers = (n) => plural(n, 'слой', 'слоя', 'слоёв');
const fmtNum = (n) => n.toLocaleString('ru-RU');

// vertex bounds of a field, and whether they lie in a bbox {w,s,e,n}
const boundsOf = (fd) => L.latLngBounds(fd.v.map((p) => [p.lat, p.lng]));
const within = (b, box) => !!box &&
  b.getWest() >= box.w && b.getEast() <= box.e && b.getSouth() >= box.s && b.getNorth() <= box.n;

export function mountFieldStack(engine) {
  const { map } = engine;
  map.createPane(PANE);
  map.getPane(PANE).style.zIndex = 644; // over portals, under the COMM highlight
  map.getPane(PANE).style.pointerEvents = 'none';
  const OV = { pane: PANE, renderer: L.svg({ pane: PANE }), interactive: false };
  const hl = L.layerGroup().addTo(map);

  let popup = null;
  let ctrl = null; // the fill-in request in flight
  let tok = 0;     // the current tap: a late answer for an older one is dropped
  // anchor names: a far zoom (or a fill-in) loads no portal names, so an
  // unnamed anchor's card is asked for once (two requests at most per box)
  const known = new Map(); // portal id → name, from those cards
  const tried = new Set();
  let nameCtrl = null;
  let last = null; // what the box shows: show()'s arguments

  function close() { if (popup) map.closePopup(popup); }
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  // fields + portals of the loaded view (and of a fill-in), shown ones only
  function pool(datas) {
    const fields = new Map(), names = new Map();
    for (const d of datas) {
      for (const fd of d.fields) if (fieldVisible(fd, prefs.filters)) fields.set(fd.id ?? fields.size, fd);
      for (const p of d.portals) if (p.id && p.name) names.set(p.id, p.name);
    }
    for (const [id, name] of known) names.set(id, name);
    return { fields: [...fields.values()], names };
  }

  function draw(r) {
    hl.clearLayers();
    const mat = r.stack.length >= MIN_LAYERS; // else: the fields over the point
    const col = fcol(r.outer.faction);
    (mat ? r.stack : r.over).forEach((fd, i) => {
      L.polygon(geodesicPath(fd.v.map((p) => [p.lat, p.lng]), true), {
        color: mat ? col : fcol(fd.faction), weight: mat && !i ? 3 : 1.8, opacity: 0.95, fill: false, ...OV,
      }).addTo(hl);
    });
    if (mat) for (const p of r.base) {
      L.circleMarker([p.lat, p.lng], { radius: 12, color: col, weight: 3, opacity: 0.95, fill: false, ...OV }).addTo(hl);
    }
  }

  // r: stackAt's answer; state: 'done' | 'more' (at least, final) | 'loading'
  function content(r, names, state) {
    const n = r.stack.length;
    const atLeast = state !== 'done' ? 'не меньше ' : '';
    const dot = (fac) => `<i class="fstk__dot" style="background:${fcol(fac)}"></i>`;
    // not a deep matryoshka, but deep over this point (stacks overlapping):
    // the original count alone, by faction
    const mat = n >= MIN_LAYERS;
    const by = {};
    for (const fd of r.over) by[fd.faction] = (by[fd.faction] || 0) + 1;
    const byFac = Object.entries(by).map(([fac, c]) => `${dot(fac)}${c}`).join(' · ');
    const head = mat
      ? `Матрёшка: ${atLeast}<b>${n}</b> ${layers(n)}`
      : `Над этой точкой: <b>${r.over.length}</b> ${layers(r.over.length)}`;
    const known = (mat ? r.stack : r.over).filter((fd) => fd.mu != null);
    const mu = known.reduce((s, fd) => s + fd.mu, 0);
    const unknown = (mat ? n : r.over.length) - known.length;
    const muLine = known.length
      ? `${fmtNum(mu)} MU` + (unknown ? ` <span>+ ${unknown} без MU</span>` : '')
      : 'MU ещё не посчитан';
    const anchors = mat ? '<div class="fstk__h">Опорники</div>' + r.base.map((p, i) => (p.id
      ? `<button type="button" class="fstk__p" data-i="${i}">${esc(names.get(p.id) || 'Портал')}</button>`
      : '<div class="fstk__p">Портал</div>')).join('') : '';
    // the original count: every field over the tapped point, by faction
    const inStack = new Set(r.stack);
    const here = !mat ? `<div class="fstk__here">${byFac}</div>`
      : r.over.length !== n || r.over.some((fd) => !inStack.has(fd))
        ? `<div class="fstk__here">Над этой точкой: ${byFac}</div>` : '';
    const note = state === 'loading' ? '<div class="fstk__note">Догружаю матрёшку…</div>'
      : state === 'more' ? '<div class="fstk__note">Видна не вся: приблизьте или сдвиньте карту</div>' : '';
    return `<div class="fstk__t">${mat ? dot(r.outer.faction) : ''}<span>${head}</span></div>` +
      `<div class="fstk__mu">${muLine}</div>${here}${anchors}${note}`;
  }

  function show(r, names, state, at) {
    const box = popup?.getContent();
    if (!box || !popup.isOpen()) return;
    last = [r, names, state, at];
    box.innerHTML = content(r, names, state);
    box.onclick = (e) => {
      const p = r.base[+e.target.closest('.fstk__p')?.dataset.i];
      if (!p) return;
      close();
      map.setView([p.lat, p.lng], Math.max(map.getZoom(), ANCHOR_ZOOM));
      bus.emit('openPortal', { portal: { id: p.id, name: names.get(p.id) || '', lat: p.lat, lng: p.lng } });
    };
    draw(r);
    popup.setLatLng(at).update();
    nameAnchors(r, names);
  }

  function nameAnchors(r, names) {
    if (nameCtrl || r.stack.length < MIN_LAYERS) return;
    const miss = r.base.filter((p) => p.id && !names.has(p.id) && !tried.has(p.id));
    if (!miss.length) return;
    const c = nameCtrl = new AbortController();
    Promise.all(miss.map((p) => {
      tried.add(p.id);
      return getPortal(p.id, c.signal).then((j) => {
        if (j?.name) { known.set(p.id, j.name); names.set(p.id, j.name); }
      }, (e) => { if (e?.name === 'AbortError') tried.delete(p.id); });
    })).then(() => {
      if (nameCtrl === c) nameCtrl = null;
      if (!c.signal.aborted && popup && last) show(...last);
    });
  }

  // the box only for a deep stack: a field or two is not worth a box
  const deep = (r) => !!r && Math.max(r.stack.length, r.over.length) >= MIN_LAYERS;

  function open(at) {
    const box = L.DomUtil.create('div', 'fstk');
    L.DomEvent.disableClickPropagation(box);
    popup = L.popup({ className: 'nitc-pin-menu fstk-pop', closeButton: false, autoPanPadding: [16, 16], maxWidth: 280 })
      .setLatLng(at).setContent(box).openOn(map);
    const mine = popup;
    backOpen(close);
    document.addEventListener('keydown', onKey);
    mine.on('remove', () => {
      if (popup === mine) {
        popup = null; last = null; hl.clearLayers();
        ctrl?.abort(); ctrl = null; nameCtrl?.abort(); nameCtrl = null;
      }
      document.removeEventListener('keydown', onKey);
      backClosed(close);
    });
  }

  bus.on('mapTap', async (at) => {
    const my = ++tok;
    ctrl?.abort(); ctrl = null;
    const data = engine.getData();
    let { fields, names } = pool([data]);
    let r = stackAt(fields, at);
    if (!r) return; // no field here: the tap just closed what was open

    const whole = (res, box) => !res.truncated?.fields && within(boundsOf(r.outer), box);
    if (whole(data, data.bbox)) {
      if (deep(r)) { open(at); show(r, names, 'done', at); }
      return;
    }

    // fill in the area of the outermost field, at a zoom that fits it; a stack
    // already deep shows at once, a shallow one only if the fill-in deepens it
    const early = deep(r);
    if (early) { open(at); show(r, names, 'loading', at); }
    const b = boundsOf(r.outer).pad(0.02);
    const bbox = { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() };
    const zoom = Math.min(map.getBoundsZoom(b), map.getMaxZoom());
    ctrl = new AbortController();
    let state = 'more';
    try {
      const more = adaptMap(await getMap(bbox, zoom, ctrl.signal));
      if (my !== tok) return;
      ({ fields, names } = pool([data, more]));
      r = stackAt(fields, at);
      state = whole(more, bbox) ? 'done' : 'more';
    } catch (e) {
      if (e?.name === 'AbortError' || my !== tok) return;
    } finally {
      if (my === tok) ctrl = null;
    }
    if (!deep(r)) { close(); return; }
    if (early && !popup) return; // closed (Back, Escape) while it loaded
    if (!popup) open(at);
    show(r, names, state, at);
  });
}
