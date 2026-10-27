// Portal figures for the card, from an adapted portal detail (classic-Ingress
// rules, base values in GAME). What each mod does is read from the server's
// mod spec — never from a static table of our own.
import { GAME } from '../config.js';

const deployed = (d) => d.resonators.filter(Boolean);
const mods = (d) => d.mods.filter(Boolean);
// one spec value from every mod that has it, strongest first
const strongest = (d, key) =>
  mods(d).map((m) => +m.spec[key] || 0).filter((v) => v > 0).sort((a, b) => b - a);
// strongest in full, the rest scaled by their position in the stack
const stack = (vals, weights) => vals.reduce((s, v, i) => s + v * (weights[i] ?? 0), 0);

// Mitigation from every mod that carries it (shields, AXA), capped.
export const shieldingPct = (d) =>
  Math.min(GAME.shieldCapPct, strongest(d, 'mitigation').reduce((s, v) => s + v, 0));

export const hacks = (d) => GAME.baseHacks + Math.round(stack(strongest(d, 'hacks'), GAME.stackHalf));

// heat = cooldown reduction fraction; the stack applies multiplicatively
export function cooldownS(d) {
  const mult = strongest(d, 'heat').reduce((m, h, i) => m * (1 - h * (GAME.stackHalf[i] ?? 0)), 1);
  return Math.round(GAME.baseCooldownS * mult);
}

export function linkAmpMult(d) {
  const v = strongest(d, 'range_multiplier');
  return v.length ? stack(v, GAME.stackLinkAmp) : 1;
}

// Mean over all 8 SLOTS, so missing resonators count as 0. You can't link from
// an incomplete portal, hence `full`.
export function linkRange(d) {
  const meanL = d.resonators.reduce((s, r) => s + (r ? r.level : 0), 0) / 8;
  const m = GAME.linkRangeBaseM * meanL ** 4 * linkAmpMult(d);
  return { m, meanL, full: deployed(d).length === 8 };
}

// Portal XM: current vs the sum of its deployed resonators' maxima.
export function energy(d) {
  let cur = 0, max = 0;
  for (const r of deployed(d)) { cur += Math.max(0, Math.min(r.xm.max, r.xm.cur)); max += r.xm.max; }
  return { cur, max, pct: max ? (cur / max) * 100 : null };
}

export const resoPct = (r) => (r && r.xm.max ? Math.max(0, Math.min(100, (r.xm.cur / r.xm.max) * 100)) : null);

// Links and fields touching this portal, from the loaded viewport (so only what
// the current view loaded). Vertex ids are portal ids. A field's 3 edges are
// links too, and the map draws them from the fields layer — but the links array
// can still lack one (LOD threshold, truncation). Those count as `extra`: their
// direction is unknown, so they are neither in nor out.
export function graph(id, data) {
  const key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  const seen = new Set();
  let inc = 0, out = 0, extra = 0, fields = 0;
  for (const l of data.links) {
    const a = l.a?.id, b = l.b?.id; // a = source
    if (a !== id && b !== id) continue;
    if (b === id) inc++; else out++;
    seen.add(key(a, b));
  }
  for (const f of data.fields) {
    const ids = f.v.map((v) => v.id);
    if (!ids.includes(id)) continue;
    fields++;
    for (let i = 0; i < 3; i++) {
      const a = ids[i], b = ids[(i + 1) % 3];
      if (a !== id && b !== id) continue;
      const k = key(a, b);
      if (seen.has(k)) continue;
      seen.add(k);
      extra++;
    }
  }
  return { inc, out, extra, links: inc + out + extra, fields };
}

// AP for destroying the portal: every resonator, link and field that goes down.
export const destroyAp = (d, g) =>
  GAME.ap.resonator * deployed(d).length + GAME.ap.link * g.links + GAME.ap.field * g.fields;
