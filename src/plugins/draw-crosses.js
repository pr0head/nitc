// Crossings: where the plan on screen crosses links already on the map — a
// planned link over an existing one can't be thrown. Each crossing gets a red
// cross (crosses a few pixels apart merge into one with a count). The badge in
// the draw panel counts what stands in the plan's way and opens a panel with
// what to do about it: docked by the draw tools, a bottom sheet on an upright
// phone, and with no backdrop, so the map stays in sight.
// The panel has a second tab, the link plan (draw-linkplan.js): what building
// the plan takes. It shows the links' directions on the map instead of rings.
//
// A link falls with either of its portals: an enemy one is destroyed, one's
// own is flipped by a virus (a flip drops the portal's links by itself). The
// panel offers the fewest portals that take down every blocking link, and
// among equally few the one needing fewer viruses; viruses are its price, set
// against the inventory. While the panel is open the offered portals are
// ringed on the map, brought into its free part on opening; a jump to a
// portal on an upright phone gives the bottom to the portal card and keeps
// the rings. Closing the panel clears them.
//
// A row picked in the panel is the focus: its row lights up, its ring pulses
// while the others fade, and the links that portal takes down are traced
// over the map with their crossings enlarged — what goes if it goes. A
// self-crossing in focus gets a pulsing ring of its own.
//
// Only what the map has loaded is checked, and nothing more is requested
// (portal names come only from the loaded portals): at a far zoom short links
// are left out (lod.min_link_length_m), a dense area may be cut
// (truncated.links), and a plan running off the screen is checked only where
// it is on it. The badge then carries a "?" and the panel says why — zoom in
// on the area to check it in full.
//
// Every loaded link counts, whatever the layer filters hide: a link blocks a
// plan whoever's it is. Field edges are links too (the links array may not
// carry them). A plan edge from the same portal as a link never crosses it.
//
// The plan is checked against itself too: of two plan edges that cross, only
// one can be thrown, so the plan has to change. A link standing where a plan
// edge is (that part of the plan already built) is the plan's own, not a
// blocking link: its crossings with the plan count here, and no portal is
// offered against it. Such crossings get a yellow cross and count on the
// badge along with the blocking links.
import L from 'leaflet';
import { bus } from '../state/bus.js';
import { me } from '../state/me.js';
import { FACTION } from '../config.js';
import { getInventory } from '../api/intel.js';
import { greatArc, arcsCross, geodesicPath } from '../map/geo.js';
import { backOpen, backClosed } from '../ui/back.js';
import { narrow } from '../ui/phone.js';
import { esc } from '../ui/esc.js';
import { linkPlan, planHtml, planArrows, flipLink, unpinAll } from './draw-linkplan.js';

const fmtLen = (m) => (m >= 1000 ? `${+(m / 1000).toFixed(1)} км` : `${m} м`);
const xicon = (col) => `<svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M3 3l8 8M11 3l-8 8" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/></svg>`;
const X_LINK = '#ff2d2d', X_SELF = '#e0b000';
const PLAN_RING = '#ff8c1a'; // the link plan's picked portal: seen on dark and light tiles
const SELF_ROWS = 30;
const UNFOCUS = 'нажмите ещё раз, чтобы снять выделение';
const MERGE_PX = 8;
const RING_KILL = '#ff2d2d', RING_FLIP = '#ffb86b';
// the virus that flips a portal of the agent's own faction
const VIRUS = { enl: ['ada', 'ADA Refactor'], res: ['jarvis', 'JARVIS Virus'] };
const plural = (n, one, few, many) => {
  const d = n % 10, h = n % 100;
  return n + ' ' + (d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many);
};
const nLinks = (n) => plural(n, 'линк', 'линка', 'линков');
const nPortals = (n) => plural(n, 'портал', 'портала', 'порталов');

const vkey = (v) => v.id ?? `${v.lat},${v.lng}`;
// an edge by where its ends are, either way round: a plan edge snapped onto
// portals and the link between them get the same one
const at = (p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
const spot = (a, b) => { const ka = at(a), kb = at(b); return ka < kb ? ka + '|' + kb : kb + '|' + ka; };
// existing links of a load as arcs, deduplicated by their two portals
const linksOf = new WeakMap();
function mapLinks(data) {
  let out = linksOf.get(data);
  if (out) return out;
  const seen = new Set();
  out = [];
  const add = (a, b, faction) => {
    if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return;
    const ka = vkey(a), kb = vkey(b);
    const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, spot: spot(a, b), a, b, faction, arc: greatArc([a.lat, a.lng], [b.lat, b.lng]) });
  };
  for (const l of data.links) add(l.a, l.b, l.faction);
  for (const f of data.fields) if (f.v.length === 3) { add(f.v[0], f.v[1], f.faction); add(f.v[1], f.v[2], f.faction); add(f.v[2], f.v[0], f.faction); }
  linksOf.set(data, out);
  return out;
}

// plan shapes → their edges as arcs (a shared side of nested fields once)
function planArcs(model) {
  const seen = new Set();
  const out = [];
  for (const s of model) {
    const v = s.latLngs, n = v.length;
    const edges = s.type === 'polygon' ? n : n - 1;
    for (let i = 0; i < edges; i++) {
      const a = v[i], b = v[(i + 1) % n];
      const ka = `${a.lat},${a.lng}`, kb = `${b.lat},${b.lng}`;
      if (ka === kb) continue;
      const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ spot: spot(a, b), arc: greatArc([a.lat, a.lng], [b.lat, b.lng]) });
    }
  }
  return out;
}

// ---- the fewest portals ------------------------------------------------------
// links: [{u, v}] (portal keys); cost(u): 1 when u takes a virus. → [keys]
// Every link needs one of its two portals, so the search branches on an
// uncovered link's ends; a greedy answer bounds it from the start, and a
// maximal matching of what is left (each matched link needs its own portal)
// prunes. A search budget keeps a huge case to the best found so far.
function greedyCover(links, cost) {
  let rest = links;
  const ids = [];
  let c = 0;
  while (rest.length) {
    const deg = new Map();
    for (const e of rest) { deg.set(e.u, (deg.get(e.u) || 0) + 1); deg.set(e.v, (deg.get(e.v) || 0) + 1); }
    let w = null;
    for (const [k, d] of deg) {
      if (w == null || d > deg.get(w) || (d === deg.get(w) && cost(k) < cost(w))) w = k;
    }
    ids.push(w); c += cost(w);
    rest = rest.filter((e) => e.u !== w && e.v !== w);
  }
  return { ids, n: ids.length, c };
}
function matching(links) {
  const used = new Set();
  let m = 0;
  for (const e of links) if (!used.has(e.u) && !used.has(e.v)) { used.add(e.u); used.add(e.v); m++; }
  return m;
}
function coverOf(links, cost) {
  let best = greedyCover(links, cost);
  let budget = 50000;
  const set = [];
  (function search(rest, c) {
    if (!rest.length) {
      if (set.length < best.n || (set.length === best.n && c < best.c)) best = { ids: set.slice(), n: set.length, c };
      return;
    }
    if (--budget < 0) return;
    const lb = set.length + matching(rest);
    if (lb > best.n || (lb === best.n && c >= best.c)) return;
    const { u, v } = rest[0];
    const deg = (w) => rest.reduce((s, e) => s + (e.u === w || e.v === w), 0);
    for (const w of deg(u) >= deg(v) ? [u, v] : [v, u]) {
      set.push(w);
      search(rest.filter((e) => e.u !== w && e.v !== w), c + cost(w));
      set.pop();
    }
  })(links, 0);
  return best.ids;
}

// { map, engine, ov: {pane, renderer}, btn, container, anchor, save } →
// { show, hide, update(model) }; btn is the badge, anchor the draw panel the
// crossings panel docks by, save() stores the model (a link turned by hand)
export function createCrossCheck({ map, engine, ov, btn, container, anchor, save }) {
  const layer = L.layerGroup();   // crosses
  const rings = L.layerGroup();   // offered portals, while the panel is in use
  let on = false, model = [], empty = true;
  let points = [], blocking = [], selfPts = [], why = [], offer = [];
  let ringsOn = false;
  // the picked row: {portal: key} or {self: [lat,lng]}; kept across recounts
  // while it is still there
  let focus = null;
  let inv = null, invState = 'idle'; // the agent's virus counts, fetched on demand
  // the panel's tab: 'cross' (what stands in the way) or 'plan' (the link
  // plan, draw-linkplan.js); the plan tab's picked portal is its own focus
  let tab = 'cross', lp = null, pfocus = null;
  try { if (localStorage.getItem('nitc.dx.tab') === 'plan') tab = 'plan'; } catch {}

  function compute() {
    layer.clearLayers();
    const data = engine.getData();
    const plan = planArcs(model);
    const links = mapLinks(data);
    // links standing where plan edges are: the plan's own, checked below
    const planned = new Set(plan.map((p) => p.spot));
    points = [];
    const hit = new Set();
    for (const p of plan) {
      for (const q of links) {
        if (planned.has(q.spot)) continue;
        const x = arcsCross(p.arc, q.arc);
        if (x) { points.push({ x, q }); hit.add(q); }
      }
    }
    blocking = [...hit];

    selfPts = [];
    for (let i = 0; i < plan.length; i++) {
      for (let k = i + 1; k < plan.length; k++) {
        const x = arcsCross(plan[i].arc, plan[k].arc);
        if (x) selfPts.push(x);
      }
    }

    marks(points.map((h) => h.x), X_LINK);
    marks(selfPts, X_SELF);

    why = [];
    const minLen = data.lod?.min_link_length_m || 0;
    if (minLen > 0) why.push(`линки короче ${fmtLen(minLen)} на этом масштабе не загружены`);
    if (data.truncated?.links) why.push('сервер обрезал ответ: в области слишком много линков');
    const b = map.getBounds();
    if (model.some((s) => s.latLngs.some((v) => !b.contains([v.lat, v.lng])))) why.push('план выходит за край экрана — проверена только видимая часть');
    empty = !plan.length;

    offer = makeOffer(data);
    lp = tab === 'plan' && !empty ? linkPlan(model, data) : null;
    if (pfocus && !lp?.portals.some((p) => p.key === pfocus)) pfocus = null;
    if (focus?.portal && !offer.some((o) => o.key === focus.portal)) focus = null;
    if (focus?.self && !selfPts.some((x) => x[0] === focus.self[0] && x[1] === focus.self[1])) focus = null;
    badge();
    if (ringsOn) paintRings();
    if (isOpen()) paint();
  }

  // crosses a few pixels apart (links nearly on top of each other) as one
  function marks(pts, col, cls = 'draw-x', into = layer) {
    const ms = [];
    for (const x of pts) {
      const px = map.latLngToContainerPoint(x);
      const m = ms.find((k) => k.px.distanceTo(px) < MERGE_PX);
      if (m) m.n++; else ms.push({ x, px, n: 1 });
    }
    for (const m of ms) {
      L.marker(m.x, {
        interactive: false, keyboard: false, pane: ov.pane,
        icon: L.divIcon({ className: cls, iconSize: [14, 14], html: xicon(col) + (m.n > 1 ? `<b>${m.n}</b>` : '') }),
      }).addTo(into);
    }
  }

  // the fewest portals behind the blocking links, own ones (a virus) apart
  function makeOffer(data) {
    if (!blocking.length) return [];
    const mine = me.agent?.faction;
    const portals = new Map();
    for (const l of blocking) {
      for (const v of [l.a, l.b]) {
        const k = vkey(v);
        if (!portals.has(k)) portals.set(k, { key: k, id: v.id, lat: v.lat, lng: v.lng, faction: l.faction, links: 0 });
        portals.get(k).links++;
      }
    }
    const own = (k) => (mine && portals.get(k).faction === mine ? 1 : 0);
    const ids = coverOf(blocking.map((l) => ({ u: vkey(l.a), v: vkey(l.b) })), own);
    const names = new Map(data.portals.map((p) => [p.id, p.name]));
    return ids.map((k) => ({ ...portals.get(k), name: names.get(portals.get(k).id) || '', own: !!own(k) }))
      .sort((x, y) => y.links - x.links);
  }

  function badge() {
    const n = blocking.length + selfPts.length;
    btn.classList.toggle('dx-none', empty);
    btn.classList.toggle('dx-bad', !empty && n > 0);
    btn.classList.toggle('dx-ok', !empty && n === 0);
    btn.classList.toggle('on', isOpen());
    if (empty) { btn.innerHTML = '×'; btn.title = 'Пересечения плана с линками — нарисуйте линию или треугольник'; return; }
    btn.innerHTML = (n ? (n > 99 ? '99+' : `×${n}`) : '✓') + (why.length ? '<sup>?</sup>' : '');
    btn.title = n
      ? [blocking.length && `План пересекают ${nLinks(blocking.length)}`, selfPts.length && `План пересекает сам себя: ${selfPts.length}`].filter(Boolean).join('. ')
      : 'План не пересекает загруженные линки и сам себя';
    if (why.length) btn.title += ' (проверено не всё)';
  }

  // a portal picked in the plan tab: its row opens with its links, the card
  // beside it where there is room (an upright phone keeps the sheet: the card
  // is a button in the row)
  function pickPlan(p) {
    pfocus = p.key; paintRings(); paint();
    bringIn([[p.lat, p.lng]]);
    if (p.id && !narrow.matches) bus.emit('openPortal', { portal: { id: p.id, name: p.name, lat: p.lat, lng: p.lng, faction: p.faction } });
  }

  // a link turned by hand: pinned in the model, stored, counted anew
  function flip(e) {
    flipLink(e); save();
    compute(); if (!ringsOn) paintRings();
  }

  function paintRings() {
    rings.clearLayers();
    if (tab === 'plan') {
      if (lp) planArrows(lp, map, rings, ov.pane, flip);
      const p = pfocus && lp?.portals.find((q) => q.key === pfocus);
      if (p) L.circleMarker([p.lat, p.lng], { radius: 16, color: PLAN_RING, weight: 4, fill: false, interactive: false, className: 'dx-pulse', ...ov }).addTo(rings);
      return;
    }
    const fp = focus?.portal;
    // the focused portal's links first, under its ring and enlarged crosses
    if (fp) {
      const mine = points.filter((h) => vkey(h.q.a) === fp || vkey(h.q.b) === fp);
      for (const q of new Set(mine.map((h) => h.q))) {
        L.polyline(geodesicPath([[q.a.lat, q.a.lng], [q.b.lat, q.b.lng]]), {
          color: '#fff', weight: 3, opacity: 0.9, dashArray: '7,6', interactive: false, ...ov,
        }).addTo(rings);
      }
      marks(mine.map((h) => h.x), X_LINK, 'draw-x draw-x--focus', rings);
    }
    for (const p of offer) {
      const f = p.key === fp;
      L.circleMarker([p.lat, p.lng], {
        radius: f ? 16 : 13, color: p.own ? RING_FLIP : RING_KILL, weight: f ? 4 : 3,
        opacity: focus && !f ? 0.35 : 1, fill: false, interactive: false, className: f ? 'dx-pulse' : '', ...ov,
      }).addTo(rings);
    }
    if (focus?.self) {
      L.circleMarker(focus.self, {
        radius: 16, color: X_SELF, weight: 4, fill: false, interactive: false, className: 'dx-pulse', ...ov,
      }).addTo(rings);
    }
  }

  // ---- the panel ----
  const panel = document.createElement('div');
  panel.className = 'dx-panel'; panel.hidden = true;
  panel.innerHTML = '<div class="dx-head"><div class="seg dx-tabs"><button type="button" data-tab="cross">Небо</button>' +
    '<button type="button" data-tab="plan">Земля</button></div>' +
    '<button type="button" class="dx-close" title="Закрыть">×</button></div><div class="dx-body"></div>';
  container.append(panel);
  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);
  const body = panel.querySelector('.dx-body');
  const isOpen = () => !panel.hidden;
  const tabs = panel.querySelector('.dx-tabs');
  const markTab = () => tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  markTab();
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) setTab(b.dataset.tab);
  });
  function setTab(t) {
    if (t === tab) return;
    tab = t; markTab();
    try { localStorage.setItem('nitc.dx.tab', tab); } catch {}
    focus = null; pfocus = null;
    compute(); paintRings(); body.scrollTop = 0;
  }

  // beside the draw panel; an upright phone's sheet sizes itself in CSS
  function place() {
    panel.style.left = narrow.matches ? '' : anchor.offsetLeft + anchor.offsetWidth + 8 + 'px';
    panel.style.top = narrow.matches ? '' : anchor.offsetTop + 'px';
    // down to just above the compact COMM, which shares the bottom-left
    panel.style.maxHeight = narrow.matches ? '' : `calc(100% - ${anchor.offsetTop}px - var(--comm-compact-h, 0px) - 20px)`;
    // the rest of the layout keeps clear of the sheet (as of the portal card's)
    document.documentElement.style.setProperty('--sheet-h', narrow.matches && isOpen() ? panel.offsetHeight + 'px' : '0px');
  }
  addEventListener('resize', () => { if (isOpen()) place(); });

  function open() {
    if (empty) return;
    if (narrow.matches) bus.emit('closePortal'); // one bottom sheet at a time
    compute(); // /me may have answered since the last count: own portals sorted anew
    // a virus count only matters with own portals to flip; asked once per opening
    if (offer.some((p) => p.own)) loadInv();
    panel.hidden = false; backOpen(close);
    ringsOn = true; paintRings();
    paint(); badge();
    bringIn(tab === 'plan' ? (lp?.portals || []).map((p) => [p.lat, p.lng]) : [...offer.map((p) => [p.lat, p.lng]), ...selfPts]);
  }
  // keepRings: a jump to a portal on an upright phone hands the bottom to its card
  function close(keepRings) {
    if (panel.hidden) return;
    panel.hidden = true; backClosed(close);
    place();
    if (keepRings !== true) { ringsOn = false; focus = null; pfocus = null; rings.clearLayers(); }
    badge();
  }
  panel.querySelector('.dx-close').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });

  // the map's part the panel leaves free, in container pixels
  function free() {
    const m = map.getContainer().getBoundingClientRect();
    const r = panel.getBoundingClientRect();
    const f = { l: 16, t: 70, r: m.width - 16, b: m.height - 16 };
    if (!isOpen()) return f;
    if (narrow.matches) f.b = Math.min(f.b, r.top - m.top - 12);
    else f.l = Math.max(f.l, r.right - m.left + 16);
    return f;
  }
  // points into the free part, at this zoom if they fit (a zoom-in would load
  // other links), zoomed out just enough if they don't
  function bringIn(pts) {
    if (!pts.length) return;
    const m = map.getContainer(), f = free();
    if (f.r - f.l < 40 || f.b - f.t < 40) return;
    map.fitBounds(L.latLngBounds(pts), {
      paddingTopLeft: [f.l, f.t], paddingBottomRight: [m.clientWidth - f.r, m.clientHeight - f.b], maxZoom: map.getZoom(),
    });
  }

  function paint() {
    if (tab === 'plan') {
      body.innerHTML = lp ? planHtml(lp, pfocus, UNFOCUS, { links: blocking.length, self: selfPts.length, partial: why.length > 0 }) : '';
      place();
      return;
    }
    const n = blocking.length;
    const parts = [];
    if (!n && !selfPts.length) {
      parts.push('<div class="dx-sum dx-sum-ok">План не пересекает ни загруженные линки, ни сам себя.</div>');
    }
    if (selfPts.length) {
      parts.push(`<div class="dx-h">${xicon(X_SELF)}План пересекает сам себя</div>`);
      parts.push(`<div class="dx-note">Рёбра плана пересекаются ${plural(selfPts.length, 'раз', 'раза', 'раз')}: из двух пересекающихся линков построить можно только один — план нужно изменить.</div>`);
      selfPts.slice(0, SELF_ROWS).forEach((x, i) => parts.push(
        `<div class="lm-item${focus?.self && x[0] === focus.self[0] && x[1] === focus.self[1] ? ' on' : ''}"><button type="button" class="lm-row" data-x="${i}"><span class="lm-name">${x[0].toFixed(5)}, ${x[1].toFixed(5)}</span>` +
        `<span class="lm-meta">${focus?.self && x[0] === focus.self[0] && x[1] === focus.self[1] ? UNFOCUS : 'показать на карте'}</span></button></div>`));
      if (selfPts.length > SELF_ROWS) parts.push(`<div class="dx-note">…и ещё ${selfPts.length - SELF_ROWS}</div>`);
    }
    if (n) {
      const kill = offer.filter((p) => !p.own), flip = offer.filter((p) => p.own);
      const todo = [kill.length && `снести ${nPortals(kill.length)}`, flip.length && `перекрасить ${nPortals(flip.length)}`].filter(Boolean).join(' и ');
      if (selfPts.length) parts.push('<div class="dx-h">Мешающие линки</div>');
      parts.push(`<div class="dx-sum">План пересекают ${nLinks(n)} (${factionSplit()}). Чтобы их убрать, достаточно ${todo}.</div>`);
      if (kill.length) {
        // without the agent's faction own portals can't be told apart
        parts.push(`<div class="dx-h"><i style="border-color:${RING_KILL}"></i>${me.agent ? 'Снести' : 'Снести или перекрасить'}</div>`);
        kill.forEach((p) => parts.push(row(p)));
      }
      if (flip.length) {
        parts.push(`<div class="dx-h"><i style="border-color:${RING_FLIP}"></i>Перекрасить вирусом</div>`);
        parts.push(`<div class="dx-price">${esc(price(flip.length))}</div>`);
        flip.forEach((p) => parts.push(row(p)));
      }
      if (offer.some((p) => !p.name)) parts.push('<div class="dx-note">Названия порталов на этом масштабе не загружены — нажмите на строку, чтобы открыть карточку портала.</div>');
    }
    parts.push('<div class="dx-h">Полнота проверки</div>');
    parts.push(why.length
      ? `<ul class="dx-why">${why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul><div class="dx-note">Приблизьте карту к плану, чтобы проверить точнее.</div>`
      : '<div class="dx-note">Загружены все линки области, план целиком на экране.</div>');
    body.innerHTML = parts.join('');
    place();
  }
  const factionSplit = () => {
    const cnt = {};
    for (const l of blocking) cnt[l.faction] = (cnt[l.faction] || 0) + 1;
    return Object.entries(cnt).map(([f, c]) => `<span style="color:${FACTION[f]?.color || FACTION.neu.color}">${esc(FACTION[f]?.name || f)} ${c}</span>`).join(' · ');
  };
  function row(p) {
    const title = p.name || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
    return `<div class="lm-item${p.key === focus?.portal ? ' on' : ''}"><button type="button" class="lm-row" data-k="${esc(p.key)}">` +
      `<span class="lm-name"><b class="dx-dot" style="background:${FACTION[p.faction]?.color || FACTION.neu.color}"></b>${esc(title)}</span>` +
      `<span class="lm-meta">снимает ${nLinks(p.links)}${p.key === focus?.portal ? ' · ' + UNFOCUS : ''}</span></button></div>`;
  }
  function price(need) {
    const v = VIRUS[me.agent?.faction];
    if (!v) return `Нужно вирусов: ${need}`;
    const have = invState === 'ready' ? (inv || []).filter((it) => it.kind === v[0]).reduce((s, it) => s + (Number(it.quantity) || 0), 0) : null;
    const tail = invState === 'ready' ? `в инвентаре ${have}${have < need ? ' — не хватает' : ''}`
      : invState === 'loading' ? 'инвентарь загружается…' : 'инвентарь не загрузился';
    return `Нужно ${v[1]} ×${need}, ${tail}`;
  }
  async function loadInv() {
    if (invState === 'loading') return;
    invState = 'loading';
    try { inv = (await getInventory())?.items || []; invState = 'ready'; } catch { invState = 'error'; }
    if (isOpen()) paint();
  }

  // a row: its spot into the free part of the map; a portal's card opens too
  // (on an upright phone it takes the bottom, the rings stay). The row in
  // focus, pressed again, lets go of it.
  body.addEventListener('click', (e) => {
    if (e.target.closest('.lp-go')) { setTab('cross'); return; }
    const g = e.target.closest('.lp-to[data-go-p]');
    if (g) {
      const p = lp?.portals.find((q) => q.key === g.dataset.goP);
      if (p) { pickPlan(p); body.querySelector('.lm-item.on')?.scrollIntoView({ block: 'nearest' }); }
      return;
    }
    const f = e.target.closest('.lp-flip');
    if (f) { const l = lp?.links.find((x) => x.id === f.dataset.e); if (l) flip(l); return; }
    if (e.target.closest('.lp-unpin')) { unpinAll(model); save(); compute(); return; }
    if (e.target.closest('.lp-card')) {
      const p = lp?.portals.find((q) => q.key === pfocus);
      if (!p?.id) return;
      if (narrow.matches) close(true);
      bus.emit('openPortal', { portal: { id: p.id, name: p.name, lat: p.lat, lng: p.lng, faction: p.faction } });
      return;
    }
    const r = e.target.closest('.lm-row');
    if (!r) return;
    if (r.parentElement.classList.contains('on')) { focus = null; pfocus = null; paintRings(); paint(); return; }
    if (r.dataset.p != null) {
      const p = lp?.portals.find((q) => q.key === r.dataset.p);
      if (!p) return;
      pickPlan(p);
      return;
    }
    if (r.dataset.x != null) {
      const x = selfPts[+r.dataset.x];
      if (!x) return;
      focus = { self: x }; paintRings(); paint();
      bringIn([x]);
      return;
    }
    const p = offer.find((q) => q.key === r.dataset.k);
    if (!p) return;
    focus = { portal: p.key }; paintRings(); paint();
    if (narrow.matches && p.id) close(true);
    bringIn([[p.lat, p.lng]]);
    if (p.id) bus.emit('openPortal', { portal: { id: p.id, name: p.name, lat: p.lat, lng: p.lng, faction: p.faction } });
  });
  btn.addEventListener('click', () => (isOpen() ? close() : open()));

  // a drag moves a vertex on every pointer event: recount once per frame
  let raf = 0;
  function update(m) {
    model = m;
    if (!on || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; if (on) compute(); });
  }
  bus.on('mapData', () => { if (on) compute(); });
  bus.on('modsLearned', () => { if (on) compute(); }); // the link plan's mod ways
  // arrows show on links long enough on screen: a zoom changes which
  map.on('zoomend', () => { if (on && ringsOn && tab === 'plan') paintRings(); });

  return {
    show() { on = true; layer.addTo(map); rings.addTo(map); compute(); },
    hide() {
      on = false; close();
      layer.clearLayers(); rings.clearLayers(); map.removeLayer(layer); map.removeLayer(rings);
    },
    update,
  };
}
