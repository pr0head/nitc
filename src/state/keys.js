// Own portal keys (/v1/intel/me/keys): the whole set, every page, replaced
// wholesale on each reload. "No key for this portal" is only certain once all
// pages are in (`ready`). Personal data: kept in memory only, never stored.
//
// Reloaded at start, every few minutes while the tab is visible, and on demand
// (inventory window). Each page is one request from the shared budget, so the
// walk is capped.
import { getKeys } from '../api/intel.js';
import { bus } from './bus.js';

const MAX_PAGES = 40; // 40 × 128 = 5120 portals with keys
const REFRESH_MS = 5 * 60 * 1000;

let byId = new Map(); // portal id → { id, name, lat, lng, qty, free, inCaps }
let state = 'idle';   // idle | loading | ready | error
let loadedAt = 0;
let running = null;

const num = (v) => (typeof v === 'number' ? v : Number(v)) || 0;

async function walk() {
  const next = new Map();
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await getKeys(cursor);
    for (const k of r?.items || []) {
      next.set(k.portal_id, {
        id: k.portal_id, name: k.name || '',
        lat: num(k.position?.latitude), lng: num(k.position?.longitude),
        qty: num(k.quantity), free: num(k.available_quantity), inCaps: num(k.contained_quantity),
      });
    }
    cursor = r?.next_cursor || '';
    if (!cursor) return next;
  }
  return next; // capped: the set is incomplete, but what we have is real
}

export const keys = {
  get state() { return state; },
  get ready() { return state === 'ready'; },
  get loadedAt() { return loadedAt; },
  get(id) { return byId.get(id) || null; },
  qty(id) { return byId.get(id)?.qty || 0; },
  get size() { return byId.size; },
  list() { return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru')); },
  // one walk at a time; a failed walk keeps the last full set
  reload() {
    if (running) return running;
    if (!loadedAt) state = 'loading'; // a refresh keeps showing the last set
    bus.emit('keysChanged');
    running = walk().then((m) => {
      byId = m; state = 'ready'; loadedAt = Date.now();
    }).catch(() => {
      state = loadedAt ? 'ready' : 'error';
    }).finally(() => {
      running = null;
      bus.emit('keysChanged');
    });
    return running;
  },
  start() {
    keys.reload();
    setInterval(() => { if (!document.hidden) keys.reload(); }, REFRESH_MS);
  },
};
