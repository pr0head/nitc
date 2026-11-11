// Link plan: what building the plan on screen takes. The drawing has no link
// directions, so they are chosen here: a link goes toward the end more plan
// links meet at — the anchors collect the keys, the outgoing links stay on the
// other portals. A portal that can't reach (its level on the map is too low)
// hands the link to the other end when that one can; a portal over the
// outgoing limit hands links to neighbours with room left. That is one way to
// build it, not the only one (anchors can throw links too, crews can split) —
// a manual choice comes later.
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
import { esc } from '../ui/esc.js';

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
        deg: 0, inc: 0, out: 0, longest: 0,
      });
    }
    return portals.get(k);
  };
  const edges = new Map();
  const fields = new Set();
  for (const s of model) {
    const v = s.latLngs, n = v.length;
    const m = s.type === 'polygon' ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const a = portal(v[i]), b = portal(v[(i + 1) % n]);
      if (a === b) continue;
      const id = a.key < b.key ? a.key + '|' + b.key : b.key + '|' + a.key;
      if (edges.has(id)) continue;
      edges.set(id, { a, b, len: distanceM([a.lat, a.lng], [b.lat, b.lng]) });
      a.deg++; b.deg++;
    }
    if (s.type === 'polygon' && n === 3) {
      const ks = v.map(keyOf);
      if (new Set(ks).size === 3) fields.add(ks.sort().join('|'));
    }
  }

  // directions: toward the busier end; reach and the outgoing limit correct it
  const links = [...edges.values()];
  for (const e of links) {
    let [from, to] = e.a.deg < e.b.deg || (e.a.deg === e.b.deg && e.a.key < e.b.key) ? [e.a, e.b] : [e.b, e.a];
    if (reach(from, e.len) === false && reach(to, e.len) !== false) [from, to] = [to, from];
    e.from = from; e.to = to; from.out++; to.inc++;
  }
  for (let guard = links.length * 2; guard > 0; guard--) {
    const over = [...portals.values()].find((p) => p.out > GAME.outLinks && links.some((e) => e.from === p && e.to.out < GAME.outLinks && reach(e.to, e.len) !== false));
    if (!over) break;
    const e = links.filter((x) => x.from === over && x.to.out < GAME.outLinks && reach(x.to, x.len) !== false)
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
  return {
    portals: list, links,
    fields: fields.size,
    keys: links.length,
    ap: links.length * GAME.apMake.link + fields.size * GAME.apMake.field,
    overLimit: list.filter((p) => p.out > GAME.outLinks).length,
    short: list.filter((p) => p.reach === false).length,
    loose: list.filter((p) => !p.onPortal).length,
  };
}

// ---- the panel tab ----
// cross: what the crossings check found ({links, self, partial}) — the plan
// can't be built as drawn while something crosses it; a tap goes to the sky tab
export function planHtml(r, focusKey, unfocus, cross) {
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
  if (r.loose) warn.push(esc(`${plural(r.loose, 'вершина', 'вершины', 'вершин')} без данных о портале — приблизьте карту к ним`));
  if (warn.length) parts.push(`<ul class="dx-why">${warn.map((w) => `<li>${w}</li>`).join('')}</ul>`);

  const anchors = r.portals.filter((p) => p.anchor), rest = r.portals.filter((p) => !p.anchor);
  if (anchors.length) {
    parts.push('<div class="dx-h">Опорные</div>');
    anchors.forEach((p) => parts.push(row(p, focusKey, unfocus)));
  }
  if (rest.length) {
    parts.push(`<div class="dx-h">${anchors.length ? 'Остальные' : 'Порталы'}</div>`);
    rest.forEach((p) => parts.push(row(p, focusKey, unfocus)));
  }
  parts.push('<div class="dx-note">Направления выбраны автоматически: линки идут к опорным порталам, ключи нужны от них, исходящие — с остальных. ' +
    'Стрелки выходят из портала, с которого кидается линк, и указывают, куда. Уровни взяты с карты; точная дальность с модами — в карточке портала.</div>');
  return parts.join('');
}

function row(p, focusKey, unfocus) {
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
    `<span class="lm-meta lp-meta">${meta.join(' · ')}${alt}${on ? `<span class="lp-alt">${unfocus}</span>` : ''}</span></button></div>`;
}

// an arrow on every link just past the portal it is thrown from (clear of the
// vertex handle), pointing the way it goes: standing at a portal, its own
// links show what to throw from there; an anchor's incoming links leave it
// bare. A link too short on screen for that gets the arrow midway.
const HEAD_PX = 30;
export function planArrows(r, map, into, pane) {
  for (const e of r.links) {
    const a = map.latLngToContainerPoint([e.from.lat, e.from.lng]), b = map.latLngToContainerPoint([e.to.lat, e.to.lng]);
    const d = a.distanceTo(b);
    if (d < 24) continue; // too short on screen to carry an arrow
    // the geodesic's first stretch gives the way it leaves
    const path = geodesicPath([[e.from.lat, e.from.lng], [e.to.lat, e.to.lng]]);
    const p1 = map.latLngToContainerPoint(path[Math.min(1, path.length - 1)]);
    const dir = (p1.equals(a) ? b : p1).subtract(a);
    const len = Math.hypot(dir.x, dir.y) || 1;
    const at = d >= HEAD_PX * 2.5
      ? map.containerPointToLatLng(a.add(dir.multiplyBy(HEAD_PX / len)))
      : midpoint([e.from.lat, e.from.lng], [e.to.lat, e.to.lng]);
    const deg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    L.marker(at, {
      interactive: false, keyboard: false, pane,
      icon: L.divIcon({ className: 'lp-arrow', iconSize: [16, 16],
        html: `<svg width="16" height="16" viewBox="0 0 16 16" style="transform:rotate(${deg}deg)"><path d="M3 2l11 6-11 6z" fill="#ffe14a" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>` }),
    }).addTo(into);
  }
}
