// Adapter: raw API JSON → internal model. All contract rules that the renderer
// must not get wrong live here:
//   - faction blue|green|neutral → res|enl|neu
//   - link direction is source_portal_id, not vertex order
//   - field = exactly 3 vertices; field.mu === null ≠ 0 (we never compute MU)
//   - link/field vertices are self-contained (not guaranteed present in portals[])
//   - neutrality is faction, not level 0
import { factionByApi } from '../config.js';

const num = (v) => (typeof v === 'number' ? v : Number(v));
const pos = (p) => (p ? { lat: num(p.latitude), lng: num(p.longitude) } : null);

export function adaptPortal(p) {
  const c = pos(p.position);
  return {
    id: p.id,
    name: p.name || '',
    lat: c?.lat,
    lng: c?.lng,
    faction: factionByApi(p.faction).id,
    level: p.level | 0,
    resoCount: p.resonator_count | 0,
    xm: { cur: p.current_xm | 0, max: p.max_xm | 0 },
  };
}

// /portals/{id} → summary + card data. Resonators (8) and mods (4) are placed
// by their `slot`; an empty slot is null. Resonator slot 0 = north, clockwise
// in 45° steps. Owner names are nicknames (text), null when unset.
export function adaptPortalDetail(j) {
  const resonators = new Array(8).fill(null);
  for (const r of j.resonators || []) {
    if (!r || !(r.slot >= 0 && r.slot < 8)) continue;
    resonators[r.slot] = {
      slot: r.slot, level: r.level | 0, owner: r.owner || null,
      xm: { cur: r.current_xm | 0, max: r.max_xm | 0 },
    };
  }
  const mods = new Array(4).fill(null);
  for (const m of j.mods || []) {
    if (!m || !(m.slot >= 0 && m.slot < 4) || !m.spec) continue;
    mods[m.slot] = { slot: m.slot, owner: m.owner || null, spec: m.spec };
  }
  return {
    ...adaptPortal(j),
    photoUrl: j.photo_url || '',
    owner: j.owner || null,
    resonators,
    mods,
    // server link planning (API 1.1): range of a NEW outgoing link and the
    // portal's real link counts — all its links, not just the loaded viewport
    planning: j.planning ? {
      full: !!j.planning.fully_deployed,
      rangeM: num(j.planning.max_link_range_m) || 0,
      inc: j.planning.incoming_links | 0,
      out: j.planning.outgoing_links | 0,
      outLimit: j.planning.outgoing_limit | 0,
    } : null,
  };
}

// Vertex shape: { id, position:{ latitude, longitude } }. The vertex id IS the
// portal id (matches link.source_portal_id); vertices are self-contained.
function adaptVertex(v) {
  const c = pos(v.position);
  return { id: v.id ?? null, lat: c?.lat, lng: c?.lng };
}

export function adaptLink(l) {
  const verts = (l.vertices || []).map(adaptVertex);
  const srcIdx = verts.findIndex((v) => v.id === l.source_portal_id);
  const a = srcIdx >= 0 ? verts[srcIdx] : verts[0];
  const b = srcIdx >= 0 ? verts[1 - srcIdx] : verts[1];
  return { id: l.id, faction: factionByApi(l.faction).id, source: l.source_portal_id, a, b };
}

export function adaptField(f) {
  return {
    id: f.id,
    faction: factionByApi(f.faction).id,
    mu: f.mu == null ? null : num(f.mu), // null stays null — not 0
    v: (f.vertices || []).map(adaptVertex),
  };
}

// COMM event. Nested portals use flat latitude/longitude (unlike /map) and are
// historical snapshots. For links portals[0] is the source. `mu` only on field
// events and may still be null (computed later). distance_m is always 0 on
// this route — not a distance, deliberately dropped. Keyed by String(id).
export function adaptEvent(e) {
  return {
    id: String(e.id),
    kind: e.kind || '',
    time: Date.parse(e.time) || 0,
    nick: e.nickname || '',
    faction: factionByApi(e.faction).id,
    portals: (e.portals || []).map((p) => ({
      id: p.id, name: p.name || '', lat: num(p.latitude), lng: num(p.longitude),
    })),
    mu: e.mu == null ? null : num(e.mu),
  };
}

// Full /map response → model + the LOD/truncation metadata the UI surfaces.
export function adaptMap(json) {
  const portals = (json.portals || []).map(adaptPortal);
  const links = (json.links || []).map(adaptLink);
  const fields = (json.fields || []).map(adaptField);
  return {
    schema: json.schema,
    lod: json.lod || null,
    portalsOmitted: !!json.portals_omitted,
    truncated: json.truncated || null,
    portals, links, fields,
    corners: cornerPortals(portals, links, fields),
  };
}

// Portals known only as link ends and field corners — no name, level or XM.
// They stand in where /map has no portal entry: omitted by LOD at low zoom, or
// cut by the cap. The owner follows from the link/field: in the classic rules
// both ends of a link and every corner of a field belong to its faction.
function cornerPortals(portals, links, fields) {
  const known = new Set(portals.map((p) => p.id));
  const out = new Map();
  const add = (v, faction) => {
    if (v?.id != null && !known.has(v.id) && !out.has(v.id)) out.set(v.id, { id: v.id, lat: v.lat, lng: v.lng, faction });
  };
  for (const l of links) { add(l.a, l.faction); add(l.b, l.faction); }
  for (const f of fields) for (const v of f.v) add(v, f.faction);
  return [...out.values()];
}

// Agent profile (/me, /agents): the public card. AP may be int64; JS Number is
// exact up to 2^53, far above any real AP. next is null at the level cap.
export function adaptAgent(j) {
  const a = j?.agent || {};
  const n = a.next_level;
  return {
    id: a.id || null,
    nick: a.nickname || '',
    faction: factionByApi(a.faction).id,
    level: a.effective_level | 0,
    ap: num(a.ap) || 0,
    next: n ? { level: n.level | 0, required: num(n.required_ap) || 0, remaining: num(n.remaining_ap) || 0 } : null,
  };
}

// World MU balance (/score). Sums and percents stay null when the server has
// none (empty/partial/stale/disabled/unavailable) — never 0 or 50/50.
export function adaptScore(j) {
  const b = j?.balance || {};
  const n = (v) => (v == null ? null : num(v));
  return {
    status: b.status || 'unavailable',
    asOf: b.as_of ? Date.parse(b.as_of) : null,
    mu: { res: n(b.resistance_mu), enl: n(b.enlightened_mu) },
    pct: { res: n(b.resistance_percent), enl: n(b.enlightened_percent) },
    fields: n(b.active_fields),
  };
}
