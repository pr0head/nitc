// Range mods for the link plan: the mods that boost link range (Link Amps,
// SoftBank), offered as an alternative to raising a portal's level. There is
// no catalog to ask, so the classic ones (GAME.rangeMods) stand in, and the
// server's spec of a mod seen on a portal card replaces the one of its type
// and rarity.
//
// Stored (localStorage 'nitc.mods'): { kind: {kind, name, type, rarity, range} }.
import { bus } from './bus.js';
import { GAME } from '../config.js';

const KEY = 'nitc.mods';
let byKind = {};
try { byKind = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { byKind = {}; }

// d: an adapted portal detail
export function learnMods(d) {
  let changed = false;
  for (const m of d?.mods || []) {
    const s = m?.spec, r = +s?.range_multiplier;
    if (!s?.kind || !(r > 0)) continue;
    const was = byKind[s.kind];
    if (was && was.range === r && was.name === s.name && was.type === s.type) continue;
    byKind[s.kind] = { kind: s.kind, name: s.name || s.kind, type: s.type || '', rarity: s.rarity || '', range: r };
    changed = true;
  }
  if (!changed) return;
  try { localStorage.setItem(KEY, JSON.stringify(byKind)); } catch {}
  bus.emit('modsLearned');
}

// the range mods, strongest first
export function rangeMods() {
  const seen = Object.values(byKind);
  const kinds = [...seen, ...GAME.rangeMods.filter((m) => !seen.some((x) => x.type === m.type && x.rarity === m.rarity))];
  return kinds.sort((a, b) => b.range - a.range);
}
