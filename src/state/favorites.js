// Starred portals: [{id, title, lat, lng}] in localStorage. The id is the
// stable handle; title/position are a cached copy, refreshed whenever an entry
// is opened (a portal can be renamed or moved). Emits 'favoritesChanged'.
import { bus } from './bus.js';

const KEY = 'nitc.fav';

function load() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(a) ? a.filter((x) => x && x.id != null) : [];
  } catch { return []; }
}

let model = load();
const idx = (id) => model.findIndex((f) => String(f.id) === String(id));
export const favLabel = (f) => (f.title || '').trim() || 'Портал без названия';

function changed() {
  try { localStorage.setItem(KEY, JSON.stringify(model)); } catch { /* storage blocked */ }
  bus.emit('favoritesChanged', model);
}

export const favorites = {
  list() {
    return model.slice().sort((a, b) =>
      favLabel(a).localeCompare(favLabel(b), undefined, { sensitivity: 'base', numeric: true }));
  },
  get(id) { return model[idx(id)] || null; },
  has(id) { return id != null && idx(id) >= 0; },
  // p: { id, name, lat, lng }
  add(p) {
    if (!p || p.id == null) return;
    const e = { id: p.id, title: p.name || '', lat: p.lat, lng: p.lng };
    const i = idx(p.id);
    if (i >= 0) model[i] = e; else model.push(e);
    changed();
  },
  remove(id) {
    const i = idx(id);
    if (i < 0) return;
    model.splice(i, 1);
    changed();
  },
  toggle(p) {
    if (!p || p.id == null) return false;
    if (this.has(p.id)) { this.remove(p.id); return false; }
    this.add(p);
    return true;
  },
};
