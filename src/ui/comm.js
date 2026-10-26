// COMM: the activity log of the visible area, docked bottom-left.
// Chat order: oldest at the top, newest at the bottom.
//   compact  — filter + the 3 latest events, fixed height
//   expanded — from the card's top edge down to the bottom, a scrolling list;
//              scrolling up loads older pages (until the server has no more),
//              new events arrive at the bottom
// The box never resizes with its content: a new area clears the list and
// shows the state line in the same space.
//
// Paging, per the API contract:
//   first page (no cursor) → up to 50 newest, newest→oldest
//   cursor=next            → older pages, until next is empty
//   after                  → newer events, oldest→newest; keep the returned
//                            after and read again at once while more=true
//   bbox change            → drop items and pointers, start over
// A field's MU can arrive later: while a loaded field event still has mu=null
// the first page is re-read on poll and merged by id (pointers untouched).
//
// Hovering an event draws it from the event's own coordinates — not from map
// data — so it shows at any zoom, under any filter, and even when the link or
// field no longer exists (dashed: "where it was").
import L from 'leaflet';
import './comm.css';
import { MAP, FACTION } from '../config.js';
import { getActivity } from '../api/intel.js';
import { adaptEvent } from '../adapter/model.js';
import { fcol } from '../map/render.js';
import { prefs } from '../state/prefs.js';
import { bus } from '../state/bus.js';
import { coarsePointer } from './toolbar.js';
import { esc } from './esc.js';

const COMPACT_ROWS = 3;
const OPEN_ZOOM = MAP.minPortalZoom; // a clicked portal opens where portals are visible
const GROUP = {
  capture: 'capture', neutralize: 'capture',
  link_create: 'link', link_destroy: 'link', first_link: 'link',
  field_create: 'field', field_destroy: 'field',
};
// neutral noun forms: a nickname tells nothing about the agent's gender
const KIND_LABEL = {
  capture: 'захват', neutralize: 'нейтрализация',
  link_create: 'линк', link_destroy: 'снос линка', first_link: 'первый линк',
  field_create: 'поле', field_destroy: 'снос поля',
};
const KIND_OPTS = [['all', 'Все события'], ['capture', 'Захваты'], ['link', 'Линки'], ['field', 'Поля']];
const EXPAND = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
const COLLAPSE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

const pad = (n) => String(n).padStart(2, '0');
function fmtTime(ms) {
  const d = new Date(ms), now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === now.toDateString() ? hm : `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${hm}`;
}
const okLL = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng);

export function mountComm(container, engine) {
  const map = engine.map;
  const st = prefs.comm;

  const el = document.createElement('div');
  el.className = 'comm';
  el.innerHTML =
    '<div class="comm-head">' +
      '<span class="comm-title">COMM</span>' +
      '<select class="comm-kind" title="Тип событий">' +
        KIND_OPTS.map(([v, t]) => `<option value="${v}"${st.kind === v ? ' selected' : ''}>${t}</option>`).join('') +
      '</select>' +
      `<button type="button" class="comm-fac" data-f="res" title="${FACTION.res.name}"><span style="background:${FACTION.res.color}"></span></button>` +
      `<button type="button" class="comm-fac" data-f="enl" title="${FACTION.enl.name}"><span style="background:${FACTION.enl.color}"></span></button>` +
      '<button type="button" class="comm-toggle"></button>' +
    '</div>' +
    '<div class="comm-list"></div>';
  container.append(el);
  L.DomEvent.disableClickPropagation(el);
  L.DomEvent.disableScrollPropagation(el);
  const listEl = el.querySelector('.comm-list');
  const toggleBtn = el.querySelector('.comm-toggle');

  // The compact height for the layout: the portal card keeps clear of it (and
  // lies over an expanded feed); on phones the bottom-right controls sit above it.
  new ResizeObserver(() => {
    if (!st.open) document.documentElement.style.setProperty('--comm-compact-h', el.offsetHeight + 'px');
  }).observe(el);

  // ---- feed state ----
  let items = [];          // newest first
  const byId = new Map();  // id → event (dedupe, late MU)
  let next = '', after = '';
  let bbox = null, bboxKey = '';
  let gen = 0, ctrl = null;
  let loading = false, loadingOlder = false, polling = false;
  let err = '';

  const bboxNow = () => {
    const b = map.getBounds();
    return { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() };
  };
  const keyOf = (b) => [b.w, b.s, b.e, b.n].map((v) => v.toFixed(6)).join(',');

  function add(raw) {
    for (const r of raw || []) {
      const ev = adaptEvent(r);
      const had = byId.get(ev.id);
      if (had) { if (ev.mu != null) had.mu = ev.mu; continue; }
      byId.set(ev.id, ev);
      items.push(ev);
    }
    items.sort((a, b) => b.time - a.time || (b.id > a.id ? 1 : -1));
  }

  function fail(e, my) {
    if (e?.name === 'AbortError' || my !== gen) return;
    if (e?.code === 'unauthorized') { location.reload(); return; }
    err = e?.code === 'rate_limited'
      ? `лимит запросов${e.retryAfter ? ` · ${e.retryAfter}с` : ''}`
      : `ошибка: ${e?.code || 'request_failed'}`;
  }

  async function first() {
    const my = ++gen;
    ctrl?.abort(); ctrl = new AbortController();
    bbox = bboxNow(); bboxKey = keyOf(bbox);
    items = []; byId.clear(); next = ''; after = ''; err = '';
    loading = true; loadingOlder = false; paint();
    try {
      const r = await getActivity(bbox, {}, ctrl.signal);
      if (my !== gen) return;
      add(r.items); next = r.next || ''; after = r.after || '';
    } catch (e) { fail(e, my); } finally {
      if (my === gen) { loading = false; paint(); }
    }
  }

  async function older() {
    if (!next || loading || loadingOlder) return;
    const my = gen;
    loadingOlder = true; paint('older');
    try {
      const r = await getActivity(bbox, { cursor: next }, ctrl.signal);
      if (my !== gen) return;
      add(r.items); next = r.next || ''; err = '';
    } catch (e) { fail(e, my); } finally {
      if (my === gen) { loadingOlder = false; paint('older'); }
    }
  }

  async function poll() {
    if (polling || loading || !bbox) return;
    // an area that was empty from the start has after="" — just retry page one
    if (!after) { if (!items.length) await first(); return; }
    polling = true;
    const my = gen;
    try {
      let more = true;
      for (let i = 0; more && i < 5; i++) { // a burst >50: read on at once (bounded)
        const r = await getActivity(bbox, { after }, ctrl.signal);
        if (my !== gen) return;
        add(r.items);
        if (r.after) after = r.after;
        more = !!r.more;
      }
      if (items.some((ev) => GROUP[ev.kind] === 'field' && ev.mu == null)) {
        const r = await getActivity(bbox, {}, ctrl.signal); // late MU; `after` stays put
        if (my !== gen) return;
        add(r.items);
      }
      err = '';
    } catch (e) { fail(e, my); } finally {
      polling = false;
      if (my === gen) paint();
    }
  }

  // ---- area tracking: new bbox → new feed (debounced like the map) ----
  // A jump started from the feed itself (clicking a portal name) keeps the
  // feed, so the list you were reading doesn't vanish under you.
  let keepUntil = 0, deb = null;
  map.on('moveend', () => {
    clearTimeout(deb);
    deb = setTimeout(() => {
      if (Date.now() < keepUntil) { keepUntil = 0; return; }
      if (keyOf(bboxNow()) !== bboxKey) first();
    }, MAP.moveDebounceMs);
  });
  setInterval(() => { if (!document.hidden) poll(); }, MAP.refreshMs);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  // ---- render ----
  const visible = () => items.filter((ev) => {
    if (st.kind !== 'all' && GROUP[ev.kind] !== st.kind) return false;
    if (ev.faction === 'res' && !st.res) return false;
    if (ev.faction === 'enl' && !st.enl) return false;
    return true;
  });

  function portalLink(ev, i) {
    const p = ev.portals[i];
    if (!p) return '<span class="comm-dim">?</span>';
    const name = esc(p.name || 'портал');
    if (!okLL(p)) return name;
    const href = `#p=${encodeURIComponent(p.id)},${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
    return `<a class="comm-p" href="${esc(href)}" data-i="${i}">${name}</a>`;
  }
  function mu(ev, sign) {
    return `<span class="comm-mu">${sign}${ev.mu == null ? '?' : ev.mu.toLocaleString('ru-RU')} MU</span>`;
  }
  const MU_SIGN = { field_create: '+', field_destroy: '−' };
  // a link names both ends (source → target); a field names its first portal
  // in the row (all three are in the tooltip) and carries its MU
  function message(ev) {
    const g = GROUP[ev.kind];
    let s = `${esc(KIND_LABEL[ev.kind] || ev.kind)} ${portalLink(ev, 0)}`;
    if (g === 'link') s += ` → ${portalLink(ev, 1)}`;
    if (MU_SIGN[ev.kind]) s += ` ${mu(ev, MU_SIGN[ev.kind])}`;
    return s;
  }
  // the row's full text for its tooltip (a row is one line and may be cut)
  function plain(ev) {
    const g = GROUP[ev.kind];
    const names = ev.portals.map((p) => p.name || 'портал').join(g === 'field' ? ', ' : ' → ');
    const m = MU_SIGN[ev.kind] ? ` ${MU_SIGN[ev.kind]}${ev.mu == null ? '?' : ev.mu} MU` : '';
    return `${fmtTime(ev.time)} ${ev.nick}: ${KIND_LABEL[ev.kind] || ev.kind} ${names}${m}`;
  }

  const note = (html, cls = '') => `<div class="comm-note ${cls}">${html}</div>`;

  // State line: alone in an empty list, or above the rows (expanded: older
  // pages; any mode: an error that kept the old rows).
  function stateLine(hasRows) {
    if (loading) return note('загрузка…');
    if (err) return note(esc(err), 'comm-err');
    if (!hasRows) return note(items.length ? 'нет событий под фильтр' : 'событий в этой области нет');
    if (!st.open) return '';
    if (loadingOlder) return note('загрузка старых…');
    if (next) return note('<button type="button" class="comm-more">загрузить ещё</button>');
    return note('больше событий нет');
  }

  // anchor: 'end' — jump to the newest; 'older' — rows were added above, keep
  // the view where it was; default — stay at the bottom if already there,
  // otherwise keep the scroll position.
  function paint(anchor) {
    el.classList.toggle('comm--open', st.open);
    toggleBtn.innerHTML = st.open ? COLLAPSE : EXPAND;
    toggleBtn.title = st.open ? 'Свернуть' : 'Развернуть';
    el.querySelectorAll('.comm-fac').forEach((b) => b.classList.toggle('off', !st[b.dataset.f]));

    const { scrollTop, scrollHeight, clientHeight } = listEl;
    const atEnd = scrollHeight - scrollTop - clientHeight < 30;

    let rows = visible(); // newest first
    const line = stateLine(rows.length > 0);
    if (!st.open) rows = rows.slice(0, line ? COMPACT_ROWS - 1 : COMPACT_ROWS);
    listEl.innerHTML = line + rows.reverse().map((ev) =>
      `<div class="comm-row" data-id="${esc(ev.id)}" title="${esc(plain(ev))}">` +
      `<span class="comm-time">${fmtTime(ev.time)}</span>` +
      `<span class="comm-nick" style="color:${fcol(ev.faction)}">${esc(ev.nick)}</span>` +
      `<span class="comm-msg">${message(ev)}</span></div>`).join('');

    if (anchor === 'end' || atEnd) listEl.scrollTop = listEl.scrollHeight;
    else if (anchor === 'older') listEl.scrollTop = listEl.scrollHeight - (scrollHeight - scrollTop);
    else listEl.scrollTop = scrollTop;
  }

  // ---- controls ----
  el.querySelector('.comm-kind').addEventListener('change', (e) => {
    st.kind = e.target.value; prefs.save(); paint('end');
  });
  el.querySelectorAll('.comm-fac').forEach((b) => b.addEventListener('click', () => {
    st[b.dataset.f] = !st[b.dataset.f]; prefs.save(); paint('end');
  }));
  toggleBtn.addEventListener('click', () => {
    st.open = !st.open; prefs.save(); paint('end');
  });
  // expanded: reaching the top loads the next older page
  listEl.addEventListener('scroll', () => {
    if (st.open && listEl.scrollTop < 80) older();
  });

  // portal name → centre on it (zoomed in enough to show portals) + its card
  listEl.addEventListener('click', (e) => {
    if (e.target.closest('.comm-more')) { older(); return; }
    const a = e.target.closest('.comm-p');
    if (a) {
      e.preventDefault();
      const ev = byId.get(a.closest('.comm-row').dataset.id);
      const p = ev?.portals[+a.dataset.i];
      if (!p || !okLL(p)) return;
      keepUntil = Date.now() + 2000;
      map.setView([p.lat, p.lng], Math.max(map.getZoom(), OPEN_ZOOM));
      bus.emit('openPortal', { portal: { id: p.id, name: p.name, lat: p.lat, lng: p.lng } });
      return;
    }
    // touch has no hover: a tap on the row toggles its map highlight
    if (coarsePointer) {
      const row = e.target.closest('.comm-row');
      if (row) toggleShow(byId.get(row.dataset.id));
    }
  });

  // ---- event highlight on the map ----
  map.createPane('nitcComm');
  map.getPane('nitcComm').style.zIndex = 645;
  map.getPane('nitcComm').style.pointerEvents = 'none';
  const OV = { pane: 'nitcComm', renderer: L.svg({ pane: 'nitcComm' }), interactive: false };
  const hl = L.layerGroup().addTo(map);
  let shown = null;

  function show(ev) {
    hl.clearLayers(); shown = ev || null;
    if (!ev) return;
    const col = fcol(ev.faction);
    const pts = ev.portals.filter(okLL).map((p) => [p.lat, p.lng]);
    const g = GROUP[ev.kind];
    if (g === 'link' && pts.length >= 2) {
      L.polyline(pts.slice(0, 2), { color: col, weight: 3, opacity: 0.95, dashArray: '6,5', ...OV }).addTo(hl);
    } else if (g === 'field' && pts.length >= 3) {
      L.polygon(pts.slice(0, 3), { color: col, weight: 2, dashArray: '6,5', fillColor: col, fillOpacity: 0.15, ...OV }).addTo(hl);
    }
    for (const p of pts) {
      L.circleMarker(p, { radius: 12, color: col, weight: 3, opacity: 0.95, fill: false, ...OV }).addTo(hl);
    }
  }
  const toggleShow = (ev) => show(shown && ev && shown.id === ev.id ? null : ev);

  if (!coarsePointer) {
    listEl.addEventListener('mouseover', (e) => {
      const row = e.target.closest('.comm-row');
      if (row && row.dataset.id !== shown?.id) show(byId.get(row.dataset.id));
    });
    listEl.addEventListener('mouseleave', () => show(null));
  }

  paint();
  first();
}
