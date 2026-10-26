// Draws the internal model onto Leaflet layer groups. Pure rendering: no fetch,
// no API rules (those are in the adapter). Rebuilt wholesale on each data load
// or filter change. Filters run here against already-loaded data (no refetch).
//
// Drawing rules:
//   fields toggle → field FILL only (no edges)
//   links toggle  → standalone links AND the 3 edges of every field
//   portals       → fixed-size dot, black outline; selected = thicker red outline
//   corner portals (link/field ends with no portal data) → smaller dot under
//                   the portals; faction filter only (no level to filter by)
import L from 'leaflet';
import { FACTION } from '../config.js';

export const fcol = (id) => FACTION[id]?.color || FACTION.neu.color;
export const ll = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

export const PORTAL_R = 7;
const CORNER_R = 4;
const SEL_COL = '#ff2d2d';

// Links/fields have no neutral toggle — only the two faction toggles gate them.
const factionOn = (f, fac) => (fac === 'res' ? !!f.res : fac === 'enl' ? !!f.enl : true);

// Shared visibility predicates — the renderer and the highlight overlay must
// agree on exactly what is shown. Unclaimed portals obey only their own toggle
// (no level/faction filter); claimed ones obey level (clamped 1..8) + faction.
export function portalVisible(p, f) {
  if (p.faction === 'neu') return !!f.neutral;
  const lvl = Math.max(1, Math.min(8, p.level || 1));
  return !!f.levels[lvl] && factionOn(f, p.faction);
}
export const fieldVisible = (fd, f) => !!f.fields && factionOn(f, fd.faction);

export function makeGroups(map) {
  // z-order: fields under links under portals.
  const fields = L.layerGroup().addTo(map);
  const links = L.layerGroup().addTo(map);
  const portals = L.layerGroup().addTo(map);
  return { fields, links, portals };
}

const ring = (fd) => fd.v.map((p) => [p.lat, p.lng]);
const okField = (fd) => fd.v.length >= 3 && fd.v.every(ll);

// style(p) → { top, bot, text } from the highlight rules, or null.
// Returns the overlay marks (arcs/text) for portals that got a style.
export function render(groups, data, { onPortalClick, selectedId, filters: f, style } = {}) {
  groups.fields.clearLayers();
  groups.links.clearLayers();
  groups.portals.clearLayers();

  if (f.fields) {
    for (const fd of data.fields) {
      if (!okField(fd) || !factionOn(f, fd.faction)) continue;
      L.polygon(ring(fd), {
        stroke: false, fillColor: fcol(fd.faction), fillOpacity: 0.15, interactive: false,
      }).addTo(groups.fields);
    }
  }

  if (f.links) {
    for (const fd of data.fields) {
      if (!okField(fd) || !factionOn(f, fd.faction)) continue;
      L.polygon(ring(fd), {
        fill: false, color: fcol(fd.faction), weight: 1.2, opacity: 0.8, interactive: false,
      }).addTo(groups.links);
    }
    for (const l of data.links) {
      if (!ll(l.a) || !ll(l.b) || !factionOn(f, l.faction)) continue;
      L.polyline([[l.a.lat, l.a.lng], [l.b.lat, l.b.lng]], {
        color: fcol(l.faction), weight: 1.3, opacity: 0.8, interactive: false,
      }).addTo(groups.links);
    }
  }

  // a click opens the regular card: the id is real, /portals/{id} has the rest
  for (const p of data.corners || []) {
    if (!ll(p) || !factionOn(f, p.faction)) continue;
    const sel = p.id === selectedId;
    L.circleMarker([p.lat, p.lng], {
      radius: CORNER_R,
      color: sel ? SEL_COL : '#000',
      weight: sel ? 2.5 : 1,
      fillColor: fcol(p.faction),
      fillOpacity: 0.9,
    }).on('click', () => onPortalClick?.({ id: p.id, name: '', lat: p.lat, lng: p.lng }))
      .addTo(groups.portals);
  }

  const marks = [];
  for (const p of data.portals) {
    if (!ll(p) || !portalVisible(p, f)) continue;
    const st = style ? style(p) : null;
    const styled = !!(st && (st.top || st.bot || st.text));
    const sel = p.id != null && p.id === selectedId;
    const m = L.circleMarker([p.lat, p.lng], {
      radius: PORTAL_R,
      color: sel ? SEL_COL : '#000',
      weight: sel ? 2.5 : 1.2,
      fillColor: fcol(p.faction),
      fillOpacity: styled ? 1 : 0.9, // a styled portal is drawn opaque
    });
    m.on('click', () => onPortalClick?.(p));
    m.addTo(groups.portals);
    if (styled) marks.push({ lat: p.lat, lng: p.lng, r: PORTAL_R, ...st });
  }
  return marks;
}
