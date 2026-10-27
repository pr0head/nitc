// Agent tracks: where agents were lately, from the COMM events the feed has
// already loaded (no requests of its own). Kept apart from the feed: a new map
// area clears the feed, the tracks stay and keep growing.
//
// A place is the portal the agent acted at:
//   capture / neutralize    — the portal itself
//   link_create, first_link — the link's source (portals[0]); the agent stands there
// Destroyed links/fields don't say where the agent stood, and a field's first
// portal is not where its link was thrown from — those events are skipped.
// Repeats at one portal in a row collapse into one place with the latest time;
// the place keeps what was done there (actions, a link's target).
import { TRACK } from '../config.js';

const PLACE_KINDS = new Set(['capture', 'neutralize', 'link_create', 'first_link']);
const okLL = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

const seen = new Map();   // event id → time (dedupe; pruned with the window)
const agents = new Map(); // key → { key, id, nick, faction, last, events: [{ time, kind, portal, target }] }

const keyOf = (ev) => (ev.actorId ? 'id:' + ev.actorId : 'nick:' + ev.nick.toLowerCase());
const horizon = (now = Date.now()) => now - TRACK.windowMs;

export const tracks = {
  // adapted COMM events → whether anything new was stored
  add(events) {
    const lim = horizon();
    let changed = false;
    for (const ev of events || []) {
      if (seen.has(ev.id) || ev.time < lim || !PLACE_KINDS.has(ev.kind)) continue;
      if (ev.faction !== 'res' && ev.faction !== 'enl') continue;
      const portal = ev.portals[0];
      if (!okLL(portal) || !ev.nick) continue;
      seen.set(ev.id, ev.time);
      const key = keyOf(ev);
      let a = agents.get(key);
      if (!a) agents.set(key, (a = { key, id: ev.actorId, nick: ev.nick, faction: ev.faction, last: 0, events: [] }));
      a.events.push({ time: ev.time, kind: ev.kind, portal, target: ev.portals[1] || null });
      // the newest event names the agent (a nickname can change)
      if (ev.time >= a.last) { a.last = ev.time; a.nick = ev.nick; a.faction = ev.faction; }
      changed = true;
    }
    return changed;
  },

  // drop what fell out of the window; whether anything went
  prune(now = Date.now()) {
    const lim = horizon(now);
    let changed = false;
    for (const [id, t] of seen) if (t < lim) seen.delete(id);
    for (const [key, a] of agents) {
      const n = a.events.length;
      a.events = a.events.filter((e) => e.time >= lim);
      if (a.events.length !== n) changed = true;
      if (!a.events.length) agents.delete(key);
    }
    return changed;
  },

  // every agent with its places, oldest first
  all() {
    return [...agents.values()].map((a) => ({ ...a, places: places(a) }));
  },

  get(key) {
    const a = agents.get(key);
    return a ? { ...a, places: places(a) } : null;
  },

  // the agent card asks by profile id, or by nickname when an event had no id
  find({ id, nick }) {
    const a = (id && agents.get('id:' + id)) || (nick && agents.get('nick:' + nick.toLowerCase())) ||
      (nick && [...agents.values()].find((x) => x.nick.toLowerCase() === nick.toLowerCase()));
    return a ? { ...a, places: places(a) } : null;
  },
};

// "12 мин назад", "1 ч 5 мин назад"
export function ago(t, now = Date.now()) {
  const m = Math.floor((now - t) / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} ч ${r} мин назад` : `${h} ч назад`;
}

function places(a) {
  const evs = [...a.events].sort((x, y) => x.time - y.time);
  const out = [];
  for (const e of evs) {
    const last = out[out.length - 1];
    const act = { kind: e.kind, time: e.time, target: e.target };
    if (last && last.portal.id === e.portal.id) { last.time = e.time; last.actions.push(act); continue; }
    out.push({ time: e.time, portal: e.portal, actions: [act] });
  }
  return out;
}
