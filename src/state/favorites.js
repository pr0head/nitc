// Starred portals and their groups, in localStorage.
//   nitc.fav       [{id, title, lat, lng, groups:[groupId]}] — the id is the
//                  stable handle; title/position are a cached copy, refreshed
//                  whenever an entry is opened (a portal can be renamed or moved)
//   nitc.favGroups [{id, name, open, shown}] — open: expanded in the list;
//                  shown: its portals take part in the "Избранное" highlight
//                  (on by default — switching a group off is a deliberate act)
//   nitc.favNone   the same "shown" flag for the portals in no group
// A portal may sit in several groups (a rival's home can also be an op target)
// or in none ("Без группы"). Emits 'favoritesChanged'.
import { bus } from './bus.js';

const KEY = 'nitc.fav';
const GKEY = 'nitc.favGroups';
const NKEY = 'nitc.favNone';

function read(key) {
  try {
    const a = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(a) ? a.filter((x) => x && x.id != null) : [];
  } catch { return []; }
}

// entries saved before groups existed simply have none
let model = read(KEY).map((f) => ({ ...f, groups: Array.isArray(f.groups) ? f.groups : [] }));
// groups from before the eye default (they still carry a colour) start shown:
// their "off" was never the user's choice
let groups = read(GKEY).map(({ color, ...g }) => (color === undefined ? g : { ...g, shown: true }));
let noneShown = (() => { try { return localStorage.getItem(NKEY) !== '0'; } catch { return true; } })();
const idx = (id) => model.findIndex((f) => String(f.id) === String(id));
export const favLabel = (f) => (f.title || '').trim() || 'Портал без названия';
const byLabel = (a, b) => favLabel(a).localeCompare(favLabel(b), undefined, { sensitivity: 'base', numeric: true });

function changed() {
  try {
    localStorage.setItem(KEY, JSON.stringify(model));
    localStorage.setItem(GKEY, JSON.stringify(groups));
    localStorage.setItem(NKEY, noneShown ? '1' : '0');
  } catch { /* storage blocked */ }
  bus.emit('favoritesChanged', model);
}

const newId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const group = (gid) => groups.find((g) => g.id === gid) || null;
const makeGroup = (name) => ({ id: newId(), name, open: true, shown: true });

export const favorites = {
  list() { return model.slice().sort(byLabel); },
  get(id) { return model[idx(id)] || null; },
  has(id) { return id != null && idx(id) >= 0; },
  // p: { id, name, lat, lng }; an existing entry keeps its groups
  add(p, groupIds) {
    if (!p || p.id == null) return;
    const i = idx(p.id);
    const prev = i >= 0 ? model[i].groups : [];
    const e = { id: p.id, title: p.name || '', lat: p.lat, lng: p.lng, groups: groupIds || prev };
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

  // ---- groups ----
  groups() { return groups.slice(); },
  group,
  inGroup(gid) { return model.filter((f) => f.groups.includes(gid)).sort(byLabel); },
  ungrouped() { return model.filter((f) => !f.groups.some(group)).sort(byLabel); },
  addGroup(name) {
    const g = makeGroup((name || '').trim() || 'Группа');
    groups.push(g);
    changed();
    return g;
  },
  updateGroup(gid, patch) {
    const g = group(gid);
    if (!g) return;
    Object.assign(g, patch);
    changed();
  },
  // the portals stay starred: in their other groups, or ungrouped
  removeGroup(gid) {
    groups = groups.filter((g) => g.id !== gid);
    for (const f of model) f.groups = f.groups.filter((x) => x !== gid);
    changed();
  },
  // membership of one portal in one group; joining a group stars the portal
  setInGroup(p, gid, on) {
    if (!p || p.id == null || !group(gid)) return;
    const f = this.get(p.id);
    if (!f) { if (on) this.add(p, [gid]); return; }
    f.groups = on ? [...new Set([...f.groups, gid])] : f.groups.filter((x) => x !== gid);
    changed();
  },
  // the "Без группы" eye
  get noneShown() { return noneShown; },
  setNoneShown(on) { noneShown = !!on; changed(); },
  // the "Избранное" highlight: starred and in at least one shown group (or in
  // none, with "Без группы" shown)
  highlighted(id) {
    const f = this.get(id);
    if (!f) return false;
    const mine = groups.filter((g) => f.groups.includes(g.id));
    return mine.length ? mine.some((g) => g.shown) : noneShown;
  },

  // ---- exchange: {type:'nitc-favorites', version:1, groups:[{name,portals}]} ----
  exportGroups(gids) {
    return {
      type: 'nitc-favorites', version: 1,
      groups: groups.filter((g) => gids.includes(g.id)).map((g) => ({
        name: g.name,
        portals: this.inGroup(g.id).map(({ id, title, lat, lng }) => ({ id, title, lat, lng })),
      })),
    };
  },
  // a group with the same name is merged into, else created; → added counts
  importGroups(data) {
    if (data?.type !== 'nitc-favorites' || !Array.isArray(data.groups)) throw new Error('format');
    let nG = 0, nP = 0;
    for (const src of data.groups) {
      const name = String(src?.name || '').trim();
      if (!name) continue;
      let g = groups.find((x) => x.name === name);
      if (!g) { g = makeGroup(name); groups.push(g); nG++; }
      for (const p of Array.isArray(src.portals) ? src.portals : []) {
        if (p?.id == null || !Number.isFinite(+p.lat) || !Number.isFinite(+p.lng)) continue;
        const f = this.get(p.id);
        if (f) {
          if (!f.groups.includes(g.id)) { f.groups.push(g.id); nP++; }
        } else {
          model.push({ id: p.id, title: String(p.title || ''), lat: +p.lat, lng: +p.lng, groups: [g.id] });
          nP++;
        }
      }
    }
    changed();
    return { groups: nG, portals: nP };
  },
};
