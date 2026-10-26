// Agent card: a click on a nickname (portal card: owner, resonators, mods;
// COMM: the event's author) → GET /v1/intel/agents → a modal with level and
// AP, current holdings, then two tabs: medals, and lifetime statistics grouped
// the way the game client groups them.
//
// Profiles come with no-store (no ETag), so we keep the last answers in memory
// for a minute instead of refetching on every click. A nickname that no longer
// exists (renamed, system author) is a 404: say so in the card.
//
// Medals have no images in the API (only logical artwork keys): a tier chip in
// the tier colour stands in. The earned tier is the server's; thresholds only
// show the way to the next one.
import './agent-card.css';
import { FACTION } from '../config.js';
import { getAgent } from '../api/intel.js';
import { adaptAgent } from '../adapter/model.js';
import { fcol } from '../map/render.js';
import { bus } from '../state/bus.js';
import { createListModal } from './dialog.js';
import { esc } from './esc.js';

const TTL_MS = 60000;
const TIERS = [
  null,
  { name: 'Bronze', color: '#cd7f32' },
  { name: 'Silver', color: '#c0c6cc' },
  { name: 'Gold', color: '#ffd24a' },
  { name: 'Platinum', color: '#d8e6f0' },
  { name: 'Onyx', color: '#1b1b1b', dark: true },
];
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
  xm_recharged: 'Перезаряжено XM',
  xm_spent_recharging: 'XM на перезарядку',
  longest_hack_streak: 'Самая длинная серия хаков',
  guardian_days: 'Удержание портала',
  glyph_points: 'Очки глифов',
  distance_walked: 'Пройдено',
  xm_collected: 'Собрано XM',
  mu_captured: 'Захвачено MU',
};
// statistics sections, as in the game client; codes not listed here (and any
// new ones) go to "Прочее"
const GROUPS = [
  ['Мои MU', ['mu_captured']],
  ['Исследование', ['unique_visits', 'unique_captures', 'distance_walked']],
  ['Строительство', ['portals_captured', 'resonators_deployed', 'mods_deployed', 'links_created', 'fields_created']],
  ['Взлом и ресурсы', ['hacks', 'glyph_points', 'xm_recharged', 'xm_spent_recharging', 'xm_collected', 'longest_hack_streak']],
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
function fmtValue(m) {
  if (m.value == null) return '<span class="ag-dim">—</span>';
  const v = m.value;
  switch (m.unit) {
    case 'metres': return v >= 1000 ? `${n(+(v / 1000).toFixed(1))} км` : `${n(v)} м`;
    case 'xm': return `${n(v)} XM`;
    case 'mu': return `${n(v)} MU`;
    case 'periods_24h': return `${n(v)} дн.`;
    default: return n(v);
  }
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
  const cache = new Map(); // 'id:…' | 'nick:…' → { at, agent }
  let reqId = 0, ctrl = null;
  let tab = 'medals'; // kept between cards

  bus.on('openAgent', open);
  modal.list.addEventListener('click', (e) => {
    const b = e.target.closest('.seg button');
    if (!b) return;
    tab = b.dataset.tab;
    modal.list.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    modal.list.querySelectorAll('.ag-pane').forEach((p) => { p.hidden = p.dataset.tab !== tab; });
  });

  async function open({ id, nick }) {
    if (!id && !nick) return;
    const my = ++reqId;
    ctrl?.abort(); ctrl = new AbortController();
    modal.setTitle(nick || 'Агент');
    modal.open();
    const key = id ? 'id:' + id : 'nick:' + nick.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) { render(hit.agent); return; }
    modal.list.innerHTML = '<div class="lm-empty">загрузка…</div>';
    try {
      const a = adaptAgent(await getAgent({ id, nick }, ctrl.signal));
      if (my !== reqId) return;
      const entry = { at: Date.now(), agent: a };
      cache.set('id:' + a.id, entry);
      cache.set('nick:' + a.nick.toLowerCase(), entry);
      render(a);
    } catch (e) {
      if (e?.name === 'AbortError' || my !== reqId) return;
      modal.list.innerHTML = `<div class="lm-empty">${esc(errText(e, nick))}</div>`;
    }
  }

  function render(a) {
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

    // medals: earned first (by tier), then the rest; progress from the metric
    const byCode = new Map(a.lifetime.map((m) => [m.code, m]));
    const medals = [...a.medals].sort((x, y) => y.tier - x.tier || x.title.localeCompare(y.title));
    if (!medals.length) parts.push(pane('medals', '<div class="lm-empty">Медалей нет.</div>'));
    else {
      const earned = medals.filter((m) => m.tier > 0).length;
      parts.push(pane('medals', `<div class="ag-sub">Получено ${earned} из ${medals.length}</div><div class="ag-medals">` + medals.map((m) => {
        const t = TIERS[m.tier];
        const v = byCode.get(m.metric)?.value;
        const goal = m.thresholds[m.tier]; // the next tier's threshold
        const prog = m.tier >= 5 ? 'макс.' : v != null && goal ? `${n(v)} / ${n(goal)}` : '';
        const cls = t ? (t.dark ? ' ag-dark' : '') : ' ag-none';
        return `<div class="ag-medal${cls}" title="${esc(m.desc)}">` +
          `<span class="ag-tier"${t ? ` style="background:${t.color}"` : ''}>${t ? t.name : '—'}</span>` +
          `<span class="ag-mt">${esc(m.title)}</span><span class="ag-mp">${prog}</span></div>`;
      }).join('') + '</div>'));
    }

    // lifetime statistics by section, only what the server tracks; coverage in
    // the tooltip (partial history is not "all time", and null is not 0)
    const tracked = a.lifetime.filter((m) => m.available);
    const trackedBy = new Map(tracked.map((m) => [m.code, m]));
    const row = (m) => {
      const since = m.from ? ` с ${new Date(m.from).toLocaleDateString('ru-RU')}` : '';
      return `<div class="ag-st" title="${esc((COVERAGE[m.coverage] || m.coverage) + since)}">` +
        `<span>${esc(METRIC[m.code] || m.code)}</span><span>${fmtValue(m)}</span></div>`;
    };
    const listed = new Set(GROUPS.flatMap(([, codes]) => codes));
    const sections = [
      ...GROUPS.map(([title, codes]) => [title, codes.map((c) => trackedBy.get(c)).filter(Boolean)]),
      ['Прочее', tracked.filter((m) => !listed.has(m.code))],
    ].filter(([, ms]) => ms.length);
    parts.push(pane('stats', sections.length
      ? sections.map(([title, ms]) => `<div class="ag-sub">${title}</div><div class="ag-stats">${ms.map(row).join('')}</div>`).join('')
      : '<div class="lm-empty">Статистики нет.</div>'));
    modal.list.innerHTML = '<div class="ag">' + parts.join('') + '</div>';
  }
}

// A nickname that opens the agent card. Callers' click handlers catch
// `.ag-link` and emit 'openAgent' with its data.
export function agentLink(nick, { id = null, color = '' } = {}) {
  if (!nick) return '';
  return `<a href="#" class="ag-link" data-nick="${esc(nick)}"${id ? ` data-id="${esc(id)}"` : ''}` +
    `${color ? ` style="color:${color}"` : ''}>${esc(nick)}</a>`;
}
