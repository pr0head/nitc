// World MU balance, top centre: a two-colour bar with both factions' MU; a
// click opens the rating window.
//
// The server reads it from a background snapshot; we poll once a minute with
// ETag, paused in a hidden tab. While a snapshot is being recalculated
// ("partial") the last full one stays on screen until the new one is ready —
// the progress is of no interest; with none yet, the shares come from the
// partial MU. Other statuses show their state instead of percents (the API
// leaves them null — never draw 50/50).
//
// Window, as in the game: a balance card on top, then two switches —
// territory («Мир» | the region under the map centre) and «Линки» | «Поля»
// (active links; MU of active fields) — and the agents below.
//   Мир     the card is the polled world score (snapshot time, what a
//           non-ready status means, the world's fields); the list is the
//           world rating, 25 a page, «ещё» for the next; all pages of a list
//           come from one snapshot, and when it expires (410) the list starts
//           over.
//   Регион  the region (S2 level 4) and its name are found when the window
//           opens. One request gives the card (MU, the same for both kinds)
//           and the top-10 with own place; a recalculating answer does not
//           replace a full one.
// Own row highlighted, or pinned below when not among the loaded ones. Lists
// are read when shown (at most once a minute) and by «обновить» — no polling.
import { FACTION, MAP } from '../config.js';
import { getScore, getRating, getTerritorial } from '../api/intel.js';
import { adaptScore, adaptRating, adaptTerritory } from '../adapter/model.js';
import { fcol } from '../map/render.js';
import { s2Token, regionName } from '../map/s2.js';
import { bus } from '../state/bus.js';
import { createListModal } from './dialog.js';
import { agentLink } from './agent-card.js';
import { errText } from './errors.js';
import { esc } from './esc.js';

const POLL_MS = 60000;
const RATING_TTL_MS = 60000;
const REGION_LEVEL = 4;
const TITLE = 'Рейтинг';
const SCORE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="20" x2="6" y2="13"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="9"/></svg>';
const STATUS = {
  empty: 'нет активных полей',
  partial: 'подсчёт…',
  stale: 'данные устарели',
  disabled: 'счёт отключён',
  unavailable: 'нет данных',
};
// what a non-ready status means, in the window
const STATUS_LONG = {
  empty: 'Сейчас в мире нет действующих полей.',
  partial: 'Часть полей ещё считается: суммы предварительные.',
  stale: 'Снимок счёта старше двух минут: данные могут отставать.',
  disabled: 'MU-эпоха не начата: счёт не ведётся.',
  unavailable: 'Готового снимка счёта ещё нет.',
};
const REGION_UNAVAILABLE = 'Счёт региона пока не рассчитан.';
const KINDS = [['links', 'Линки'], ['fields', 'Поля']];
const RATING = {
  links: { unit: (n) => `${full(n)} ${plural(n, 'линк', 'линка', 'линков')}`, none: 'нет действующих линков' },
  fields: { unit: (n) => `${full(n)} MU`, none: 'нет действующих полей' },
};
const fmt = (n) => (n == null ? '?' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'
  : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n.toLocaleString('ru-RU'));
const full = (n) => (n == null ? '?' : n.toLocaleString('ru-RU'));
const hm = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function plural(n, one, few, many) {
  const a = n % 100, b = n % 10;
  return a >= 11 && a <= 14 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}
// a partial snapshot shown as is: the shares from its MU sums
function shares(s) {
  const sum = (s.mu.res ?? 0) + (s.mu.enl ?? 0);
  if (s.mu.res == null || s.mu.enl == null || !sum) return s;
  return { ...s, status: 'ready', pct: { res: (s.mu.res / sum) * 100, enl: (s.mu.enl / sum) * 100 } };
}

// center(): the map centre, { lat, lng } — the region is the one under it
export function mountScore(container, menu, center) {
  const el = document.createElement('div');
  el.className = 'score';
  el.hidden = true; // until the first answer
  el.title = 'Мировой счёт и рейтинг агентов';
  container.append(el);

  const modal = createListModal(TITLE, 'sc-box');
  let last = null; // on screen
  let lastReady = null; // the last fully calculated snapshot
  // kept between openings
  let scope = 'world'; // world | region
  let kind = 'fields';
  let region = null; // { token, name }

  function paint(s) {
    const ready = s.status === 'ready' && s.pct.res != null && s.pct.enl != null;
    const res = FACTION.res, enl = FACTION.enl;
    el.innerHTML =
      `<span class="score-v" style="color:${res.color}">${fmt(s.mu.res)}</span>` +
      '<span class="score-bar">' + (ready
        ? `<span style="width:${s.pct.res}%;background:${res.color}"></span><span style="width:${s.pct.enl}%;background:${enl.color}"></span>`
        : `<span class="score-st">${STATUS[s.status] || STATUS.unavailable}</span>`) + '</span>' +
      `<span class="score-v" style="color:${enl.color}">${fmt(s.mu.enl)}</span>`;
    el.hidden = false;
  }

  async function load() {
    try {
      const s = adaptScore(await getScore());
      if (s.status !== 'partial') { last = s; if (s.status === 'ready') lastReady = s; }
      else last = lastReady || shares(s);
      paint(last);
      if (modal.isOpen && scope === 'world') renderCard();
    } catch { /* keep the last bar */ }
  }

  // ---- window: the card, the two switches, the list ----
  // opened by the bar, or by the menu where the bar is hidden (narrow screens)
  el.addEventListener('click', openWindow);
  menu.sep().classList.add('menu-narrow');
  menu.add({ icon: SCORE_ICON, label: 'Счёт и рейтинг', onClick: openWindow }).classList.add('menu-narrow');
  function openWindow() {
    const c = center();
    const token = s2Token(c.lat, c.lng, REGION_LEVEL);
    if (region?.token !== token) region = { token, name: regionName(c.lat, c.lng) };
    modal.list.innerHTML = '<div class="sc-card"></div><div class="sc-sw">' +
      '<div class="seg sc-scope"><button type="button" data-scope="world">Мир</button>' +
      '<button type="button" data-scope="region"></button></div>' +
      '<div class="seg sc-kind">' + KINDS.map(([k, t]) => `<button type="button" data-kind="${k}">${t}</button>`).join('') + '</div>' +
      '</div><div class="sc-pane"></div>';
    modal.open();
    show();
  }

  function show() {
    if (scope === 'world') {
      const r = ratings[kind];
      if (!r.loading && (!r.at || Date.now() - r.at > RATING_TTL_MS)) loadRating(kind, false);
    } else {
      const t = terr(region.token, kind);
      if (!t.loading && (!t.at || Date.now() - t.at > RATING_TTL_MS)) loadTerr(region.token, kind);
    }
    renderAll();
  }

  modal.list.addEventListener('click', (e) => {
    const s = e.target.closest('[data-scope]');
    if (s) { scope = s.dataset.scope; show(); return; }
    const k = e.target.closest('[data-kind]');
    if (k) { kind = k.dataset.kind; show(); return; }
    const ag = e.target.closest('.ag-link');
    if (ag) { e.preventDefault(); bus.emit('openAgent', { id: ag.dataset.id, nick: ag.dataset.nick }); return; }
    const a = e.target.closest('[data-act]');
    if (a?.dataset.act === 'more') loadRating(kind, true);
    else if (a?.dataset.act === 'reload') {
      if (scope === 'world') loadRating(kind, false); else loadTerr(region.token, kind);
    }
  });

  function renderAll() {
    if (!modal.list.querySelector('.sc-pane')) return;
    modal.list.querySelectorAll('[data-scope]').forEach((b) => b.classList.toggle('on', b.dataset.scope === scope));
    modal.list.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === kind));
    modal.list.querySelector('[data-scope="region"]').textContent = region.name;
    renderCard();
    renderPane();
  }

  // the balance: both factions' MU and share, a bar, and a line under it
  function balance(where, mu, pct, note) {
    const res = FACTION.res, enl = FACTION.enl;
    const side = (f, v, p) => `<div class="sc-side" style="color:${f.color}"><span>${f.name}</span>` +
      `<b>${p == null ? '—' : p.toFixed(1).replace('.', ',') + '%'}</b><small>${v == null ? '—' : full(v) + ' MU'}</small></div>`;
    return `<div class="sc-h">Расстановка сил · <span>${esc(where)}</span></div>` +
      `<div class="sc-sides">${side(res, mu.res, pct?.res)}${side(enl, mu.enl, pct?.enl)}</div>` +
      '<div class="sc-bar">' + (pct
        ? `<span style="width:${pct.res}%;background:${res.color}"></span><span style="width:${pct.enl}%;background:${enl.color}"></span>`
        : '') + '</div>' + (note ? `<div class="sc-note">${note}</div>` : '');
  }

  function renderCard() {
    const card = modal.list.querySelector('.sc-card');
    if (!card) return;
    if (scope === 'world') {
      const s = last;
      if (!s) { card.innerHTML = balance('Мир', { res: null, enl: null }, null, 'загрузка…'); return; }
      const ready = s.status === 'ready' && s.pct.res != null && s.pct.enl != null;
      const fields = [
        s.fields != null ? `полей: ${full(s.fields)}` : '',
        s.processed != null && s.fields != null && s.processed !== s.fields ? `посчитано ${full(s.processed)}` : '',
        s.pending ? `ждут расчёта: ${full(s.pending)}` : '',
        s.unresolved ? `не определены: ${full(s.unresolved)}` : '',
      ].filter(Boolean).join(' · ');
      const note = (s.asOf ? `на ${hm(s.asOf)}` : 'время неизвестно') + (fields ? ' · ' + fields : '') +
        (s.status !== 'ready' ? `<div class="sc-warn">${STATUS_LONG[s.status] || STATUS_LONG.unavailable}</div>` : '');
      card.innerHTML = balance('Мир', s.mu, ready ? s.pct : null, note);
      return;
    }
    // the MU balance is the same for both kinds: any loaded answer will do
    const t = terr(region.token, kind).data || terr(region.token, kind === 'links' ? 'fields' : 'links').data;
    const where = region.name;
    if (!t) { card.innerHTML = balance(where, { res: null, enl: null }, null, 'загрузка…'); return; }
    const sum = (t.mu.res ?? 0) + (t.mu.enl ?? 0);
    const pct = t.mu.res != null && t.mu.enl != null && sum > 0
      ? { res: (t.mu.res / sum) * 100, enl: (t.mu.enl / sum) * 100 } : null;
    const note = (t.asOf ? `на ${hm(t.asOf)}` : '') +
      (t.mu.res != null && !sum ? ' · нет действующих полей' : '') +
      (t.muStatus === 'unavailable' ? `<div class="sc-warn">${REGION_UNAVAILABLE}</div>` : '');
    card.innerHTML = balance(where, t.mu, pct, note);
  }

  function renderPane() {
    const pane = modal.list.querySelector('.sc-pane');
    if (!pane) return;
    if (scope === 'world') renderRating(pane); else renderTerr(pane);
  }

  // ---- lists ----
  const value = (n) => (kind === 'fields'
    ? `<b class="rt-v" title="${full(n)} MU">${fmt(n)}</b>` : `<b class="rt-v">${full(n)}</b>`);
  const row = (a, me) => {
    const col = fcol(a.faction);
    return `<div class="rt-row${me ? ' me' : ''}">` +
      `<span class="rt-rank">${a.rank ?? '—'}</span>` +
      (a.level !== undefined ? `<span class="rt-lvl" style="color:${col};border-color:${col}" title="уровень">${a.level ?? '?'}</span>` : '') +
      `<span class="rt-nick">${agentLink(a.nick, { id: a.id, color: col })}</span>` +
      (a.score != null ? value(a.score) : '') + '</div>';
  };
  const bar = (label, loading) => `<div class="rt-bar"><span>${label}</span>` +
    `<button type="button" class="rt-btn" data-act="reload"${loading ? ' disabled' : ''}>обновить</button></div>`;
  const mineRow = (text) => `<div class="rt-self"><span class="rt-self-h">Вы:</span> ${text}</div>`;

  // world: one list per kind, each with its own cursor
  const blank = () => ({ rows: [], self: null, asOf: null, next: null, at: 0, loading: false, err: null, ctrl: null });
  const ratings = { links: blank(), fields: blank() };

  // more: the next page of the same snapshot; otherwise the list from the top
  async function loadRating(k, more) {
    const r = ratings[k];
    if (more && (!r.next || r.loading)) return;
    r.ctrl?.abort();
    const ctrl = r.ctrl = new AbortController();
    r.loading = true; r.err = null;
    if (modal.isOpen && scope === 'world' && kind === k) renderPane();
    try {
      const page = adaptRating(await getRating(k, more ? r.next : null, ctrl.signal));
      if (more) r.rows = r.rows.concat(page.rows);
      else { r.rows = page.rows; r.at = Date.now(); }
      r.self = page.self; r.asOf = page.asOf; r.next = page.next;
    } catch (e) {
      if (e?.name === 'AbortError') return;
      // the snapshot behind the cursor is gone: start over, never append to it
      if (more && (e?.code === 'leaderboard_snapshot_expired' || e?.code === 'invalid_cursor')) {
        r.loading = false; r.ctrl = null;
        loadRating(k, false);
        return;
      }
      r.err = e?.code === 'leaderboard_not_ready' ? 'Рейтинг ещё не готов, попробуйте чуть позже.'
        : 'Не удалось загрузить рейтинг: ' + errText(e?.code, e?.retryAfter);
    }
    if (r.ctrl !== ctrl) return;
    r.loading = false; r.ctrl = null;
    if (modal.isOpen && scope === 'world' && kind === k) renderPane();
  }

  function renderRating(pane) {
    const r = ratings[kind], R = RATING[kind];
    const head = bar(r.asOf ? 'на ' + hm(r.asOf) : 'мировой рейтинг', r.loading);
    if (!r.rows.length && !r.self) {
      pane.innerHTML = head + `<div class="lm-empty">${r.loading ? 'загрузка…' : esc(r.err || 'В рейтинге пока никого нет.')}</div>`;
      return;
    }
    const list = r.rows.length ? r.rows.map((a) => row(a, a.self)).join('')
      : '<div class="lm-empty">В рейтинге пока никого нет.</div>';
    // own place when it isn't among the loaded rows
    const s = r.self;
    let mine = '';
    if (s && !r.rows.some((a) => a.self)) {
      mine = mineRow(s.status === 'ranked' ? `${s.rank}-е место · ${R.unit(s.score)}`
        : s.status === 'unranked' ? R.none : 'вы пока не учитываетесь');
    }
    const tail = r.next
      ? `<button type="button" class="rt-more" data-act="more"${r.loading ? ' disabled' : ''}>${r.loading ? 'загрузка…' : 'загрузить ещё'}</button>`
      : '';
    pane.innerHTML = head + `<div class="rt-list">${list}</div>` + tail +
      (r.err ? `<div class="sc-warn">${esc(r.err)}</div>` : '') + mine;
  }

  // region: one answer per region and kind
  const terrs = new Map(); // 'token:kind' → { data, at, loading, err, ctrl }
  function terr(token, k) {
    const key = token + ':' + k;
    if (!terrs.has(key)) terrs.set(key, { data: null, at: 0, loading: false, err: null, ctrl: null });
    return terrs.get(key);
  }
  const here = (token, k) => modal.isOpen && scope === 'region' && region?.token === token && kind === k;

  async function loadTerr(token, k) {
    const t = terr(token, k);
    t.ctrl?.abort();
    const ctrl = t.ctrl = new AbortController();
    t.loading = true; t.err = null;
    if (here(token, k)) renderPane();
    try {
      const d = adaptTerritory(await getTerritorial(k, token, ctrl.signal));
      // recalculating: the last full answer stays until the new one is ready
      if (d.muStatus !== 'partial' || t.data?.muStatus !== 'ready') t.data = d;
      t.at = Date.now();
      if (d.name && region?.token === token) region.name = d.name;
    } catch (e) {
      if (e?.name === 'AbortError') return;
      t.err = e?.status === 404 ? 'Рейтинг территорий сейчас отключён.'
        : 'Не удалось загрузить рейтинг региона: ' + errText(e?.code, e?.retryAfter);
    }
    if (t.ctrl !== ctrl) return;
    t.loading = false; t.ctrl = null;
    if (here(token, k)) renderAll();
  }

  function renderTerr(pane) {
    const t = terr(region.token, kind), d = t.data, R = RATING[kind];
    const head = bar(d?.asOf ? `топ-10 · на ${hm(d.asOf)}` : 'топ-10 региона', t.loading);
    if (!d) {
      pane.innerHTML = head + `<div class="lm-empty">${t.loading ? 'загрузка…' : esc(t.err || 'Нет данных.')}</div>`;
      return;
    }
    const selfId = d.self?.id;
    const list = d.rows.length ? d.rows.map((a) => row(a, a.id === selfId)).join('')
      : `<div class="lm-empty">${d.status === 'unavailable' ? 'Рейтинг региона пока не рассчитан.' : 'В рейтинге региона пока никого нет.'}</div>`;
    const s = d.self;
    const mine = s && !d.rows.some((a) => a.id === s.id)
      ? mineRow(s.rank != null ? `${s.rank}-е место · ${R.unit(s.score)}` : R.none + ' в этом регионе') : '';
    pane.innerHTML = head + `<div class="rt-list">${list}</div>` +
      (t.err ? `<div class="sc-warn">${esc(t.err)}</div>` : '') + mine;
  }

  load();
  setInterval(() => { if (!document.hidden) load(); }, Math.max(POLL_MS, MAP.refreshMs));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
}
