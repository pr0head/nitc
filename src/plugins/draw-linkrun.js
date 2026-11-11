// Link run: the plan's steps (draw-linkorder.js) walked on the ground. A
// plate at the bottom shows one step: its portal, the links to throw from it
// (each ticked once thrown), the fields it closes, how far it is and the
// route there, and what stands in its way. The map rings the step's portal,
// marks its links still to throw, the next portal, and every link done.
//
// Progress comes by itself: a plan link seen on the map (either way round:
// it stands, whoever threw it) or in COMM (link_create) is done; a link
// destroyed in COMM is undone. A link the map can't show (a far zoom, a cut)
// can be ticked by hand — a tap on its row (again: unticked) — and "Готово"
// ticks the step ("Снять отметки" unticks it); progress can be reset whole.
// Each step brings the map to its portal, at a zoom showing every portal.
// When the step's links are all done the plate moves on to the next step
// not done. Since it is all read from the map, the sky with the same plan
// sees the same progress, no talk needed.
//
// The plate folds to its head line (step, portal, count; a dot when there
// is a warning) so it leaves a phone's map alone; a tap unfolds it. Folded
// or not is remembered.
//
// Done links are kept per plan (localStorage 'nitc.lp.done': {planId: [link
// ids]}), so a reload or a plan switch keeps the count.
//
// Warnings on the plate: a link on the map crossing a link of this step
// (take it down first: the sky tab), and portals of this step held by the
// other faction.
import L from 'leaflet';
import { bus } from '../state/bus.js';
import { MAP } from '../config.js';
import { plans } from './plans.js';
import { keyOf } from './draw-snap.js';
import { distanceM, geodesicPath } from '../map/geo.js';
import { myPosition } from '../ui/locate.js';
import { backOpen, backClosed } from '../ui/back.js';
import { narrow } from '../ui/phone.js';
import { esc } from '../ui/esc.js';
import { notReady, canTurn } from './draw-linkplan.js';

const KEY = 'nitc.lp.done';
const RING = '#ff8c1a';
const DONE = '#3fca4a';
const WALK_M = 2000; // closer than this the route is on foot
const plural = (n, one, few, many) => {
  const d = n % 10, h = n % 100;
  return n + ' ' + (d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many);
};
const fmtLen = (m) => (m >= 1000 ? (m / 1000).toFixed(m >= 100000 ? 0 : 1) + ' км' : Math.round(m) + ' м');
const nameOf = (p) => p.name || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
const linkId = (a, b) => { const ka = keyOf(a), kb = keyOf(b); return ka < kb ? ka + '|' + kb : kb + '|' + ka; };

function loadDone() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
// the done links of the plan on screen (for the steps list), and their reset
export const doneLinks = () => new Set(loadDone()[plans.active()?.id] || []);
export function resetDone() {
  const all = loadDone();
  delete all[plans.active()?.id];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
  bus.emit('linkRunReset');
}

// { map, engine, ov, container, onOpenSky } → { start(plan, i), stop, update(plan, blocked), active }
// blocked: ids of plan links a map link crosses
export function createRun({ map, engine, ov, container, onOpenSky, onFlip }) {
  const layer = L.layerGroup();
  let on = false, lp = null, idx = 0, blocked = new Set();
  let folded = false;
  try { folded = localStorage.getItem('nitc.lp.fold') === '1'; } catch {}
  let done = new Set(), planId = null;

  const bar = document.createElement('div');
  bar.className = 'lr-bar'; bar.hidden = true;
  container.append(bar);
  L.DomEvent.disableClickPropagation(bar);
  L.DomEvent.disableScrollPropagation(bar);

  function keep() {
    const all = loadDone();
    if (done.size) all[planId] = [...done]; else delete all[planId];
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
    bus.emit('linkRunProgress'); // the steps list ticks along
  }
  function adopt() {
    const id = plans.active()?.id || null;
    if (id === planId) return;
    planId = id;
    done = new Set(loadDone()[id] || []);
  }
  const steps = () => lp?.order.steps || [];
  const stepDone = (st) => st.links.every((e) => done.has(e.id));
  const nextOpen = (from) => {
    const s = steps();
    for (let k = 0; k < s.length; k++) { const i = (from + k) % s.length; if (!stepDone(s[i])) return i; }
    return -1;
  };

  // links seen on the map are done
  function fromMap() {
    if (!lp) return false;
    const ids = new Set(lp.links.map((e) => e.id));
    const d = engine.getData();
    let got = false;
    const see = (a, b) => {
      if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return;
      const id = linkId(a, b);
      if (ids.has(id) && !done.has(id)) { done.add(id); got = true; }
    };
    for (const l of d.links) see(l.a, l.b);
    for (const f of d.fields) if (f.v.length === 3) { see(f.v[0], f.v[1]); see(f.v[1], f.v[2]); see(f.v[2], f.v[0]); }
    return got;
  }
  // progress reset (here or from the steps list): back to the first step
  bus.on('linkRunReset', () => {
    done = new Set(); planId = plans.active()?.id || null;
    if (on) go(0);
  });
  // COMM: a plan link made or destroyed
  bus.on('commEvents', (evs) => {
    if (!on || !lp) return;
    const ids = new Set(lp.links.map((e) => e.id));
    let got = false;
    for (const ev of evs) {
      if ((ev.kind !== 'link_create' && ev.kind !== 'link_destroy') || ev.portals.length < 2) continue;
      const id = linkId(ev.portals[0], ev.portals[1]);
      if (!ids.has(id)) continue;
      if (ev.kind === 'link_create' && !done.has(id)) { done.add(id); got = true; }
      if (ev.kind === 'link_destroy' && done.has(id)) { done.delete(id); got = true; }
    }
    if (got) progressed();
  });

  // something got done: move on once the step is, then show
  function progressed() {
    keep();
    const st = steps()[idx];
    if (st && stepDone(st)) {
      const n = nextOpen(idx);
      if (n >= 0 && n !== idx) { go(n); return; }
    }
    paint();
  }

  function paint() {
    if (!on) return;
    const s = steps();
    if (!s.length) { stop(); return; }
    idx = Math.min(idx, s.length - 1);
    const st = s[idx];
    const p = st.portal;
    const allLinks = lp.links.length, nDone = lp.links.filter((e) => done.has(e.id)).length;
    const finished = nDone === allLinks;

    const rows = st.links.map((e) => {
      const ok = done.has(e.id);
      return `<button type="button" class="lr-link${ok ? ' ok' : ''}" data-e="${esc(e.id)}" title="${ok ? 'отмечен сделанным — нажмите, чтобы снять' : 'нажмите, чтобы отметить вручную'}">` +
        `<span class="lr-tick">${ok ? '✓' : '○'}</span><span class="lr-to">→ ${esc(nameOf(e.to))}</span>` +
        `<span class="lr-len">${fmtLen(e.len)}</span></button>`;
    }).join('');

    const meta = [];
    if (st.fields.length) meta.push(`+${plural(st.fields.length, 'поле', 'поля', 'полей')}`);
    const me0 = myPosition();
    const away = me0 ? distanceM(me0, [p.lat, p.lng]) : null;
    if (away != null) meta.push(`${fmtLen(away)} от вас`);
    const walk = away != null && away <= WALK_M;
    meta.push(`<a href="https://yandex.ru/maps/?rtext=~${p.lat.toFixed(6)},${p.lng.toFixed(6)}&rtt=${walk ? 'pd' : 'auto'}" target="_blank" rel="noopener">маршрут</a>`);

    const warn = [];
    const crossed = st.links.filter((e) => blocked.has(e.id) && !done.has(e.id));
    if (crossed.length) warn.push(`<button type="button" class="lr-sky">${esc(crossed.length === 1 ? `Линк на ${nameOf(crossed[0].to)} пересекает линк на карте` : `${plural(crossed.length, 'линк', 'линка', 'линков')} шага пересекают линки на карте`)} — сначала убрать →</button>`);
    // the portal and the targets of links still to throw, not ready for them
    const prep = notReady(p, true);
    if (prep && !stepDone(st)) warn.push(esc(`${nameOf(p)}: ${prep}`));
    for (const e of st.links.filter((x) => !done.has(x.id))) {
      const t = notReady(e.to, false);
      if (!t || warn.some((w) => w.startsWith(esc(nameOf(e.to)) + ':'))) continue;
      // a base link onto a portal not ours: thrown from there, once it is taken
      warn.push(esc(`${nameOf(e.to)}: ${t}`) + (canTurn(e)
        ? ` <button type="button" class="lr-turn" data-e="${esc(e.id)}" title="Развернуть линк: тот портал станет шагом">Кинуть оттуда</button>` : ''));
    }
    if (st.bad) warn.push(esc(`Портал под полем шага ${st.bad.by} — отсюда не кинуть`));
    const ahead = s.slice(idx + 1).filter((x) => x.links.some((e) => blocked.has(e.id) && !done.has(e.id))).length;
    if (ahead) warn.push(esc(`Дальше: ${plural(ahead, 'шаг', 'шага', 'шагов')} с пересечениями`));

    bar.innerHTML =
      `<div class="lr-head"><b class="lr-n">${finished ? '✓' : `${st.n}/${s.length}`}</b>` +
      `<span class="lr-name">${finished ? 'План построен' : esc(nameOf(p))}</span>` +
      `<span class="lr-count">${nDone}/${allLinks}</span>` +
      (folded && warn.length && !finished ? '<b class="lr-dot" title="Есть предупреждения"></b>' : '') +
      `<button type="button" class="lr-fold" title="${folded ? 'Развернуть' : 'Свернуть'}">${folded ? '▴' : '▾'}</button>` +
      '<button type="button" class="lr-x" title="Закончить">×</button></div>' +
      (folded ? '' :
      (finished ? `<div class="lr-fin">Шаг ${st.n}/${s.length} · ${esc(nameOf(p))}<button type="button" class="lr-reset">Сбросить прогресс</button></div>` : '') +
      `<div class="lr-links">${rows}</div><div class="lr-meta">${meta.join(' · ')}</div>` +
      (warn.length && !finished ? `<ul class="lr-warn">${warn.map((w) => `<li>${w}</li>`).join('')}</ul>` : '') +
      '<div class="lr-nav"><button type="button" class="lr-prev" title="Предыдущий шаг"' + (idx ? '' : ' disabled') + '>‹</button>' +
      (stepDone(st) ? '<button type="button" class="lr-undo">Снять отметки</button>' : '<button type="button" class="lr-done">Готово</button>') +
      '<button type="button" class="lr-next" title="Следующий шаг"' + (idx < s.length - 1 ? '' : ' disabled') + '>›</button></div>');
    bar.classList.toggle('folded', folded);
    place();
    paintMap(st);
  }

  // the rest of the layout keeps clear of the plate on an upright phone (the
  // panel's sheet sets the same while it is up: only what the plate set is
  // taken back)
  let owns = false;
  function place() {
    const show = narrow.matches && on && !bar.hidden;
    if (show) { document.documentElement.style.setProperty('--sheet-h', bar.offsetHeight + 'px'); owns = true; }
    else if (owns) { document.documentElement.style.setProperty('--sheet-h', '0px'); owns = false; }
  }
  addEventListener('resize', () => { if (on) place(); });

  function paintMap(st) {
    layer.clearLayers();
    const line = (e, o) => L.polyline(geodesicPath([[e.from.lat, e.from.lng], [e.to.lat, e.to.lng]]), { interactive: false, ...ov, ...o }).addTo(layer);
    for (const e of lp.links) if (done.has(e.id)) line(e, { color: DONE, weight: 3, opacity: 0.9 });
    for (const e of st.links) if (!done.has(e.id)) line(e, { color: RING, weight: 4, opacity: 0.95, dashArray: '10,7' });
    const nx = steps()[nextOpen(idx + 1)];
    if (nx && nx !== st) L.circleMarker([nx.portal.lat, nx.portal.lng], { radius: 12, color: RING, weight: 2, dashArray: '4,4', fill: false, interactive: false, ...ov }).addTo(layer);
    L.circleMarker([st.portal.lat, st.portal.lng], { radius: 16, color: RING, weight: 4, fill: false, interactive: false, className: 'dx-pulse', ...ov }).addTo(layer);
  }

  // to step i, the map on its portal at a zoom with every portal shown
  function go(i) {
    idx = i; paint();
    const p = steps()[idx]?.portal;
    if (p) map.setView([p.lat, p.lng], Math.max(map.getZoom(), MAP.minPortalZoom));
  }

  bar.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('.lr-x')) { stop(); return; }
    const turn = t.closest('.lr-turn');
    if (turn) { const l = lp?.links.find((x) => x.id === turn.dataset.e); if (l) onFlip?.(l); return; }
    // the fold button, or anywhere on a folded plate's head: fold/unfold
    if (t.closest('.lr-fold') || (folded && t.closest('.lr-head'))) {
      folded = !folded;
      try { localStorage.setItem('nitc.lp.fold', folded ? '1' : '0'); } catch {}
      paint(); return;
    }
    if (t.closest('.lr-sky')) { onOpenSky?.(); return; }
    if (t.closest('.lr-prev')) { go(Math.max(0, idx - 1)); return; }
    if (t.closest('.lr-next')) { go(Math.min(steps().length - 1, idx + 1)); return; }
    if (t.closest('.lr-done')) {
      for (const l of steps()[idx].links) done.add(l.id);
      progressed();
      return;
    }
    if (t.closest('.lr-undo')) {
      for (const l of steps()[idx].links) done.delete(l.id);
      keep(); paint();
      return;
    }
    if (t.closest('.lr-reset')) { resetDone(); return; }
    const r = t.closest('.lr-link');
    if (r) {
      if (done.has(r.dataset.e)) { done.delete(r.dataset.e); keep(); paint(); }
      else { done.add(r.dataset.e); progressed(); }
    }
  });

  function start(plan, i) {
    lp = plan; adopt();
    if (!on) { on = true; layer.addTo(map); backOpen(stop); }
    bar.hidden = false;
    fromMap(); keep();
    const n = i != null ? i : nextOpen(0);
    go(n >= 0 ? n : 0);
  }
  function stop() {
    if (!on) return;
    on = false; bar.hidden = true; backClosed(stop);
    layer.clearLayers(); map.removeLayer(layer);
    place();
  }
  // a recount (a map load, an edit): the plan anew, its progress, the plate
  function update(plan, blockedIds) {
    if (!on) return;
    lp = plan; blocked = blockedIds || new Set();
    adopt();
    if (fromMap()) { progressed(); return; }
    paint();
  }
  // an upright phone has one bottom sheet at a time: the panel's hides the plate
  function sheet(panelOpen) {
    if (!on) return;
    bar.hidden = narrow.matches && panelOpen;
    if (bar.hidden) owns = false; else place();
  }

  return { start, stop, update, sheet, active: () => on };
}
