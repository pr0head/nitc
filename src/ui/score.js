// World MU balance, top centre: a two-colour bar with both factions' MU.
// The server reads it from a background snapshot; we poll once a minute with
// ETag, paused in a hidden tab. Statuses other than "ready" show their state
// instead of percents (the API leaves them null — never draw 50/50).
import { FACTION, MAP } from '../config.js';
import { getScore } from '../api/intel.js';
import { adaptScore } from '../adapter/model.js';

const POLL_MS = 60000;
const STATUS = {
  empty: 'нет активных полей',
  partial: 'подсчёт…',
  stale: 'данные устарели',
  disabled: 'счёт отключён',
  unavailable: 'нет данных',
};
const fmt = (n) => (n == null ? '?' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'
  : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n.toLocaleString('ru-RU'));

export function mountScore(container) {
  const el = document.createElement('div');
  el.className = 'score';
  el.hidden = true; // until the first answer
  container.append(el);

  function paint(s) {
    const ready = s.status === 'ready' && s.pct.res != null && s.pct.enl != null;
    const res = FACTION.res, enl = FACTION.enl;
    el.innerHTML =
      `<span class="score-v" style="color:${res.color}">${fmt(s.mu.res)}</span>` +
      '<span class="score-bar">' + (ready
        ? `<span style="width:${s.pct.res}%;background:${res.color}"></span><span style="width:${s.pct.enl}%;background:${enl.color}"></span>`
        : `<span class="score-st">${STATUS[s.status] || STATUS.unavailable}</span>`) + '</span>' +
      `<span class="score-v" style="color:${enl.color}">${fmt(s.mu.enl)}</span>`;
    const pct = (v) => (v == null ? '' : ` (${v.toFixed(1)}%)`);
    const at = s.asOf ? new Date(s.asOf).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';
    el.title = `Мировой счёт MU\n${res.name}: ${s.mu.res?.toLocaleString('ru-RU') ?? '?'} MU${pct(s.pct.res)}\n` +
      `${enl.name}: ${s.mu.enl?.toLocaleString('ru-RU') ?? '?'} MU${pct(s.pct.enl)}\n` +
      `Полей: ${s.fields ?? '?'} · на ${at}`;
    el.hidden = false;
  }

  async function load() {
    try { paint(adaptScore(await getScore())); } catch { /* keep the last bar */ }
  }
  load();
  setInterval(() => { if (!document.hidden) load(); }, Math.max(POLL_MS, MAP.refreshMs));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
}
