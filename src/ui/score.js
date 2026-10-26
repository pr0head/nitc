// World MU balance, top centre: a two-colour bar with both factions' MU; a
// click opens the score window.
//
// The server reads it from a background snapshot; we poll once a minute with
// ETag, paused in a hidden tab. Statuses other than "ready" show their state
// instead of percents (the API leaves them null — never draw 50/50).
//
// Window, three tabs:
//   «Счёт»  the snapshot time in its header (whatever the status); both
//           factions with MU and share; what a non-ready status means; the
//           world's fields and how many are counted
//   «Линки» / «Поля»  the world agent rating, as in the game: active links,
//           MU of active fields. 25 a page, «ещё» for the next; own row
//           highlighted, or pinned below when not among the loaded ones.
//           Read when the tab is shown (at most once a minute) and by
//           «обновить» — no polling. All pages of a list come from one
//           snapshot; when it expires (410) the list starts over.
import { FACTION, MAP } from '../config.js';
import { getScore, getRating } from '../api/intel.js';
import { adaptScore, adaptRating } from '../adapter/model.js';
import { fcol } from '../map/render.js';
import { bus } from '../state/bus.js';
import { createListModal } from './dialog.js';
import { agentLink } from './agent-card.js';
import { errText } from './errors.js';
import { esc } from './esc.js';

const POLL_MS = 60000;
const RATING_TTL_MS = 60000;
const TITLE = 'Мировой счёт MU';
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
const TABS = [['score', 'Счёт'], ['links', 'Линки'], ['fields', 'Поля']];
const RATING = {
  links: { title: 'Рейтинг по линкам', unit: (n) => `${full(n)} ${plural(n, 'линк', 'линка', 'линков')}`, none: 'нет действующих линков' },
  fields: { title: 'Рейтинг по MU полей', unit: (n) => `${full(n)} MU`, none: 'нет действующих полей' },
};
const fmt = (n) => (n == null ? '?' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'
  : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n.toLocaleString('ru-RU'));
const full = (n) => (n == null ? '?' : n.toLocaleString('ru-RU'));
const hm = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function plural(n, one, few, many) {
  const a = n % 100, b = n % 10;
  return a >= 11 && a <= 14 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}

export function mountScore(container, menu) {
  const el = document.createElement('div');
  el.className = 'score';
  el.hidden = true; // until the first answer
  el.title = 'Мировой счёт и рейтинг агентов';
  container.append(el);

  const modal = createListModal(TITLE, 'sc-box');
  let last = null;
  let tab = 'score'; // kept between openings

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
      last = adaptScore(await getScore());
      paint(last);
      if (modal.isOpen && tab === 'score') renderPane();
    } catch { /* keep the last bar */ }
  }

  // ---- window: tabs above, the pane below ----
  // opened by the bar, or by the menu where the bar is hidden (narrow screens)
  el.addEventListener('click', openWindow);
  menu.sep().classList.add('menu-narrow');
  menu.add({ icon: SCORE_ICON, label: 'Счёт и рейтинг', onClick: openWindow }).classList.add('menu-narrow');
  function openWindow() {
    modal.list.innerHTML = '<div class="seg sc-tabs">' + TABS.map(([k, t]) =>
      `<button type="button" data-tab="${k}"${k === tab ? ' class="on"' : ''}>${t}</button>`).join('') +
      '</div><div class="sc-pane"></div>';
    modal.open();
    show(tab);
  }

  function show(k) {
    tab = k;
    modal.list.querySelectorAll('.sc-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
    if (k !== 'score') {
      const r = ratings[k];
      if (!r.loading && (!r.at || Date.now() - r.at > RATING_TTL_MS)) loadRating(k, false);
    }
    renderPane();
  }

  modal.list.addEventListener('click', (e) => {
    const t = e.target.closest('.sc-tabs button');
    if (t) { show(t.dataset.tab); return; }
    const ag = e.target.closest('.ag-link');
    if (ag) { e.preventDefault(); bus.emit('openAgent', { id: ag.dataset.id, nick: ag.dataset.nick }); return; }
    const a = e.target.closest('[data-act]');
    if (a?.dataset.act === 'more') loadRating(tab, true);
    else if (a?.dataset.act === 'reload') loadRating(tab, false);
  });

  function renderPane() {
    const pane = modal.list.querySelector('.sc-pane');
    if (!pane) return;
    if (tab === 'score') renderScore(pane); else renderRating(pane, tab);
  }

  function renderScore(pane) {
    const s = last;
    if (!s) { modal.setTitle(TITLE); pane.innerHTML = '<div class="lm-empty">загрузка…</div>'; return; }
    modal.setTitle(`${TITLE} · ${s.asOf ? 'на ' + hm(s.asOf) : 'время неизвестно'}`);
    const res = FACTION.res, enl = FACTION.enl;
    const ready = s.status === 'ready' && s.pct.res != null && s.pct.enl != null;
    const pct = (v) => (v == null ? '' : `<span class="sc-pct">${v.toFixed(1)}%</span>`);
    const extra = [
      s.pending ? `ждут расчёта: ${full(s.pending)}` : '',
      s.unresolved ? `не определены: ${full(s.unresolved)}` : '',
    ].filter(Boolean).join(' · ');

    pane.innerHTML = '<div class="sc">' +
      `<div class="sc-fac"><span>${res.name}</span><b>${full(s.mu.res)} MU</b>${pct(ready ? s.pct.res : null)}</div>` +
      '<div class="sc-bar">' + (ready
        ? `<span style="width:${s.pct.res}%;background:${res.color}"></span><span style="width:${s.pct.enl}%;background:${enl.color}"></span>`
        : '') + '</div>' +
      `<div class="sc-fac"><span>${enl.name}</span><b>${full(s.mu.enl)} MU</b>${pct(ready ? s.pct.enl : null)}</div>` +
      (s.status !== 'ready' ? `<div class="sc-warn">${STATUS_LONG[s.status] || STATUS_LONG.unavailable}</div>` : '') +
      '<div class="pd-h">Поля</div><div class="sc-rows">' +
      `<div><span>Действующих в мире</span><b>${full(s.fields)}</b></div>` +
      (s.processed != null && s.fields != null && s.processed !== s.fields
        ? `<div><span>Посчитано</span><b>${full(s.processed)} из ${full(s.fields)}</b></div>` : '') +
      (extra ? `<div class="sc-sub">${extra}</div>` : '') +
      '</div></div>';
  }

  // ---- rating: one list per tab, each with its own cursor ----
  const blank = () => ({ rows: [], self: null, asOf: null, next: null, at: 0, loading: false, err: null, ctrl: null });
  const ratings = { links: blank(), fields: blank() };

  // more: the next page of the same snapshot; otherwise the list from the top
  async function loadRating(kind, more) {
    const r = ratings[kind];
    if (more && (!r.next || r.loading)) return;
    r.ctrl?.abort();
    const ctrl = r.ctrl = new AbortController();
    r.loading = true; r.err = null;
    if (modal.isOpen && tab === kind) renderPane();
    try {
      const page = adaptRating(await getRating(kind, more ? r.next : null, ctrl.signal));
      if (more) r.rows = r.rows.concat(page.rows);
      else { r.rows = page.rows; r.at = Date.now(); }
      r.self = page.self; r.asOf = page.asOf; r.next = page.next;
    } catch (e) {
      if (e?.name === 'AbortError') return;
      // the snapshot behind the cursor is gone: start over, never append to it
      if (more && (e?.code === 'leaderboard_snapshot_expired' || e?.code === 'invalid_cursor')) {
        r.loading = false; r.ctrl = null;
        loadRating(kind, false);
        return;
      }
      r.err = e?.code === 'leaderboard_not_ready' ? 'Рейтинг ещё не готов, попробуйте чуть позже.'
        : 'Не удалось загрузить рейтинг: ' + errText(e?.code, e?.retryAfter);
    }
    if (r.ctrl !== ctrl) return;
    r.loading = false; r.ctrl = null;
    if (modal.isOpen && tab === kind) renderPane();
  }

  function renderRating(pane, kind) {
    const r = ratings[kind], R = RATING[kind];
    modal.setTitle(R.title + (r.asOf ? ' · на ' + hm(r.asOf) : ''));
    const bar = '<div class="rt-bar"><span>Мировой рейтинг агентов</span>' +
      `<button type="button" class="rt-btn" data-act="reload"${r.loading ? ' disabled' : ''}>обновить</button></div>`;
    if (!r.rows.length && !r.self) {
      pane.innerHTML = bar + `<div class="lm-empty">${r.loading ? 'загрузка…' : esc(r.err || 'В рейтинге пока никого нет.')}</div>`;
      return;
    }
    const value = (n) => (kind === 'fields'
      ? `<b class="rt-v" title="${full(n)} MU">${fmt(n)}</b>` : `<b class="rt-v">${full(n)}</b>`);
    const row = (a, me) => {
      const col = fcol(a.faction);
      return `<div class="rt-row${me ? ' me' : ''}">` +
        `<span class="rt-rank">${a.rank ?? '—'}</span>` +
        `<span class="rt-lvl" style="color:${col};border-color:${col}" title="уровень">${a.level ?? '?'}</span>` +
        `<span class="rt-nick">${agentLink(a.nick, { id: a.id, color: col })}</span>` +
        (a.score != null ? value(a.score) : '') + '</div>';
    };
    const list = r.rows.length ? r.rows.map((a) => row(a, a.self)).join('')
      : '<div class="lm-empty">В рейтинге пока никого нет.</div>';
    // own place when it isn't among the loaded rows
    const s = r.self;
    let mine = '';
    if (s && !r.rows.some((a) => a.self)) {
      const text = s.status === 'ranked' ? `${s.rank}-е место · ${R.unit(s.score)}`
        : s.status === 'unranked' ? R.none : 'вы пока не учитываетесь';
      mine = `<div class="rt-self"><span class="rt-self-h">Вы:</span> ${text}</div>`;
    }
    const tail = r.next
      ? `<button type="button" class="rt-more" data-act="more"${r.loading ? ' disabled' : ''}>${r.loading ? 'загрузка…' : 'загрузить ещё'}</button>`
      : '';
    pane.innerHTML = bar + `<div class="rt-list">${list}</div>` + tail +
      (r.err ? `<div class="sc-warn">${esc(r.err)}</div>` : '') + mine;
  }

  load();
  setInterval(() => { if (!document.hidden) load(); }, Math.max(POLL_MS, MAP.refreshMs));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
}
