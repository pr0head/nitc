// World MU balance, top centre: a two-colour bar with both factions' MU; a
// click opens the score window.
//
// The server reads it from a background snapshot; we poll once a minute with
// ETag, paused in a hidden tab. Statuses other than "ready" show their state
// instead of percents (the API leaves them null — never draw 50/50).
//
// Window: the snapshot time in its header (whatever the status); both
// factions with MU and share; what a non-ready status means; the world's
// fields and how many are counted.
import { FACTION, MAP } from '../config.js';
import { getScore } from '../api/intel.js';
import { adaptScore } from '../adapter/model.js';
import { createListModal } from './dialog.js';

const POLL_MS = 60000;
const TITLE = 'Мировой счёт MU';
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
const fmt = (n) => (n == null ? '?' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'
  : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n.toLocaleString('ru-RU'));
const full = (n) => (n == null ? '?' : n.toLocaleString('ru-RU'));
const hm = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function mountScore(container) {
  const el = document.createElement('div');
  el.className = 'score';
  el.hidden = true; // until the first answer
  el.title = 'Мировой счёт — подробнее';
  container.append(el);

  const modal = createListModal(TITLE, 'sc-box');
  let last = null;

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
      if (modal.isOpen) renderModal();
    } catch { /* keep the last bar */ }
  }

  el.addEventListener('click', () => { modal.open(); renderModal(); });

  function renderModal() {
    const s = last;
    if (!s) { modal.setTitle(TITLE); modal.list.innerHTML = '<div class="lm-empty">загрузка…</div>'; return; }
    modal.setTitle(`${TITLE} · ${s.asOf ? 'на ' + hm(s.asOf) : 'время неизвестно'}`);
    const res = FACTION.res, enl = FACTION.enl;
    const ready = s.status === 'ready' && s.pct.res != null && s.pct.enl != null;
    const pct = (v) => (v == null ? '' : `<span class="sc-pct">${v.toFixed(1)}%</span>`);
    const extra = [
      s.pending ? `ждут расчёта: ${full(s.pending)}` : '',
      s.unresolved ? `не определены: ${full(s.unresolved)}` : '',
    ].filter(Boolean).join(' · ');

    modal.list.innerHTML = '<div class="sc">' +
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

  load();
  setInterval(() => { if (!document.hidden) load(); }, Math.max(POLL_MS, MAP.refreshMs));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
}
