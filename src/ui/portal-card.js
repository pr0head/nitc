// Portal card: click a portal → GET /portals/{id} → a card docked top-right:
// photo, a stats grid, the 4 mod slots and the 8 resonators as a compass rose.
//
// Link counts and link range come from the card's server `planning` block.
// Fields are not in the card — they are counted from the loaded map data
// (engine.getData()), so they cover what the current viewport loaded.
//
// History (on demand): the COMM log of a tiny area around the portal, keeping
// the events anchored at it — newest first, older pages one tap each, as deep
// as the server keeps. A link thrown onto this portal from another is that
// portal's event and doesn't show here.
//
// Selection on the map: the portal's own outline turns red (engine), plus the
// 40 m action circle and, for a fully deployed portal, its max link range
// (a circle on the sphere: for hundreds of km a projected circle is off).
import L from 'leaflet';
import './portal-card.css';
import { GAME } from '../config.js';
import { fcol, ll } from '../map/render.js';
import { geodesicCircle } from '../map/geo.js';
import { getPortal, getActivity } from '../api/intel.js';
import { adaptPortalDetail, adaptEvent } from '../adapter/model.js';
import * as G from '../game/portal.js';
import { favorites } from '../state/favorites.js';
import { bus, tools } from '../state/bus.js';
import { coarsePointer } from './toolbar.js';
import { esc } from './esc.js';
import { STAR } from './icons.js';
import { agentLink } from './agent-card.js';
import { GROUP, KIND_LABEL, MU_SIGN, fmtTime } from './events.js';
import { errText } from './errors.js';
import { keys } from '../state/keys.js';
import { backOpen, backClosed } from './back.js';
import { narrow } from './phone.js';

const SEL_COL = '#ff2d2d';
// short slot labels; the label colour is the rarity
const MOD_SHORT = {
  shield: 'SH', aegis: 'AX', link_amp: 'LA', softbank: 'SB',
  heat_sink: 'HS', multi_hack: 'MH', turret: 'TU', force_amp: 'FA',
};
const RARITY = {
  common: { name: 'Common', color: '#3fca4a' },
  rare: { name: 'Rare', color: '#2aa9ff' },
  very_rare: { name: 'Very Rare', color: '#ff5db1' },
};
// What one mod does, straight from its server spec. Fractions (heat,
// stickiness, hit_bonus) read as %, multipliers as ×, counts as +N.
const pct = (v) => Math.round(v * 100) + '%';
const MOD_STATS = [
  ['mitigation', (v) => `защита +${v}%`],
  ['stickiness', (v) => `закрепление ${pct(v)}`],
  ['link_defense', (v) => `защита линков ×${v}`],
  ['range_multiplier', (v) => `дальность линка ×${v}`],
  ['outgoing', (v) => `исходящие линки +${v}`],
  ['heat', (v) => `кулдаун хака −${pct(v)}`],
  ['hacks', (v) => `+${v} хаков до перегрева`],
  ['force', (v) => `урон ×${v}`],
  ['strike', (v) => `частота атак ×${v}`],
  ['hit_bonus', (v) => `бонус попадания +${pct(v)}`],
];
const modStats = (spec) =>
  MOD_STATS.filter(([k]) => +spec[k]).map(([k, f]) => f(+spec[k])).join(' · ') || 'без характеристик';

// Resonator slots: 0 = north, clockwise in 45° steps. Rose cells, row-major:
// NW N NE / W · E / SW S SE (null = the centre).
const SLOT_DIR = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
const ROSE = [7, 0, 1, 6, null, 2, 5, 4, 3];
// beyond this many pixels the range circle is far off-screen and only costs
// rasterising, so it isn't drawn
const MAX_RANGE_PX = 6000;
const COPY = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const CARET_DOWN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

const fmtK = (n) => (n >= 10000 ? Math.round(n / 1000) + 'k'
  : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n)));
const fmtDist = (m) => (m >= 1000 ? (m / 1000).toFixed(m >= 100000 ? 0 : 1) + ' км' : Math.round(m) + ' м');
const levelOf = (p) => (p.faction === 'neu' ? 0 : p.level); // unclaimed reads L0

export function mountPortalCard(engine) {
  const map = engine.map;

  const panel = document.createElement('div');
  panel.className = 'pd'; panel.hidden = true;
  panel.innerHTML =
    '<div class="pd-head"><div class="pd-title"></div>' +
    `<button type="button" class="pd-fav" title="В избранное">${STAR(17)}</button>` +
    `<button type="button" class="pd-groups-btn" title="Группы избранного">${CARET_DOWN}</button>` +
    '<button type="button" class="pd-close" title="Закрыть">×</button>' +
    '<div class="pd-groups" hidden></div></div>' +
    '<div class="pd-body"></div>';
  document.body.append(panel);
  const titleEl = panel.querySelector('.pd-title');
  const bodyEl = panel.querySelector('.pd-body');
  const favBtn = panel.querySelector('.pd-fav');
  const groupsBtn = panel.querySelector('.pd-groups-btn');
  const groupsEl = panel.querySelector('.pd-groups');

  // ---- title: long names ellipsise, so mirror the text into a tooltip ----
  function setTitle(level, name, color) {
    titleEl.textContent = (level == null ? '' : `L${level} · `) + (name || 'Портал');
    titleEl.style.color = color || '';
    if (coarsePointer) titleEl.title = titleEl.textContent; // no hover on touch
  }
  if (!coarsePointer) {
    titleEl.addEventListener('mouseover', () => {
      const r = titleEl.getBoundingClientRect();
      if (titleEl.scrollWidth > titleEl.clientWidth) showTip(r, titleEl.textContent, true);
    });
    titleEl.addEventListener('mouseout', hideTip);
  }

  // ---- instant tooltip (the native `title` lags and lingers) ----
  const tipEl = document.createElement('div');
  tipEl.className = 'pd-tip'; tipEl.hidden = true;
  document.body.append(tipEl);
  // takes an already-measured rect; CSS centres the box, nothing is measured here
  function showTip(r, text, wrap) {
    if (!text) { hideTip(); return; }
    tipEl.textContent = text;
    tipEl.classList.toggle('pd-tip-wrap', !!wrap);
    tipEl.style.left = Math.min(Math.max(r.left + r.width / 2, 115), innerWidth - 115) + 'px';
    tipEl.style.top = (r.top - 6) + 'px';
    tipEl.hidden = false;
  }
  function hideTip() { tipEl.hidden = true; }

  // ---- favorite toggle: reflects/flips the flag of the open portal ----
  let cur = null; // { id, name, lat, lng } of the open portal
  function paintFav() {
    favBtn.hidden = groupsBtn.hidden = !cur;
    const on = !!(cur && favorites.has(cur.id));
    favBtn.classList.toggle('on', on);
    favBtn.title = on ? 'Убрать из избранного' : 'В избранное';
    if (!groupsEl.hidden) paintGroups();
  }
  favBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (cur) favorites.toggle(cur);
  });
  bus.on('favoritesChanged', paintFav);

  // ---- group picker (▾): tick groups; ticking one stars the portal ----
  function paintGroups() {
    const f = cur && favorites.get(cur.id);
    const gs = favorites.groups();
    groupsEl.innerHTML = (gs.length ? gs.map((g) =>
      `<label class="pd-gi"><input type="checkbox" data-g="${g.id}"${f && f.groups.includes(g.id) ? ' checked' : ''}>` +
      `<span class="nm">${esc(g.name)}</span></label>`).join('')
      : '<div class="pd-gempty">Групп пока нет</div>') +
      '<input type="text" class="pd-gnew" placeholder="+ новая группа (Enter)" maxlength="60">';
  }
  function setGroupsOpen(open) {
    groupsEl.hidden = !open;
    groupsBtn.classList.toggle('on', open);
    if (open) paintGroups();
  }
  groupsBtn.addEventListener('click', (e) => { e.stopPropagation(); setGroupsOpen(groupsEl.hidden); });
  groupsEl.addEventListener('change', (e) => {
    const box = e.target.closest('input[type="checkbox"]');
    if (box && cur) favorites.setInGroup(cur, box.dataset.g, box.checked);
  });
  groupsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.closest('.pd-gnew') || !cur) return;
    const name = e.target.value.trim();
    if (!name) return;
    const g = favorites.addGroup(name);
    favorites.setInGroup(cur, g.id, true);
    groupsEl.querySelector('.pd-gnew')?.focus();
  });
  document.addEventListener('click', (e) => {
    if (!groupsEl.hidden && !groupsEl.contains(e.target) && e.target !== groupsBtn) setGroupsOpen(false);
  });

  // ---- body interactions: agent links, share; tips on resonator/mod slots ----
  const TIPPED = '.pd-rchip, .pd-slabel[data-tip]';
  let tapped = null;
  bodyEl.addEventListener('click', (e) => {
    const ag = e.target.closest('.ag-link');
    if (ag) {
      e.preventDefault(); hideTip(); tapped = null;
      bus.emit('openAgent', { id: ag.dataset.id, nick: ag.dataset.nick });
      return;
    }
    const hb = e.target.closest('.pd-hbtn');
    if (hb) { loadHist(hb.dataset.h === 'more'); return; }
    if (coarsePointer) {
      // on touch a tap toggles what hover does with a mouse
      const t = e.target.closest(TIPPED);
      if (t) {
        if (t === tapped) { tapped = null; hideTip(); return; }
        tapped = t;
        showTip(t.getBoundingClientRect(), t.dataset.tip, t.classList.contains('pd-slabel'));
        return;
      }
    }
    const c = e.target.closest('.pd-copy');
    if (c) {
      navigator.clipboard?.writeText(c.dataset.copy).then(() => {
        c.classList.add('done'); c.title = 'Скопировано';
        setTimeout(() => { c.classList.remove('done'); c.title = 'Скопировать координаты'; }, 1200);
      }, () => {});
      return;
    }
    const s = e.target.closest('.pd-share');
    if (s) {
      e.preventDefault();
      navigator.clipboard?.writeText(s.getAttribute('href')).catch(() => {});
      s.textContent = 'скопировано';
      setTimeout(() => { s.textContent = 'ссылка'; }, 1200);
    }
  });
  if (!coarsePointer) {
    bodyEl.addEventListener('mouseover', (e) => {
      const t = e.target.closest(TIPPED);
      if (t) showTip(t.getBoundingClientRect(), t.dataset.tip, t.classList.contains('pd-slabel'));
    });
    bodyEl.addEventListener('mouseout', (e) => {
      const t = e.target.closest(TIPPED);
      if (!t || (e.relatedTarget && t.contains(e.relatedTarget))) return;
      // sliding straight onto another slot: its mouseover moves the tip
      if (e.relatedTarget?.closest?.(TIPPED)) return;
      hideTip();
    });
  }
  panel.querySelector('.pd-close').addEventListener('click', close);

  // ---- upright phones: a bottom sheet, low (the figures) or high (everything) ----
  // Dragged by its head; a tap on the head flips low ↔ high, pulled below the
  // low height it closes. --sheet-h is its height for the rest of the layout.
  const headEl = panel.querySelector('.pd-head');
  const TOP_GAP = 62; // under the plate
  let sheet = 'low';
  // the map's height: the window less the system bars' insets, if any
  const mapH = () => map.getContainer().clientHeight;
  const highH = () => mapH() - TOP_GAP;
  // the head and the figures grid; before the card loads, a guess
  function lowH() {
    const st = bodyEl.querySelector('.pd-stats');
    return Math.min(highH(), st ? st.offsetTop + st.offsetHeight + 12 : headEl.offsetHeight + 120);
  }
  function setSheetH(h) {
    panel.style.height = h + 'px';
    document.documentElement.style.setProperty('--sheet-h', h + 'px');
  }
  function setSheet(s) {
    sheet = s;
    panel.classList.toggle('pd--low', s === 'low');
    if (s === 'low') panel.scrollTop = 0;
    setSheetH(s === 'low' ? lowH() : highH());
  }
  // the portal stays in sight above the sheet
  function keepInView(p) {
    if (!ll(p)) return;
    const y = map.latLngToContainerPoint([p.lat, p.lng]).y;
    const bottom = mapH() - lowH() - 24;
    if (y > TOP_GAP && y < bottom) return;
    map.panBy([0, y - (TOP_GAP + bottom) / 2]);
  }
  function unsheet() {
    panel.style.height = ''; panel.classList.remove('pd--low', 'pd--drag');
    document.documentElement.style.setProperty('--sheet-h', '0px');
  }
  narrow.addEventListener('change', () => { if (panel.hidden) return; if (narrow.matches) setSheet('low'); else unsheet(); });
  addEventListener('resize', () => { if (!panel.hidden && narrow.matches) setSheet(sheet); });

  let drag = null; // { y, h, moved }
  headEl.addEventListener('pointerdown', (e) => {
    if (!narrow.matches || e.target.closest('button, input, label, .pd-groups')) return;
    drag = { y: e.clientY, h: panel.offsetHeight, moved: false };
    headEl.setPointerCapture(e.pointerId);
  });
  headEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = drag.y - e.clientY;
    if (!drag.moved && Math.abs(dy) < 6) return;
    drag.moved = true;
    panel.classList.add('pd--drag');
    setSheetH(Math.max(40, Math.min(highH(), drag.h + dy)));
  });
  const endDrag = () => {
    if (!drag) return;
    const { moved } = drag; drag = null;
    panel.classList.remove('pd--drag');
    if (!moved) { setSheet(sheet === 'low' ? 'high' : 'low'); return; }
    const h = panel.offsetHeight, low = lowH();
    if (h < low * 0.6) close();
    else setSheet(h > (low + highH()) / 2 ? 'high' : 'low');
  };
  headEl.addEventListener('pointerup', endDrag);
  headEl.addEventListener('pointercancel', endDrag);

  // ---- selection overlays: own pane above the portals, click-through ----
  map.createPane('nitcSelection');
  map.getPane('nitcSelection').style.zIndex = 650;
  map.getPane('nitcSelection').style.pointerEvents = 'none';
  const OV = { pane: 'nitcSelection', renderer: L.svg({ pane: 'nitcSelection' }), interactive: false };
  let selCircle = null, rangeCircle = null, rangeSpec = null;

  function selectPortal(p) {
    clearSel();
    if (ll(p)) {
      selCircle = L.circle([p.lat, p.lng], {
        radius: GAME.actionRadiusM, color: SEL_COL, weight: 2, opacity: 0.95,
        fill: true, fillColor: SEL_COL, fillOpacity: 0.08, ...OV,
      }).addTo(map);
    }
    engine.setSelected(p.id); // repaint: this portal strokes red
  }
  // at street zoom a long link range is millions of pixels across, so skip it
  // when it can't be on screen anyway
  function rangePx(sp) {
    const c = map.latLngToLayerPoint([sp.lat, sp.lng]);
    const e = map.latLngToLayerPoint([sp.lat + sp.m / 111320, sp.lng]);
    return Math.abs(c.y - e.y);
  }
  function drawRange(lat, lng, m) {
    rangeSpec = Number.isFinite(lat) && Number.isFinite(lng) && m > 0 ? { lat, lng, m } : null;
    applyRange();
  }
  function applyRange() {
    if (!rangeSpec || rangePx(rangeSpec) > MAX_RANGE_PX) {
      rangeCircle?.remove(); rangeCircle = null;
      return;
    }
    const ring = geodesicCircle([rangeSpec.lat, rangeSpec.lng], rangeSpec.m);
    if (rangeCircle) { rangeCircle.setLatLngs(ring); return; }
    rangeCircle = L.polygon(ring, {
      fill: false, color: SEL_COL, weight: 1.5, opacity: 0.85, dashArray: '5,5', ...OV,
    }).addTo(map);
  }
  map.on('zoomend', applyRange);
  function clearSel() {
    selCircle?.remove(); selCircle = null;
    rangeSpec = null;
    rangeCircle?.remove(); rangeCircle = null;
  }

  function close() {
    backClosed(close);
    setGroupsOpen(false);
    panel.hidden = true; tapped = null; hideTip(); clearSel();
    unsheet();
    inflight?.abort();
    cur = null; paintFav();
    engine.setSelected(null);
  }

  // ---- open ----
  let reqId = 0, inflight = null;
  // p: { id, name?, lat, lng, faction?, level? }; `detail` — an already-fetched
  // adapted card (favorites has one in hand), which skips a duplicate request
  async function openPortal(p, detail) {
    panel.hidden = false; tapped = null; hideTip();
    if (hist?.id !== p.id) { histCtrl?.abort(); hist = null; }
    backOpen(close);
    selectPortal(p);
    cur = { id: p.id, name: p.name, lat: p.lat, lng: p.lng }; paintFav();
    setTitle(p.faction ? levelOf(p) : null, p.name, p.faction ? fcol(p.faction) : '');
    bodyEl.innerHTML = '<div class="pd-muted">загрузка…</div>';
    if (narrow.matches) { setSheet('low'); keepInView(p); }
    const my = ++reqId;
    inflight?.abort(); inflight = null;
    if (detail) { render(detail); return; }
    inflight = new AbortController();
    try {
      const d = adaptPortalDetail(await getPortal(p.id, inflight.signal));
      if (my !== reqId) return; // superseded by a newer click
      render(d);
    } catch (e) {
      if (e?.name === 'AbortError' || my !== reqId) return;
      bodyEl.innerHTML = (e?.code === 'portal_not_found' || e?.code === 'not_found')
        ? '<div class="pd-muted">портал не найден — возможно, удалён</div>'
        : `<div class="pd-muted">не удалось загрузить: ${esc(e?.code || e?.message || e)}</div>`;
    }
  }
  bus.on('portalClick', (p) => {
    if (tools.drawMode) return; // a draw tool is capturing clicks as vertices
    openPortal(p);
  });
  bus.on('openPortal', ({ portal, detail }) => openPortal(portal, detail));

  // ---- history ----
  let hist = null;     // { id, items (newest first), next, state: loading|ok|err, err }
  let histCtrl = null;
  // ~20 m around the portal: its own events, at most a close neighbour's (dropped)
  function histBox(d) {
    const dy = 0.0002, dx = dy / Math.max(0.2, Math.cos((d.lat * Math.PI) / 180));
    return { w: d.lng - dx, s: d.lat - dy, e: d.lng + dx, n: d.lat + dy };
  }
  async function loadHist(more) {
    const d = shown;
    if (!d || !ll(d)) return;
    if (!more || hist?.id !== d.id) hist = { id: d.id, items: [], next: '' };
    const my = hist;
    my.state = 'loading'; paintHist();
    histCtrl?.abort(); histCtrl = new AbortController();
    try {
      const r = await getActivity(histBox(d), more ? { cursor: my.next } : {}, histCtrl.signal);
      if (hist !== my) return;
      for (const raw of r.items || []) {
        const ev = adaptEvent(raw);
        if (ev.portals[0]?.id === my.id && !my.items.some((x) => x.id === ev.id)) my.items.push(ev);
      }
      my.next = r.next || ''; my.state = 'ok';
    } catch (e) {
      if (e?.name === 'AbortError' || hist !== my) return;
      my.state = 'err'; my.err = errText(e?.code, e?.retryAfter);
    }
    paintHist();
  }
  function histRow(ev) {
    const other = GROUP[ev.kind] === 'link' && ev.portals[1] ? ' → ' + (ev.portals[1].name || 'портал') : '';
    const mu = MU_SIGN[ev.kind] ? ` ${MU_SIGN[ev.kind]}${ev.mu == null ? '?' : ev.mu.toLocaleString('ru-RU')} MU` : '';
    const what = (KIND_LABEL[ev.kind] || ev.kind) + other + mu;
    return `<div class="pd-hrow" title="${esc(`${fmtTime(ev.time)} ${ev.nick}: ${what}`)}">` +
      `<span class="pd-ht">${fmtTime(ev.time)}</span>` +
      `<span class="pd-hnick">${agentLink(ev.nick, { id: ev.actorId, color: fcol(ev.faction) })}</span>` +
      `<span class="pd-hwhat">${esc(what)}</span></div>`;
  }
  function histHtml() {
    const h = hist && hist.id === shown?.id ? hist : null;
    let s = '<div class="pd-h">История</div>';
    if (!h) return s + '<button type="button" class="pd-hbtn" data-h="load">Показать историю портала</button>';
    if (h.items.length) s += `<div class="pd-hlist">${h.items.map(histRow).join('')}</div>`;
    if (h.state === 'loading') return s + '<div class="pd-muted pd-hnote">загрузка…</div>';
    if (h.state === 'err') {
      return s + `<div class="pd-muted pd-hnote">${esc(h.err)}</div>` +
        `<button type="button" class="pd-hbtn" data-h="${h.next ? 'more' : 'load'}">Повторить</button>`;
    }
    if (h.next) return s + '<button type="button" class="pd-hbtn" data-h="more">Ещё</button>';
    return s + `<div class="pd-muted pd-hnote">${h.items.length
      ? 'Это всё, что хранит журнал.'
      : 'В журнале нет событий этого портала: его могли ещё не захватывать, или он распался без атаки.'}</div>`;
  }
  function paintHist() {
    const el = bodyEl.querySelector('.pd-hist');
    if (el) el.innerHTML = histHtml();
  }

  // ---- render ----
  // the key line follows the key set: re-render the open card when it loads
  let shown = null;
  bus.on('keysChanged', () => { if (shown && !panel.hidden && shown.id === cur?.id) render(shown); });

  function render(d) {
    shown = d;
    const col = fcol(d.faction);
    setTitle(levelOf(d), d.name, col);
    // the card is the authoritative name/position — star and circle what it says
    cur = { id: d.id, name: d.name, lat: d.lat, lng: d.lng }; paintFav();
    if (selCircle && ll(d)) selCircle.setLatLng([d.lat, d.lng]);
    // link range and link counts: the server's planning figures when present
    // (exact: Link Amp/SoftBank effects, every link of the portal); otherwise
    // our own estimate from the resonators and the loaded viewport
    const pl = d.planning;
    const range = pl ? { m: pl.rangeM, full: pl.full, meanL: pl.full ? 1 : 0 } : G.linkRange(d);
    drawRange(d.lat, d.lng, range.full ? range.m : 0); // 0 clears the circle

    const vg = G.graph(d.id, engine.getData());
    const g = pl ? { ...vg, inc: pl.inc, out: pl.out, extra: 0, links: pl.inc + pl.out } : vg;
    const en = G.energy(d);
    const sh = G.shieldingPct(d);
    const resos = d.resonators.filter(Boolean);
    const mods = d.mods.filter(Boolean);
    const dash = '<span class="pd-dash">—</span>';
    const parts = [];

    if (d.photoUrl) parts.push(`<img class="pd-photo" src="${esc(d.photoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`);

    // own keys to this portal: free ones can be spent on a link, the rest sit
    // in capsules (the breakdown in the tooltip). "—" only once the whole key
    // set is in; "…" while it loads, "?" if it couldn't be loaded.
    const k = keys.get(d.id);
    const keyCell = k
      ? [`${k.qty}` + (k.inCaps ? ` <span class="pd-muted">(${k.inCaps} в капс.)</span>` : ''),
        `свободных ${k.free}, в капсулах ${k.inCaps}`]
      : keys.ready ? [dash, 'ключей нет']
      : keys.state === 'loading' ? ['<span class="pd-muted">…</span>', 'ключи загружаются']
      : ['<span class="pd-muted">?</span>', 'ключи не загрузились'];

    // stats: 9 figures in two columns (the grid fills column-first)
    const rows = [
      ['Ключи', ...keyCell],
      ['Владелец', d.owner ? agentLink(d.owner, { color: col }) : dash],
      ['AP за снос', String(G.destroyAp(d, g))],
      ['Линки', `${g.inc} вх / ${g.out} исх` +
        (g.extra ? ` <span class="pd-approx" title="рёбра полей, которых нет среди загруженных линков">+${g.extra}</span>` : '')],
      ['Поля', String(g.fields)],
      ['Защита', sh ? `${sh}%` : dash],
      ['Дальность', range.meanL > 0 ? (range.full ? fmtDist(range.m) : `<s>${fmtDist(range.m)}</s>`) : dash],
      ['Хаки', `${G.hacks(d)} · ${G.cooldownS(d)}с`],
      ['Энергия', en.max ? `${fmtK(en.cur)} / ${fmtK(en.max)}` : dash],
    ];
    parts.push('<div class="pd-stats">' + rows.map(([k, v, tip]) =>
      `<div class="pd-st"${tip ? ` title="${tip}"` : ''}><span class="pd-sk">${k}</span><span class="pd-sv">${v}</span></div>`).join('') + '</div>');

    // mod slots: 4 fixed columns, label coloured by rarity, owner underneath
    parts.push(`<div class="pd-h">Моды ${mods.length}/4</div>`);
    parts.push('<div class="pd-slots">' + d.mods.map((m) => {
      if (!m) return '<div class="pd-slot"><div class="pd-slabel pd-ph"></div></div>';
      const s = m.spec, rr = RARITY[s.rarity];
      const tip = `${s.name || s.type}${rr ? ' · ' + rr.name : ''}\n${modStats(s)}`;
      const short = MOD_SHORT[s.type] || String(s.type || '?').slice(0, 2).toUpperCase();
      return '<div class="pd-slot">' +
        `<div class="pd-slabel" style="background:${rr ? rr.color : '#6b7683'}" data-tip="${esc(tip)}">${esc(short)}</div>` +
        `<div class="pd-sowner" title="${esc(m.owner || '')}">${agentLink(m.owner)}</div></div>`;
    }).join('') + '</div>');

    // resonators: a compass rose — each slot at its bearing, the chip's fill
    // height is that resonator's XM, the centre holds the portal total
    parts.push(`<div class="pd-h">Резонаторы ${resos.length}/8</div>`);
    if (resos.length) {
      parts.push('<div class="pd-rose">' + ROSE.map((slot) => {
        if (slot === null) {
          return '<div class="pd-rcore">' + (en.max
            ? `<b>${fmtK(en.cur)} / ${fmtK(en.max)}</b><span>${Math.round(en.pct)}%</span>` : '') + '</div>';
        }
        const r = d.resonators[slot], dir = SLOT_DIR[slot];
        if (!r) return `<div class="pd-rchip pd-ph" data-tip="${dir} · пусто"></div>`;
        const p = G.resoPct(r);
        const fill = p != null && p <= GAME.weakResoPct ? '#ff5d73' : col;
        const tip = `${dir} · ${r.xm.cur}/${r.xm.max}` + (p != null ? ` (${Math.round(p)}%)` : '');
        return `<div class="pd-rchip" style="border-color:${col}" data-tip="${esc(tip)}">` +
          `<span class="pd-rfill" style="height:${p == null ? 0 : Math.round(p)}%;background:${fill}"></span>` +
          `<span class="pd-rlvl">${r.level}</span>` +
          `<span class="pd-rown">${r.owner ? agentLink(r.owner) : '—'}</span></div>`;
      }).join('') + '</div>');
    } else parts.push('<div class="pd-muted">не установлены</div>');

    // coords (+ copy) · share link (#p= deep link)
    if (ll(d)) {
      const lat = d.lat.toFixed(6), lng = d.lng.toFixed(6);
      const share = `${location.origin}${location.pathname}#p=${encodeURIComponent(d.id)},${lat},${lng}`;
      parts.push(`<div class="pd-coords">${lat}, ${lng}` +
        `<button type="button" class="pd-copy" data-copy="${lat},${lng}" title="Скопировать координаты">${COPY}</button>` +
        ` · <a class="pd-share" href="${esc(share)}">ссылка</a></div>`);
    }

    // history last: it grows on demand and must not push the coords out of view
    parts.push(`<div class="pd-hist">${histHtml()}</div>`);

    tapped = null; // the chips are rebuilt below
    bodyEl.innerHTML = parts.join('');
    bodyEl.querySelector('.pd-photo')?.addEventListener('error', (e) => e.target.remove());
    if (narrow.matches && sheet === 'low') setSheet('low'); // the figures are in: fit them
  }

  return { openPortal, close };
}
