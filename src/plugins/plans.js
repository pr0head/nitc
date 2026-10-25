// Plans: a directory of drawings for the draw tools. One drawing state is never
// enough — you sketch fields in one place, later something unrelated elsewhere,
// then want the first variant back. A plan is one such independent drawing:
// named, listed, switchable, renameable, deletable, and it remembers the map
// position it was worked at, so switching takes you back to where it lives.
//
// Plans appear on their own: draw anything while no plan is active and it is
// filed as "Черновик <date>"; empty a plan and it disappears, since a plan with
// nothing in it is not worth a row. Only plans made deliberately (the New plan
// button) get the "План" prefix, so the list shows what was meant and what
// just happened.
//
// The draw tools own the live geometry and emit 'drawChanged' on every save;
// this module owns persistence and hands geometry back with 'drawLoad'.
//
// Stored (localStorage 'nitc.plans'):
//   { active: id|null, plans: [{id, name, created, updated, view, shapes}] }
// shapes is the IITC DrawTools array, view is {lat,lng,zoom}.
import { bus } from '../state/bus.js';
import { createListModal, confirmBox, promptBox } from '../ui/dialog.js';
import { esc } from '../ui/esc.js';
import { PENCIL, TRASH } from '../ui/icons.js';

const KEY = 'nitc.plans';

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && Array.isArray(s.plans)) {
      const plans = s.plans.filter((p) => p && p.id && Array.isArray(p.shapes));
      return { active: plans.some((p) => p.id === s.active) ? s.active : null, plans };
    }
  } catch { /* fall through */ }
  return { active: null, plans: [] };
}

let store = load();
let map = null;
let modal = null;

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage blocked */ } };
function changed() { save(); if (modal?.isOpen) renderList(); }
const byId = (id) => store.plans.find((p) => p.id === id) || null;
const activePlan = () => byId(store.active);
const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const defaultName = (prefix) => prefix + ' ' + stamp(new Date());
function newPlan(name, shapes) {
  const t = Date.now();
  return { id: uid(), name, created: t, updated: t, view: null, shapes: shapes || [] };
}
function view() {
  const c = map.getCenter();
  return { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
}

// The whole lifecycle: an emptied plan is dropped, geometry with no plan behind
// it gets one, anything else edits the active plan (its viewport taken along,
// so no unload hook is needed to remember where you were working).
bus.on('drawChanged', (shapes) => {
  const cur = activePlan();
  if (!shapes || !shapes.length) {
    if (!cur) return;
    store.plans.splice(store.plans.indexOf(cur), 1);
    store.active = null;
  } else if (!cur) {
    const p = newPlan(defaultName('Черновик'), shapes);
    p.view = view();
    store.plans.push(p);
    store.active = p.id;
  } else {
    cur.shapes = shapes;
    cur.updated = Date.now();
    cur.view = view();
  }
  changed();
});

// Leaving a plan: remember where it was worked on — unless it holds nothing,
// in which case it was never really a plan and the list is better without it.
function leaveCurrent() {
  const cur = activePlan();
  if (!cur) return;
  if (cur.shapes.length) cur.view = view();
  else store.plans.splice(store.plans.indexOf(cur), 1);
  store.active = null;
}

function select(id) {
  const p = byId(id);
  modal.close();
  if (!p || p.id === store.active) return;
  leaveCurrent();
  store.active = p.id;
  save();
  bus.emit('drawLoad', p.shapes);
  if (p.view) map.setView([p.view.lat, p.view.lng], p.view.zoom);
}
function create(name) {
  leaveCurrent();
  const p = newPlan((name || '').trim() || defaultName('План'), []);
  store.plans.push(p);
  store.active = p.id;
  bus.emit('drawLoad', p.shapes);
  changed();
}
function remove(id) {
  const i = store.plans.findIndex((p) => p.id === id);
  if (i < 0) return;
  const wasActive = store.active === id;
  store.plans.splice(i, 1);
  if (wasActive) {
    store.active = null;
    bus.emit('drawLoad', []); // leave the map where it is, just empty
  }
  changed();
}
function rename(id, name) {
  const p = byId(id);
  if (!p || !name) { renderList(); return; }
  p.name = name;
  changed();
}

export const plans = {
  list: () => store.plans.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0)),
  active: activePlan,
  // the draw panel opening: pick up where the last session left off without
  // moving the map (only an explicit switch does)
  openLast() {
    let p = activePlan();
    if (!p) {
      p = plans.list()[0] || null;
      store.active = p ? p.id : null;
      save();
    }
    return p ? p.shapes : [];
  },
  open() { renderList(); modal.open(); },
  async createPrompt() {
    const name = await promptBox('Название нового плана', defaultName('План'), 'Создать');
    if (name != null) create(name);
  },
};

// ---- modal ----
function when(ts) {
  return ts ? new Date(ts).toLocaleString(undefined,
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
}
const shapesWord = (n) => {
  const d = n % 10, h = n % 100;
  if (d === 1 && h !== 11) return 'фигура';
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return 'фигуры';
  return 'фигур';
};
function renderList() {
  const items = plans.list();
  if (!items.length) {
    modal.list.innerHTML = '<div class="lm-empty">Планов пока нет.<br><br>' +
      'Нарисуйте линию или поле — они сохранятся сюда сами. ' +
      'Кнопка <b>Новый план</b> в панели рисования начинает пустой план.</div>';
    return;
  }
  modal.list.innerHTML = items.map((p) => {
    const n = p.shapes.length;
    return `<div class="lm-item${p.id === store.active ? ' on' : ''}" data-id="${esc(p.id)}">` +
      `<button type="button" class="lm-row"><span class="lm-name">${esc(p.name)}</span>` +
      `<span class="lm-meta">${n} ${shapesWord(n)} · ${esc(when(p.updated))}</span></button>` +
      `<button type="button" class="lm-ren" title="Переименовать">${PENCIL}</button>` +
      `<button type="button" class="lm-del" title="Удалить">${TRASH}</button></div>`;
  }).join('');
}

// Inline rename: the name is right there, and the row is a <button>, which
// cannot hold an input — so the two are swapped.
function startRename(item, id) {
  const p = byId(id);
  if (!p) { renderList(); return; }
  const row = item.querySelector('.lm-row');
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'lm-input'; inp.value = p.name;
  row.hidden = true; item.insertBefore(inp, row);
  inp.focus(); inp.select();
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    if (ok) rename(id, inp.value.trim()); else renderList();
  };
  inp.addEventListener('keydown', (ev) => {
    ev.stopPropagation(); // Escape must not close the modal
    if (ev.key === 'Enter') finish(true);
    else if (ev.key === 'Escape') finish(false);
  });
  inp.addEventListener('blur', () => finish(false));
  inp.addEventListener('click', (ev) => ev.stopPropagation());
}

export function mountPlans(engine) {
  map = engine.map;
  modal = createListModal('Планы');
  modal.list.addEventListener('click', async (e) => {
    const item = e.target.closest('.lm-item');
    if (!item) return;
    const id = item.dataset.id;
    if (e.target.closest('.lm-del')) {
      const p = byId(id);
      if (!p) { renderList(); return; }
      if (await confirmBox(`Удалить «${p.name}»? Его рисунки будут потеряны.`, 'Удалить')) remove(id);
      return;
    }
    if (e.target.closest('.lm-ren')) { startRename(item, id); return; }
    if (e.target.closest('.lm-row')) select(id);
  });
}
