// Agent card: a click on a nickname (portal card: owner, resonators, mods;
// COMM: the event's author) → GET /v1/intel/agents → a modal with level and
// AP, current holdings, then two tabs: medals, and lifetime statistics grouped
// the way the game client groups them.
//
// Profiles come with no-store (no ETag), so we keep the last answers in memory
// for a minute instead of refetching on every click. A nickname that no longer
// exists (renamed, system author) is a 404: say so in the card.
//
// Medals: the profile lists them; while the medals tab is in view a second
// request (/agents/{id}/medals, cached with the profile) adds the server's
// pictures, tier dates and progress. Two blocks: one-off awards (one tier or
// no metric — Alpha Tester, events) and the tiered medals, each in the
// server's order (the same place on every card), grey when not earned. The
// earned tier is the server's; thresholds only show the way to the next one.
// Our own vector set (medal-art.js) stands in until the pictures come, and
// for a picture that fails to load. Details in the tooltip, and under the
// grid on a tap (no hover on a phone).
import './agent-card.css';
import { FACTION, TRACK } from '../config.js';
import { getAgent, getAgentMedals } from '../api/intel.js';
import { adaptAgent, adaptMedals } from '../adapter/model.js';
import { fcol } from '../map/render.js';
import { bus } from '../state/bus.js';
import { tracks, ago } from '../state/tracks.js';
import { createListModal } from './dialog.js';
import { medalSvg } from './medal-art.js';
import { esc } from './esc.js';

const TTL_MS = 60000;
const TIERS = ['не получена', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Onyx'];
const CREDIT = '<div class="ag-credit">Значки: DabelCODY, ' +
  '<a href="https://github.com/cr0ybot/ingress-logos" target="_blank" rel="noopener">ingress-logos</a>, ' +
  '<a href="https://creativecommons.org/licenses/by-nc-sa/3.0/" target="_blank" rel="noopener">CC BY-NC-SA 3.0</a></div>';
// the medal details line keeps its room while empty: a tap shows them
// without the card growing a scrollbar
const HINT = 'Нажмите на медаль — уровень, прогресс и описание';
const METRIC = {
  hacks: 'Хаки',
  resonators_deployed: 'Установлено резонаторов',
  mods_deployed: 'Установлено модов',
  portals_captured: 'Захвачено порталов',
  unique_visits: 'Уникальные посещения',
  unique_captures: 'Уникальные захваты',
  links_created: 'Создано линков',
  fields_created: 'Создано полей',
  resonators_destroyed: 'Уничтожено резонаторов',
  portals_neutralized: 'Нейтрализовано порталов',
  links_destroyed: 'Уничтожено линков',
  fields_destroyed: 'Уничтожено полей',
  xm_spent_recharging: 'XM на перезарядку',
  longest_hack_streak: 'Самая длинная серия хаков',
  glyph_points: 'Очки глифов',
  distance_walked: 'Пройдено',
  xm_collected: 'Собрано XM',
  mu_captured: 'Захвачено MU',
};
// statistics sections, as in the game client; codes not listed here are not
// shown
const GROUPS = [
  ['Мои MU', ['mu_captured']],
  ['Исследование', ['unique_visits', 'unique_captures', 'distance_walked']],
  ['Строительство', ['portals_captured', 'resonators_deployed', 'mods_deployed', 'links_created', 'fields_created']],
  ['Взлом и ресурсы', ['hacks', 'glyph_points', 'xm_spent_recharging', 'xm_collected', 'longest_hack_streak']],
  ['Боевые действия', ['resonators_destroyed', 'portals_neutralized', 'links_destroyed', 'fields_destroyed']],
];
const TABS = [['medals', 'Медали'], ['stats', 'Статистика']];
const CURRENT = { active_portals: 'порталы', active_links: 'линки', active_fields: 'поля', resonators: 'резонаторы', mods: 'моды' };
const COVERAGE = {
  since_registration: 'с регистрации',
  since_epoch: 'с начала текущей эпохи',
  partial_history: 'неполная история',
  current_snapshot: 'текущее состояние',
  unknown: 'полнота неизвестна',
};

const n = (v) => v.toLocaleString('ru-RU');
function unitText(v, unit) {
  switch (unit) {
    case 'metres': return v >= 1000 ? `${n(+(v / 1000).toFixed(1))} км` : `${n(v)} м`;
    case 'xm': return `${n(v)} XM`;
    case 'mu': return `${n(v)} MU`;
    case 'periods_24h': return `${n(v)} дн.`;
    default: return n(v);
  }
}
const fmtValue = (m) => (m.value == null ? '<span class="ag-dim">—</span>' : unitText(m.value, m.unit));
const when = (t) => new Date(t).toLocaleString('ru-RU',
  { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

// a tiered medal's way to the next tier, 0..1 (1 at the top tier), as in
// the game: the value against the next threshold; null when unknown
function medalShare(m, byCode) {
  if (m.special) return null;
  if (m.tier >= 5) return 1;
  const p = m.progress;
  if (p) return p.next == null ? (m.tier > 0 ? 1 : null) : p.next > 0 ? Math.min(1, p.value / p.next) : null;
  const v = byCode.get(m.metric)?.value;
  const goal = m.thresholds[m.tier];
  return v != null && goal ? Math.min(1, v / goal) : null;
}

// a medal's details, one fact per line: tier and progress, when each tier
// came, the description, notes. byCode: the profile's lifetime metrics, the
// progress source while the server's own has not come
function medalDet(m, byCode) {
  const lines = [];
  const arch = (w) => (w.archive ? ' (по архиву)' : '');
  const awards = m.awards || [];
  if (m.special) {
    const w = awards[awards.length - 1];
    lines.push(m.title + (w ? ` · получена ${when(w.at)}${arch(w)}` : m.tier ? '' : ' · не получена'));
  } else {
    const p = m.progress;
    let prog = '';
    if (m.tier >= 5 || (p && p.next == null && m.tier > 0)) prog = 'макс.';
    // the unit once, after the goal, unless the two may differ (м / км)
    else if (p && p.next != null) {
      prog = `${p.unit === 'metres' ? unitText(p.value, p.unit) : n(p.value)} / ${unitText(p.next, p.unit)} до ${TIERS[m.tier + 1]}`;
    }
    else {
      const v = byCode.get(m.metric)?.value;
      const goal = m.thresholds[m.tier]; // the next tier's threshold
      if (v != null && goal) prog = `${n(v)} / ${n(goal)}`;
    }
    lines.push([m.title, TIERS[m.tier] || '', prog].filter(Boolean).join(' · '));
    if (awards.length) lines.push(awards.map((w) => `${TIERS[w.tier] || w.tier} ${when(w.at)}${arch(w)}`).join(' · '));
  }
  if (m.desc) lines.push(m.desc);
  const notes = [];
  if (!m.special && m.levelEligible === false) notes.push('не идёт в зачёт уровня');
  if (m.availability === 'mechanic_missing') notes.push('механика пока не реализована');
  if (m.availability === 'historical_only') notes.push('больше не выдаётся');
  if (notes.length) lines.push(notes.join(' · '));
  return lines.join('\n');
}

// the medals tab: the server's medals when loaded, else the profile's
function medalsHtml({ agent: a, medals }) {
  const list = medals || a.medals;
  if (!list.length) return '<div class="lm-empty">Медалей нет.</div>';
  const byCode = new Map(a.lifetime.map((m) => [m.code, m]));
  const badge = (m) => {
    const det = medalDet(m, byCode);
    const share = medalShare(m, byCode);
    const art = m.img ? `<img class="md-art" src="${esc(m.img)}" alt="" decoding="async">` : medalSvg(m.id, m.tier, m.title);
    return `<div class="ag-medal${m.tier > 0 ? '' : ' ag-none'}" title="${esc(det)}" data-det="${esc(det)}" ` +
      `data-id="${esc(m.id)}" data-tier="${m.tier}" data-title="${esc(m.title)}">${art}<span>${esc(m.title)}</span>` +
      (share == null ? '' : `<i class="ag-prog"><b style="width:${(share * 100).toFixed(1)}%"></b></i>`) + '</div>';
  };
  const grid = (ms) => `<div class="ag-medals">${ms.map(badge).join('')}</div>`;
  const special = list.filter((m) => m.special);
  const tiered = list.filter((m) => !m.special);
  const earned = tiered.filter((m) => m.tier > 0).length;
  // the credit is for our own pictures: hidden while none is on the card
  const credit = list.every((m) => m.img) ? CREDIT.replace('<div ', '<div hidden ') : CREDIT;
  return (special.length ? `<div class="ag-sub">Особые награды</div>${grid(special)}` : '') +
    (tiered.length ? `<div class="ag-sub">Медали · получено ${earned} из ${tiered.length}</div>${grid(tiered)}` : '') +
    `<div class="ag-mdet ag-hint">${HINT}</div>` + credit;
}

function errText(e, nick) {
  if (e?.code === 'agent_not_found' || e?.code === 'not_found') {
    return `Агент ${nick ? `«${nick}» ` : ''}не найден: ник мог измениться.`;
  }
  if (e?.code === 'profile_not_ready') return 'Профиль ещё собирается, попробуйте через пару секунд.';
  if (e?.code === 'rate_limited') return 'Слишком много запросов, попробуйте позже.';
  return 'Не удалось загрузить профиль: ' + (e?.code || e?.message || e);
}

export function mountAgentCard() {
  const modal = createListModal('Агент', 'ag-box');
  const cache = new Map(); // 'id:…' | 'nick:…' → { at, agent, medals }
  let reqId = 0, ctrl = null;
  let tab = 'medals'; // kept between cards

  let shown = null; // the cache entry on the card
  bus.on('openAgent', open);
  // a server picture that fails: our own one in its place, with its credit
  modal.list.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('md-art')) return;
    const box = img.closest('.ag-medal');
    img.outerHTML = medalSvg(box.dataset.id, +box.dataset.tier, box.dataset.title);
    modal.list.querySelector('.ag-credit')?.removeAttribute('hidden');
  }, true);
  modal.list.addEventListener('click', (e) => {
    if (e.target.closest('.ag-track')) {
      modal.close();
      bus.emit('focusAgent', { id: shown.agent.id, nick: shown.agent.nick });
      return;
    }
    const md = e.target.closest('.ag-medal');
    if (md) {
      const det = modal.list.querySelector('.ag-mdet');
      const on = !md.classList.contains('sel');
      modal.list.querySelectorAll('.ag-medal.sel').forEach((x) => x.classList.remove('sel'));
      md.classList.toggle('sel', on);
      det.textContent = on ? md.dataset.det : HINT;
      det.classList.toggle('ag-hint', !on);
      return;
    }
    const b = e.target.closest('.seg button');
    if (!b) return;
    tab = b.dataset.tab;
    modal.list.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    modal.list.querySelectorAll('.ag-pane').forEach((p) => { p.hidden = p.dataset.tab !== tab; });
    if (shown) loadMedals(shown);
  });

  // the server's medals, once per cached profile and only while their tab is
  // in view; on failure the tab keeps the profile's medals
  async function loadMedals(entry) {
    const my = reqId;
    if (tab !== 'medals' || entry.medals || entry.medalsReq === my || !entry.agent.id) return;
    entry.medalsReq = my; // a request of an earlier opening is being aborted
    try {
      entry.medals = adaptMedals(await getAgentMedals(entry.agent.id, ctrl.signal));
    } catch {
      return;
    } finally {
      if (entry.medalsReq === my) entry.medalsReq = 0;
    }
    const pane = modal.list.querySelector('.ag-pane[data-tab="medals"]');
    if (my === reqId && shown === entry && pane) pane.innerHTML = medalsHtml(entry);
  }

  async function open({ id, nick }) {
    if (!id && !nick) return;
    const my = ++reqId;
    ctrl?.abort(); ctrl = new AbortController();
    modal.setTitle(nick || 'Агент');
    modal.open();
    const key = id ? 'id:' + id : 'nick:' + nick.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) { render(hit); return; }
    modal.list.innerHTML = '<div class="lm-empty">загрузка…</div>';
    try {
      const a = adaptAgent(await getAgent({ id, nick }, ctrl.signal));
      if (my !== reqId) return;
      const entry = { at: Date.now(), agent: a, medals: null };
      cache.set('id:' + a.id, entry);
      cache.set('nick:' + a.nick.toLowerCase(), entry);
      render(entry);
    } catch (e) {
      if (e?.name === 'AbortError' || my !== reqId) return;
      modal.list.innerHTML = `<div class="lm-empty">${esc(errText(e, nick))}</div>`;
    }
  }

  function render(entry) {
    shown = entry;
    const a = entry.agent;
    modal.setTitle(a.nick);
    const col = fcol(a.faction);
    const fac = FACTION[a.faction]?.name || '';
    const parts = [];

    // level, AP and the way to the next level
    const pct = a.next && a.next.required ? Math.max(0, Math.min(100, (a.ap / a.next.required) * 100)) : 100;
    parts.push('<div class="ag-head">' +
      `<div class="ag-lvl" style="border-color:${col};color:${col}">L${a.level}</div>` +
      `<div class="ag-who"><div class="ag-fac" style="color:${col}">${esc(fac)}</div>` +
      `<div class="ag-ap">${n(a.ap)} AP</div>` +
      `<div class="ag-bar"><span style="width:${pct}%;background:${col}"></span></div>` +
      `<div class="ag-next">${a.next ? `до L${a.next.level}: ${n(a.next.remaining)} AP` : 'максимальный уровень'}</div>` +
      '</div></div>');

    // the tracker: the agent's last place from the loaded COMM, if any
    const tr = tracks.find({ id: a.id, nick: a.nick });
    parts.push(tr
      ? `<button type="button" class="ag-track">Показать на карте · ${esc(ago(tr.last))}</button>`
      : `<div class="ag-track-none">Нет действий в загруженной ленте за ${TRACK.windowMs / 3600000} ч</div>`);

    // what the agent holds right now (a background projection, may lag)
    const cur = a.current.metrics.filter((m) => CURRENT[m.code] && m.available);
    if (cur.length) {
      const note = a.current.status === 'ready' ? '' : ' <span class="ag-dim">(обновляется)</span>';
      parts.push(`<div class="pd-h">Сейчас${note}</div><div class="ag-cur">` + cur.map((m) =>
        `<div><b>${m.available && m.value != null ? n(m.value) : '—'}</b><span>${CURRENT[m.code]}</span></div>`).join('') + '</div>');
    }

    parts.push('<div class="seg">' + TABS.map(([k, t]) =>
      `<button type="button" data-tab="${k}"${k === tab ? ' class="on"' : ''}>${t}</button>`).join('') + '</div>');
    const pane = (k, html) => `<div class="ag-pane" data-tab="${k}"${k === tab ? '' : ' hidden'}>${html}</div>`;

    parts.push(pane('medals', medalsHtml(entry)));

    // lifetime statistics by section, only what the server tracks; coverage in
    // the tooltip (partial history is not "all time", and null is not 0)
    const tracked = a.lifetime.filter((m) => m.available);
    const trackedBy = new Map(tracked.map((m) => [m.code, m]));
    const row = (m) => {
      const since = m.from ? ` с ${new Date(m.from).toLocaleDateString('ru-RU')}` : '';
      return `<div class="ag-st" title="${esc((COVERAGE[m.coverage] || m.coverage) + since)}">` +
        `<span>${esc(METRIC[m.code] || m.code)}</span><span>${fmtValue(m)}</span></div>`;
    };
    const sections = GROUPS.map(([title, codes]) => [title, codes.map((c) => trackedBy.get(c)).filter(Boolean)])
      .filter(([, ms]) => ms.length);
    parts.push(pane('stats', sections.length
      ? sections.map(([title, ms]) => `<div class="ag-sub">${title}</div><div class="ag-stats">${ms.map(row).join('')}</div>`).join('')
      : '<div class="lm-empty">Статистики нет.</div>'));
    modal.list.innerHTML = '<div class="ag">' + parts.join('') + '</div>';
    loadMedals(entry);
  }
}

// A nickname that opens the agent card. Callers' click handlers catch
// `.ag-link` and emit 'openAgent' with its data.
export function agentLink(nick, { id = null, color = '' } = {}) {
  if (!nick) return '';
  return `<a href="#" class="ag-link" data-nick="${esc(nick)}"${id ? ` data-id="${esc(id)}"` : ''}` +
    `${color ? ` style="color:${color}"` : ''}>${esc(nick)}</a>`;
}
