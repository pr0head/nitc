// Single source of runtime constants. Keep game-rule numbers here, not scattered.

// API base. The JS talks to the game API directly from the browser — the only
// obstacle is CORS: Netgress allows just a couple of origins, so our origin must
// be whitelisted before a direct call works (otherwise 403 origin_denied, before
// the token even matters).
//   - Once our origin is whitelisted, set VITE_API_BASE to the API origin and we
//     call it directly, no proxy — the target scheme. Works in dev and prod.
//   - Until then, dev falls back to the Vite proxy (/api → upstream, Origin
//     stripped) so we can develop without waiting on the whitelist.
const UPSTREAM = 'https://netgress.glubina.org';
export const API_BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? '/api' : UPSTREAM);

// Classic-Ingress factions. API gives blue|green|neutral; we normalize to these.
export const FACTION = {
  res: { id: 'res', api: 'blue', name: 'Resistance', color: '#2aa9ff' },
  enl: { id: 'enl', api: 'green', name: 'Enlightened', color: '#33cc44' },
  neu: { id: 'neu', api: 'neutral', name: 'Neutral', color: '#9aa0a6' },
};
export const factionByApi = (f) =>
  f === 'blue' ? FACTION.res : f === 'green' ? FACTION.enl : FACTION.neu;

// Map / networking tuning. Honors the API budget (120 req/min/user).
export const MAP = {
  center: [55.7558, 37.6173], // Moscow
  zoom: 15,
  minPortalZoom: 15, // below this the API omits portals (links-only LOD)
  moveDebounceMs: 350,
  refreshMs: 30000,
};

// Classic-Ingress portal rules used by the portal card. What each mod does comes
// from the server's mod spec; these are only the base values and stacking.
export const GAME = {
  actionRadiusM: 40,      // hack/deploy/link range around a portal
  linkRangeBaseM: 160,    // max link range = base × (mean resonator level)^4 × link amps
  baseHacks: 4,           // hacks before burnout, before multi-hacks
  baseCooldownS: 300,     // hack cooldown, before heat sinks
  shieldCapPct: 95,       // mitigation never exceeds this
  weakResoPct: 25,        // a resonator at/below this % of its max reads as critical
  // stacking: strongest mod in full, the rest at a fraction, by strength order
  stackHalf: [1, 0.5, 0.5, 0.5],          // multi-hack, heat sink
  stackLinkAmp: [1, 0.25, 0.125, 0.125],  // link amp
  ap: { resonator: 75, link: 187, field: 750 }, // AP for destroying each
};
