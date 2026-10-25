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
  return {
    schema: json.schema,
    lod: json.lod || null,
    portalsOmitted: !!json.portals_omitted,
    truncated: json.truncated || null,
    portals: (json.portals || []).map(adaptPortal),
    links: (json.links || []).map(adaptLink),
    fields: (json.fields || []).map(adaptField),
  };
}
