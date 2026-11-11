// Link plan: what building the plan on screen takes. The drawing has no link
// directions, so they are chosen here: a link goes toward the end more plan
// links meet at — the anchors collect the keys, the outgoing links stay on the
// other portals. A portal that can't reach (its level on the map is too low)
// hands the link to the other end when that one can; a portal over the
// outgoing limit hands links to neighbours with room left. That is one way to
// build it, not the only one (anchors can throw links too, crews can split),
// so any link can be turned by hand: a turned link is pinned, kept as it is,
// and the automatic choice works around it. Between ends alike (as many
// links each, two anchors of a base), the link goes from a portal not ours to
// one that is: the one not ours is visited anyway, to be taken.
//
// A pinned direction lives in the plan itself, on each shape that has that
// side: shape.nitc.dir[i] is 1 when side i (vertex i → i+1) is thrown from
// its first vertex, 0 from its second, null when left to the automatic
// choice. Other tools ignore the field, so the plan stays plain DrawTools.
// The order the links are thrown in is draw-linkorder.js's; one set by hand
// lives alongside, in shape.nitc.step.
//
// Out of it: per portal the keys needed (one per incoming link), the outgoing
// count against the limit, the longest outgoing link and what it takes — the
// mean resonator level, how many level-8 agents make it, or a link-range boost
// past what P8 gives. Plus portals, links, fields and the AP for building them.
//
// Levels come from the loaded map: the portal level is the floor of the mean,
// so a link up to P(level) range is sure, one up to P(level+1) may be, and the
// card has the exact range with link amps. Portals known only as link ends
// have no level.
import L from 'leaflet';
import { GAME } from '../config.js';
import { distanceM, geodesicPath, midpoint } from '../map/geo.js';
import { keyOf } from './draw-snap.js';
import { rangeMods } from '../state/mods.js';
import { orderSteps } from './draw-linkorder.js';
import { esc } from '../ui/esc.js';
import { me } from '../state/me.js';

const rangeOf = (mean) => GAME.linkRangeBaseM * mean ** 4;
const RANGE8 = rangeOf(8);
const plural = (n, one, few, many) => {
  const d = n % 10, h = n % 100;
  return n + ' ' + (d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many);
};
const fmtLen = (m) => (m >= 1000 ? (m / 1000).toFixed(m >= 100000 ? 0 : 1) + ' км' : Math.round(m) + ' м');
const fmtNum = (n) => n.toLocaleString('ru-RU');

// the fewest level-8 agents whose resonators make a portal of this mean level
const AGENTS = (() => {
  const out = [];
  for (let k = 1; k <= 8; k++) {
    const r = [];
    for (let l = 8; l >= 1; l--) for (let i = 0; i < GAME.resoPerAgent[l] * k; i++) r.push(l);
    out.push(r.slice(0, 8).reduce((s, v) => s + v, 0) / 8); // best mean k agents reach
  }
  return out;
})();
const agentsFor = (mean) => AGENTS.findIndex((m) => m >= mean - 1e-9) + 1;

// the fewest of the known range mods (strongest first) that boost range by b,
// at most n of them; among as few, the cheapest: SoftBank (worth more than its
// range) last, then the lower rarity, then the smaller boost → [mods] or null
const RANK = { common: 0, rare: 1, very_rare: 2 };
const cost = (ms, m) => [ms.length, ms.filter((x) => x.type === 'softbank').length, ms.reduce((s, x) => s + (RANK[x.rarity] ?? 1), 0), m];
const less = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
function ampsFor(b, n, mods) {
  if (b <= 1) return [];
  let best = null, bestC = null;
  const picked = [];
  (function rec(from) {
    if (picked.length) {
      const m = picked.reduce((s, x, i) => s + x.range * (GAME.stackLinkAmp[i] ?? 0), 0);
      if (m >= b - 1e-9) {
        const c = cost(picked, m);
        if (!best || less(c, bestC)) { best = picked.slice(); bestC = c; }
        return;
      }
    }
    if (picked.length >= n || (best && picked.length >= best.length)) return;
    for (let i = from; i < mods.length; i++) { picked.push(mods[i]); rec(i); picked.pop(); }
  })(0);
  return best;
}

// what a link of len metres takes from its portal: the level and agents for
// it without mods (or P8 and a boost past that), and the ways with fewer
// agents and range mods (state/mods.js). Each agent deploys up to 2 mods, 4
// in all.
function need(len) {
  const mean = Math.max(1, (len / GAME.linkRangeBaseM) ** 0.25);
  const mods = rangeMods();
  const way = (k) => {
    const b = len / rangeOf(AGENTS[k - 1]);
    if (!mods.length) return { agents: k, boost: b };
    const amps = ampsFor(b, Math.min(4, GAME.modsPerAgent * k), mods);
    return amps && { agents: k, amps };
  };
  const out = mean <= 8 ? { mean, agents: agentsFor(mean) } : { boost: len / RANGE8, agents: 8, amps: mods.length ? way(8)?.amps : null };
  // the two fewest-agent ways with mods
  out.alts = [];
  for (let k = 1; k < out.agents && out.alts.length < (mods.length ? 2 : 1); k++) {
    const w = way(k);
    if (w) out.alts.push(w);
  }
  if (mean > 8 && mods.length && !out.amps) out.unreachable = true;
  return out;
}

const RAR = { common: 'Common', rare: 'Rare', very_rare: 'VR' };
// mods as text: "2× Rare Link Amp + VR Link Amp"
function ampsText(amps) {
  // the rarity only where one name comes in several
  const all = rangeMods();
  const groups = [];
  for (const m of amps) {
    const g = groups.find((x) => x.m.kind === m.kind);
    if (g) g.n++; else groups.push({ m, n: 1 });
  }
  return groups.map(({ m, n }) => {
    const r = RAR[m.rarity];
    const name = r && all.some((x) => x.name === m.name && x.rarity !== m.rarity) ? `${r} ${m.name}` : m.name;
    return (n > 1 ? `${n}× ` : '') + name;
  }).join(' + ');
}
const wayText = (w) => `${plural(w.agents, 'агент', 'агента', 'агентов')} + ` + (w.amps ? ampsText(w.amps) : `усиление ×${w.boost.toFixed(1)}`);

// does the portal reach len: true, false, 'maybe' (its mean level is between
// two levels), or null (no level known)
function reach(p, len) {
  if (!p.level) return null;
  if (len <= rangeOf(p.level)) return true;
  return len > rangeOf(Math.min(8, p.level + 1)) ? false : 'maybe';
}

// portals seen in any load, by spot: a plan vertex off screen keeps its name
// and level (the last ones seen)
const known = new Map();

// model: the draw tools' shapes; data: the loaded map → the plan, built
export function linkPlan(model, data) {
  for (const p of data.corners || []) if (Number.isFinite(p.lat) && !known.get(keyOf(p))?.name) known.set(keyOf(p), p);
  for (const p of data.portals) if (Number.isFinite(p.lat)) known.set(keyOf(p), p);

  const portals = new Map();
  const portal = (v) => {
    const k = keyOf(v);
    if (!portals.has(k)) {
      const p = known.get(k);
      portals.set(k, {
        key: k, lat: +v.lat, lng: +v.lng, id: p?.id, name: p?.name || '', faction: p?.faction,
        // a level counts once all 8 resonators stand: an incomplete portal can't link
        level: p?.level && p.resoCount === 8 ? p.level : 0, onPortal: !!p,
        resos: p?.resoCount ?? null, // null: a link end seen from afar, count unknown
        deg: 0, inc: 0, out: 0, longest: 0,
      });
    }
    return portals.get(k);
  };
  const edges = new Map();
  const fields = new Map(); // by its corners → {ps, edges}
  for (const s of model) {
    const v = s.latLngs, n = v.length;
    const m = s.type === 'polygon' ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const a = portal(v[i]), b = portal(v[(i + 1) % n]);
      if (a === b) continue;
      const id = a.key < b.key ? a.key + '|' + b.key : b.key + '|' + a.key;
      const d = s.nitc?.dir?.[i];
      let e = edges.get(id);
      if (!e) {
        e = { id, a, b, len: distanceM([a.lat, a.lng], [b.lat, b.lng]), sides: [], pin: null, step: null };
        edges.set(id, e);
        a.deg++; b.deg++;
      }
      e.sides.push({ s, i, first: a });
      if (e.pin == null && (d === 0 || d === 1)) e.pin = d === 1 ? a : b; // the first shape that says wins
      const st = s.nitc?.step?.[i];
      if (e.step == null && Number.isInteger(st) && st > 0) e.step = st;
    }
    if (s.type === 'polygon' && n === 3) {
      const ps = v.map(portal);
      const ks = ps.map((p) => p.key);
      const id = ks.slice().sort().join('|');
      if (new Set(ks).size === 3 && !fields.has(id)) {
        const eid = (x, y) => (x.key < y.key ? x.key + '|' + y.key : y.key + '|' + x.key);
        fields.set(id, { ps, edges: [eid(ps[0], ps[1]), eid(ps[1], ps[2]), eid(ps[2], ps[0])] });
      }
    }
  }

  // directions: toward the busier end; reach and the outgoing limit correct it
  const links = [...edges.values()];
  for (const e of links) {
    if (e.pin) {
      e.from = e.pin; e.to = e.pin === e.a ? e.b : e.a; e.from.out++; e.to.inc++;
      continue;
    }
    const ours = (p) => holdOf(p) === 'mine';
    const aFirst = e.a.deg !== e.b.deg ? e.a.deg < e.b.deg
      : ours(e.a) !== ours(e.b) ? !ours(e.a) : e.a.key < e.b.key;
    let [from, to] = aFirst ? [e.a, e.b] : [e.b, e.a];
    if (reach(from, e.len) === false && reach(to, e.len) !== false) [from, to] = [to, from];
    e.from = from; e.to = to; from.out++; to.inc++;
  }
  for (let guard = links.length * 2; guard > 0; guard--) {
    const over = [...portals.values()].find((p) => p.out > GAME.outLinks && links.some((e) => !e.pin && e.from === p && e.to.out < GAME.outLinks && reach(e.to, e.len) !== false));
    if (!over) break;
    const e = links.filter((x) => !x.pin && x.from === over && x.to.out < GAME.outLinks && reach(x.to, x.len) !== false)
      .sort((x, y) => x.to.out - y.to.out)[0];
    e.from.out--; e.to.inc--;
    [e.from, e.to] = [e.to, e.from];
    e.from.out++; e.to.inc++;
  }
  for (const e of links) e.from.longest = Math.max(e.from.longest, e.len);

  const list = [...portals.values()].sort((x, y) => y.inc - x.inc || y.out - x.out || y.longest - x.longest);
  // anchors: where the most plan links meet, whichever way they are thrown —
  // a base link between two anchors counts for both (at least 3 links, and
  // not one of many alike)
  const top = Math.max(0, ...list.map((p) => p.deg));
  for (const p of list) {
    p.anchor = p.deg >= 3 && p.deg * 2 >= top;
    p.need = p.longest ? need(p.longest) : null;
    p.reach = p.longest ? reach(p, p.longest) : true;
  }
  const r = {
    portals: list, links,
    fieldList: [...fields.values()],
    fields: fields.size,
    keys: links.length,
    ap: links.length * GAME.apMake.link + fields.size * GAME.apMake.field,
    pinned: links.filter((e) => e.pin).length,
    overLimit: list.filter((p) => p.out > GAME.outLinks).length,
    short: list.filter((p) => p.reach === false).length,
    loose: list.filter((p) => !p.onPortal).length,
  };
  r.order = orderSteps(r);
  return r;
}

// ---- pinning ----
// throw link e from its other end, pinned so: written on every shape with that side
export function flipLink(e) {
  const from = e.to;
  for (const { s, i, first } of e.sides) {
    const n = s.type === 'polygon' ? s.latLngs.length : s.latLngs.length - 1;
    const dir = Array.from({ length: n }, (_, k) => s.nitc?.dir?.[k] ?? null);
    dir[i] = first === from ? 1 : 0;
    s.nitc = { ...s.nitc, dir };
  }
}
// every link back to the automatic choice: of direction (dir) or order (step)
export function unpinAll(model, field = 'dir') {
  for (const s of model) {
    if (!s.nitc) continue;
    delete s.nitc[field];
    if (!Object.keys(s.nitc).length) delete s.nitc;
  }
}
// the order as it is now, with step i moved by d (-1 up, +1 down), pinned:
// every link gets its step's number
export function moveStep(r, i, d) {
  const st = r.order.steps.slice();
  const j = i + d;
  if (j < 0 || j >= st.length) return;
  [st[i], st[j]] = [st[j], st[i]];
  st.forEach((s, k) => {
    for (const e of s.links) {
      for (const { s: sh, i: side } of e.sides) {
        const n = sh.type === 'polygon' ? sh.latLngs.length : sh.latLngs.length - 1;
        const step = Array.from({ length: n }, (_, x) => sh.nitc?.step?.[x] ?? null);
        step[side] = k + 1;
        sh.nitc = { ...sh.nitc, step };
      }
    }
  });
}
// an imported shape's nitc field, checked: → the field to keep, or undefined
export function cleanNitc(it) {
  const n = it.type === 'polygon' ? it.latLngs.length : it.latLngs.length - 1;
  const out = {};
  const take = (k, ok) => {
    const a = it.nitc?.[k];
    if (Array.isArray(a) && a.length === n && a.every((x) => x == null || ok(x)) && a.some((x) => x != null)) out[k] = a.map((x) => x ?? null);
  };
  take('dir', (x) => x === 0 || x === 1);
  take('step', (x) => Number.isInteger(x) && x > 0);
  return Object.keys(out).length ? out : undefined;
}

// ---- the panel tab ----
// cross: what the crossings check found ({links, self, partial}) — the plan
// can't be built as drawn while something crosses it; a tap goes to the sky tab
// view: 'portals' (keys, outgoing, range per portal) or 'steps' (the order);
// done: the link run's done links (ticks in the steps)
export function planHtml(r, focusKey, unfocus, cross, view = 'portals', done = new Set()) {
  const parts = [];
  parts.push(`<div class="dx-sum lp-sum"><b>${plural(r.portals.length, 'портал', 'портала', 'порталов')}</b> · ` +
    `<b>${plural(r.links.length, 'линк', 'линка', 'линков')}</b> · <b>${plural(r.fields, 'поле', 'поля', 'полей')}</b><br>` +
    `За постройку ≈ ${fmtNum(r.ap)} AP. Ключей всего: ${r.keys}.</div>`);
  const warn = [];
  const go = (t) => `<button type="button" class="lp-go" data-go="cross">${esc(t)} →</button>`;
  if (cross?.links) warn.push(go(`План пересекают ${plural(cross.links, 'линк', 'линка', 'линков')} — сначала их нужно убрать (вкладка «Небо»)`));
  if (cross?.self) warn.push(go(`План пересекает сам себя: ${plural(cross.self, 'раз', 'раза', 'раз')} — один из линков не построить`));
  if (cross?.partial && !cross.links && !cross.self) warn.push(go('Пересечения проверены не полностью (вкладка «Небо»)'));
  if (r.overLimit) warn.push(esc(`${plural(r.overLimit, 'портал', 'портала', 'порталов')} с исходящими сверх ${GAME.outLinks} — нужен SoftBank Ultra Link`));
  if (r.short) warn.push(esc(`${plural(r.short, 'портал', 'портала', 'порталов')} не добивают по уровню на карте — нужно поднять уровень или поставить Link Amp`));
  const bad = r.order.steps.filter((x) => x.bad).length;
  if (bad) warn.push(esc(`${plural(bad, 'шаг', 'шага', 'шагов')} в этом порядке не сделать: портал уже под полем — разверните линк или переставьте шаги`));
  if (r.order.lost) warn.push(esc(`${plural(r.order.lost, 'поле', 'поля', 'полей')} в этом порядке не образуется: линк делает только одно поле с каждой стороны — переставьте шаги`));
  if (r.loose) warn.push(esc(`${plural(r.loose, 'вершина', 'вершины', 'вершин')} без данных о портале — приблизьте карту к ним`));
  if (warn.length) parts.push(`<ul class="dx-why">${warn.map((w) => `<li>${w}</li>`).join('')}</ul>`);
  parts.push(`<div class="seg lp-view"><button type="button" data-view="portals" class="${view === 'steps' ? '' : 'on'}">Порталы</button>` +
    `<button type="button" data-view="steps" class="${view === 'steps' ? 'on' : ''}">Шаги ${r.order.steps.length}</button></div>`);
  if (view === 'steps') { parts.push(stepsHtml(r, focusKey, done)); return parts.join(''); }

  const anchors = r.portals.filter((p) => p.anchor), rest = r.portals.filter((p) => !p.anchor);
  if (anchors.length) {
    parts.push('<div class="dx-h">Опорные</div>');
    anchors.forEach((p) => parts.push(row(p, focusKey, unfocus, r.links)));
  }
  if (rest.length) {
    parts.push(`<div class="dx-h">${anchors.length ? 'Остальные' : 'Порталы'}</div>`);
    rest.forEach((p) => parts.push(row(p, focusKey, unfocus, r.links)));
  }
  if (r.pinned) parts.push(`<button type="button" class="lp-unpin">Сбросить ручные направления (${r.pinned})</button>`);
  parts.push('<div class="dx-note">Направления выбраны автоматически: линки идут к опорным порталам, ключи нужны от них, исходящие — с остальных. ' +
    'Стрелки выходят из портала, с которого кидается линк, и указывают, куда. Нажмите на стрелку или на ⇄ в строке портала, чтобы развернуть линк: ' +
    'развёрнутый закрепляется (стрелка в красной обводке), остальные подстраиваются. Уровни взяты с карты; точная дальность с модами — в карточке портала.</div>');
  return parts.join('');
}

// a step's number, a tick once its links are done
const stepNo = (st, done) => (st.links.every((e) => done.has(e.id)) ? '<b class="lp-n ok">✓</b>' : `<b class="lp-n">${st.n}</b>`);

// the order: a row per step, with ↑↓ to move it
function stepsHtml(r, focusKey, done) {
  const { steps, manual } = r.order;
  const parts = [];
  const nDone = r.links.filter((e) => done.has(e.id)).length;
  if (steps.length) {
    parts.push('<div class="lp-run">' + `<button type="button" class="lp-unpin lp-start">▶ ${nDone ? 'Продолжить' : 'Начать'} линковку</button>` +
      (nDone ? `<button type="button" class="lp-unpin lp-reprog" title="Снять все отметки">Сбросить ${nDone}/${r.links.length}</button>` : '') + '</div>');
  }
  // the portals that only take links: no step of their own, yet the links
  // need them ours (keys too) — easy to miss when going by the steps
  const idle = r.portals.filter((p) => !p.out);
  if (idle.length && steps.length) {
    parts.push('<div class="dx-h">Только принимают линки</div>');
    for (const p of idle) {
      const first = steps.findIndex((st) => st.links.some((e) => e.to === p)) + 1;
      const need = notReady(p, false);
      const h = holdOf(p);
      const meta = [`ключей ${p.inc}`];
      if (need) meta.push(`<span class="lp-bad">${esc(need)} до шага ${first}</span>`);
      else if (h === 'mine') meta.push('<span class="lp-ok">наш</span>');
      else meta.push('<span class="lp-maybe">чей — не известно, загрузите карту у портала</span>');
      // the base link can be thrown from here instead: then this portal is a step
      const turn = r.links.filter((e) => e.to === p && canTurn(e));
      parts.push(`<div class="lm-item lp-step lp-idle${p.key === focusKey ? ' on' : ''}${need ? ' bad' : ''}">` +
        `<button type="button" class="lm-row" data-p="${esc(p.key)}" data-step="1"><span class="lm-name"><b class="lp-n lp-in" title="Принимает линки">←</b>${esc(nameOf(p))}</span>` +
        `<span class="lm-meta lp-meta">${meta.join(' · ')}</span></button>` +
        turn.map((e) => `<button type="button" class="lp-unpin lp-throw" data-e="${esc(e.id)}" title="Развернуть линк: этот портал станет шагом">Кинуть отсюда → ${esc(nameOf(e.from))}</button>`).join('') +
        '</div>');
    }
    parts.push('<div class="dx-h">Шаги</div>');
  }
  steps.forEach((st, i) => {
    const p = st.portal;
    const meta = [`→ ${esc(st.links.map((e) => nameOf(e.to)).join(', '))}`];
    if (st.fields.length) meta.push(`+${plural(st.fields.length, 'поле', 'поля', 'полей')}`);
    if (i) meta.push(`${fmtLen(st.dist)} от шага ${i}`);
    const prep = notReady(p, true);
    // a step's own portal is visited anyway: a reminder, not an error
    let badTxt = prep ? `<span class="lp-alt">${esc(prep)}</span>` : '';
    badTxt += st.bad ? `<span class="lp-alt lp-bad">под полем шага ${st.bad.by} — отсюда уже не кинуть</span>` : '';
    if (st.lost.length) badTxt += `<span class="lp-alt lp-bad">здесь линк закроет сразу ${st.lost.length + 1} поля с одной стороны, а образуется только одно (большее) — поставьте этот шаг раньше</span>`;
    parts.push(`<div class="lm-item lp-step${p.key === focusKey ? ' on' : ''}${st.bad || st.lost.length ? ' bad' : ''}">` +
      `<button type="button" class="lm-row" data-p="${esc(p.key)}" data-step="1"><span class="lm-name">${stepNo(st, done)}${esc(nameOf(p))}</span>` +
      `<span class="lm-meta lp-meta">${meta.join(' · ')}${badTxt}</span></button>` +
      `<span class="lp-move"><button type="button" data-mv="${i}" data-d="-1" title="Раньше"${i ? '' : ' disabled'}>↑</button>` +
      `<button type="button" data-mv="${i}" data-d="1" title="Позже"${i < steps.length - 1 ? '' : ' disabled'}>↓</button></span></div>`);
  });
  if (manual) parts.push('<button type="button" class="lp-unpin lp-unorder">Сбросить порядок к автоматическому</button>');
  parts.push('<div class="dx-note">Шаг — портал и все линки с него. Из-под поля линк не кинуть, поэтому портал идёт раньше, чем закроется поле над ним; ' +
    'линк делает не больше одного поля с каждой стороны, поэтому вложенные поля закрываются по одному (база — первой); дальше — ближайший к предыдущему. Стрелки ↑↓ меняют порядок, он сохраняется в плане. Номера шагов видны на карте у порталов. ' +
    'Линк кидают только со своего портала со всеми 8 резонаторами и только на свой портал — чей портал, видно по последней загрузке карты.</div>');
  return parts.join('');
}

function row(p, focusKey, unfocus, links) {
  const title = p.name || (p.onPortal ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : 'портал не загружен');
  const meta = [];
  let alt = '';
  if (p.inc) meta.push(`<span class="lp-keys">ключей ${p.inc}</span>`);
  meta.push(`<span class="${p.out > GAME.outLinks ? 'lp-bad' : ''}">исх ${p.out}/${GAME.outLinks}</span>`);
  if (p.need) {
    const n = p.need;
    // the sure level is the next whole one; the exact mean in the tooltip
    const what = n.mean == null
      ? (n.unreachable ? 'дальности P8 со всеми модами не хватает' : `P8 · 8 агентов L8 + ${n.amps ? ampsText(n.amps) : `усиление ×${n.boost.toFixed(1)}`}`)
      : `P${Math.ceil(n.mean - 1e-9)}+` + (n.agents > 1 ? ` · ${plural(n.agents, 'агент', 'агента', 'агентов')} L8` : '');
    const tip = n.mean == null ? `дальности P8 не хватает в ${n.boost.toFixed(1)} раза`
      : `средний уровень резонаторов ≥ ${(Math.ceil(n.mean * 10) / 10).toFixed(1)}; один агент L8 поднимает портал до 5.6, каждый ставит до ${GAME.modsPerAgent} модов`;
    const now = p.level ? ` · сейчас P${p.level}` : '';
    const cls = p.reach === false ? 'lp-bad' : p.reach === 'maybe' ? 'lp-maybe' : 'lp-ok';
    meta.push(`<span class="${cls}" title="${esc(tip)}">до ${fmtLen(p.longest)}: ${esc(what)}${now}</span>`);
    if (n.alts.length) alt = `<span class="lp-alt">или ${esc(n.alts.map(wayText).join(', или '))}</span>`;
  }
  const on = p.key === focusKey;
  return `<div class="lm-item${on ? ' on' : ''}"><button type="button" class="lm-row" data-p="${esc(p.key)}">` +
    `<span class="lm-name">${p.anchor ? '<b class="lp-anchor">◆</b>' : ''}${esc(title)}</span>` +
    `<span class="lm-meta lp-meta">${meta.join(' · ')}${alt}${on ? `<span class="lp-alt">${unfocus}</span>` : ''}</span></button>` +
    (on ? linksOf(p, links) : '') + '</div>';
}

// the picked portal's links, each with a button to turn it; a name goes to
// that portal
const nameOf = (p) => p.name || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

// whose a portal is, for the agent: 'mine' | 'neu' | 'enemy', or null (not
// known: the portal not loaded, or the agent's faction not yet)
export function holdOf(p) {
  const mine = me.agent?.faction;
  if (!mine || !p.onPortal || !p.faction) return null;
  return p.faction === mine ? 'mine' : p.faction === 'neu' ? 'neu' : 'enemy';
}
// what a portal still needs before links go on: thrown from (out) it needs
// to be ours with all 8 resonators, a target only ours → text, or ''
export function notReady(p, out) {
  const h = holdOf(p);
  if (h === 'neu') return out ? 'серый — захватить и поставить 8 резонаторов' : 'серый — захватить';
  if (h === 'enemy') return out ? 'под противником — снести, захватить, 8 резонаторов' : 'под противником — снести и захватить';
  if (h === 'mine' && out && p.resos != null && p.resos < 8) return `поставить все 8 резонаторов (сейчас ${p.resos})`;
  return '';
}
// a link between two anchors that could be thrown the other way: its target
// has room for one more outgoing (turning a vertex's link onto an anchor
// would only swap which one walks)
export const canTurn = (e) => !!(e.from.anchor && e.to.anchor && e.to.out < GAME.outLinks);
function linksOf(p, links) {
  const mine = links.filter((e) => e.from === p || e.to === p)
    .sort((x, y) => (x.from === p) - (y.from === p) || y.len - x.len);
  return '<div class="lp-links">' + mine.map((e) => {
    const out = e.from === p, o = out ? e.to : e.from;
    return `<div class="lp-link${e.pin ? ' pin' : ''}"><span class="lp-way" title="${out ? 'исходящий: кидать отсюда' : 'входящий: кидают сюда, нужен ключ'}">${out ? '→' : '←'}</span>` +
      `<button type="button" class="lp-to" data-go-p="${esc(o.key)}" title="Перейти к порталу">${esc(nameOf(o))}</button><span class="lp-len">${fmtLen(e.len)}</span>` +
      `<button type="button" class="lp-flip" data-e="${esc(e.id)}" title="Развернуть линк">⇄</button></div>`;
  }).join('') + (p.id ? '<button type="button" class="lp-card">Карточка портала</button>' : '') + '</div>';
}

// the step numbers by their portals
export function planNumbers(r, map, into, pane) {
  for (const st of r.order.steps) {
    L.marker([st.portal.lat, st.portal.lng], {
      interactive: false, keyboard: false, pane,
      icon: L.divIcon({ className: 'lp-num' + (st.bad || st.lost.length ? ' bad' : ''), iconSize: [0, 0], html: `<b>${st.n}</b>` }),
    }).addTo(into);
  }
}

// an arrow on every link just past the portal it is thrown from (clear of the
// vertex handle), pointing the way it goes: standing at a portal, its own
// links show what to throw from there; an anchor's incoming links leave it
// bare. A link too short on screen for that gets the arrow midway. A tap
// on an arrow turns its link (onFlip); a pinned one has a red outline.
const HEAD_PX = 30;
export function planArrows(r, map, into, pane, onFlip) {
  for (const e of r.links) {
    const a = map.latLngToContainerPoint([e.from.lat, e.from.lng]), b = map.latLngToContainerPoint([e.to.lat, e.to.lng]);
    const d = a.distanceTo(b);
    if (d < 24) continue; // too short on screen to carry an arrow
    // HEAD_PX along the drawn geodesic (not its tangent: a long link curves
    // away from a straight line on screen), pointing the way it runs there
    const pts = geodesicPath([[e.from.lat, e.from.lng], [e.to.lat, e.to.lng]]).map((q) => map.latLngToContainerPoint(q));
    const want = d >= HEAD_PX * 2.5 ? HEAD_PX : null;
    let at = midpoint([e.from.lat, e.from.lng], [e.to.lat, e.to.lng]);
    let dir = b.subtract(a);
    if (want) {
      let walked = 0;
      for (let k = 1; k < pts.length; k++) {
        const seg = pts[k].subtract(pts[k - 1]), sl = Math.hypot(seg.x, seg.y);
        if (!sl) continue;
        dir = seg;
        if (walked + sl >= want) {
          at = map.containerPointToLatLng(pts[k - 1].add(seg.multiplyBy((want - walked) / sl)));
          break;
        }
        walked += sl;
      }
    } else {
      // midway: the way the curve runs at its middle
      const m = map.latLngToContainerPoint(at);
      const k = pts.findIndex((q) => q.distanceTo(a) >= m.distanceTo(a));
      if (k > 0) dir = pts[k].subtract(pts[k - 1]);
    }
    const deg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    const stroke = e.pin ? 'stroke="#ff2d2d" stroke-width="2.5"' : 'stroke="#000" stroke-width="1.5"';
    L.marker(at, {
      interactive: !!onFlip, keyboard: false, pane, bubblingMouseEvents: false,
      // a finger-sized target around the small arrow
      icon: L.divIcon({ className: 'lp-arrow', iconSize: [32, 32],
        html: `<svg width="16" height="16" viewBox="0 0 16 16" style="transform:rotate(${deg}deg)"><path d="M3 2l11 6-11 6z" fill="#ffe14a" ${stroke} stroke-linejoin="round"/></svg>` }),
    }).on('click', (ev) => { L.DomEvent.stop(ev); onFlip?.(e); }).addTo(into);
  }
}
