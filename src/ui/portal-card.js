// Portal card: click a portal → GET /portals/{id} → a card docked top-right:
// photo, a stats grid, the 4 mod slots and the 8 resonators as a compass rose.
//
// Link counts and link range come from the card's server `planning` block.
// Fields are not in the card — they are counted from the loaded map data
// (engine.getData()), so they cover what the current viewport loaded.
//
// Selection on the map: the portal's own outline turns red (engine), plus the
// 40 m action circle and, for a fully deployed portal, its max link range.
import L from 'leaflet';
import './portal-card.css';
import { GAME } from '../config.js';
import { fcol, ll } from '../map/render.js';
import { getPortal } from '../api/intel.js';
import { adaptPortalDetail } from '../adapter/model.js';
import * as G from '../game/portal.js';
import { favorites } from '../state/favorites.js';
import { bus, tools } from '../state/bus.js';
import { coarsePointer } from './toolbar.js';
import { esc } from './esc.js';
import { STAR } from './icons.js';
import { agentLink } from './agent-card.js';
import { keys } from '../state/keys.js';

const SEL_COL = '#ff2d2d';
// short slot labels; the label colour is the rarity
const MOD_SHORT = {
  shield: 'SH', aegis: 'AG', link_amp: 'LA', softbank: 'SB',
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
      bus.emit('openAgent', { nick: ag.dataset.nick });
      return;
    }
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
  // L.circle's radius is in metres: at street zoom a long link range is
  // millions of pixels across, so skip it when it can't be on screen anyway
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
    if (rangeCircle) {
      rangeCircle.setLatLng([rangeSpec.lat, rangeSpec.lng]).setRadius(rangeSpec.m);
      return;
    }
    rangeCircle = L.circle([rangeSpec.lat, rangeSpec.lng], {
      radius: rangeSpec.m, fill: false, color: SEL_COL, weight: 1.5, opacity: 0.85, dashArray: '5,5', ...OV,
    }).addTo(map);
  }
  map.on('zoomend', applyRange);
  function clearSel() {
    selCircle?.remove(); selCircle = null;
    rangeSpec = null;
    rangeCircle?.remove(); rangeCircle = null;
  }

  function close() {
    setGroupsOpen(false);
    panel.hidden = true; tapped = null; hideTip(); clearSel();
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
    selectPortal(p);
    cur = { id: p.id, name: p.name, lat: p.lat, lng: p.lng }; paintFav();
    setTitle(p.faction ? levelOf(p) : null, p.name, p.faction ? fcol(p.faction) : '');
    bodyEl.innerHTML = '<div class="pd-muted">загрузка…</div>';
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

    // stats: 8 figures in two columns (the grid fills column-first)
    const rows = [
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
    parts.push('<div class="pd-stats">' + rows.map(([k, v]) =>
      `<div class="pd-st"><span class="pd-sk">${k}</span><span class="pd-sv">${v}</span></div>`).join('') + '</div>');

    // own keys to this portal: free ones can be spent on a link, the rest sit
    // in capsules. "нет" only once the whole key set is in.
    const k = keys.get(d.id);
    const keyText = k ? `${k.qty}` + (k.inCaps ? ` <span class="pd-muted">(${k.free} своб. + ${k.inCaps} в капсулах)</span>` : '')
      : keys.ready ? '<span class="pd-muted">нет</span>'
      : keys.state === 'loading' ? '<span class="pd-muted">загрузка…</span>' : '<span class="pd-muted">неизвестно</span>';
    parts.push(`<div class="pd-keys"><span class="pd-sk">Ключи</span> ${keyText}</div>`);

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

    tapped = null; // the chips are rebuilt below
    bodyEl.innerHTML = parts.join('');
    bodyEl.querySelector('.pd-photo')?.addEventListener('error', (e) => e.target.remove());
  }

  return { openPortal, close };
}
