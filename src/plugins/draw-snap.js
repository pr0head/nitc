// Auto-snap for the draw tools: a vertex always stands on a portal. A tap
// anywhere takes the nearest portal shown on screen (layer filters apply; at a
// far zoom the link/field ends are the portals there are), skipping the
// portals the shape already uses. Nothing to snap to → a reason to show.
//
// That holds while the map knows every portal on screen. Zoomed out, the
// server sends only the linked ones (the grey portals are left out), so a
// vertex can't be told where it belongs: there it snaps only to a dot within
// reach, and is otherwise left free, where it was put. A free vertex snaps to
// the nearest portal close by once the map has the portals in full (zoom in).
//
// Clone picks the new vertex the same way, with two more conditions: it lies
// past the clicked vertex (beyond the kept base, outside the shape — a nested
// field over the same base), and none of its new edges crosses the plan.
import { portalVisible, cornerVisible, ll } from '../map/render.js';
import { greatArc, arcsCross } from '../map/geo.js';

export const NO_PORTALS = 'Нет порталов для привязки — приблизьте карту или сместитесь туда, где они есть';
export const NO_FREE = 'Свободных порталов на экране нет';
export const NO_CLONE = 'Нет свободного портала за этой вершиной без пересечений с планом';
export const LOOSE = 'Вершина не привязана — приблизьте карту, она встанет на портал';
const AUTO_PX = 30; // a free vertex this close to a portal takes it on zoom-in

export const keyOf = (p) => (+p.lat).toFixed(7) + ',' + (+p.lng).toFixed(7);

// plan edges as arcs, for the crossing test
function planArcs(model) {
  const out = [];
  for (const s of model) {
    const v = s.latLngs, n = s.type === 'polygon' ? v.length : v.length - 1;
    for (let i = 0; i < n; i++) {
      const a = v[i], b = v[(i + 1) % v.length];
      out.push(greatArc([a.lat, a.lng], [b.lat, b.lng]));
    }
  }
  return out;
}

const side = (a, b, p) => Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));

export function createSnap({ map, engine }) {
  // the portals shown on screen right now, with their screen points
  function targets() {
    const d = engine.getData(), f = engine.prefs.filters, b = map.getBounds(), out = [];
    const add = (p) => { if (b.contains([p.lat, p.lng])) out.push({ p, pt: map.latLngToContainerPoint([p.lat, p.lng]) }); };
    for (const p of d.portals) if (ll(p) && portalVisible(p, f)) add(p);
    for (const p of d.corners || []) if (ll(p) && cornerVisible(p, f)) add(p);
    return out;
  }

  // the map has every portal on screen: no LOD omission, no truncation
  function full() {
    const d = engine.getData();
    return !d.portalsOmitted && d.lod?.has_portals !== false && !d.truncated?.portals;
  }

  // → { p } the nearest free portal to latlng, or { err }
  function nearest(latlng, taken = new Set()) {
    const ts = targets();
    if (!ts.length) return { err: NO_PORTALS };
    const c = map.latLngToContainerPoint(latlng);
    let best = null, bd = Infinity;
    for (const t of ts) {
      if (taken.has(keyOf(t.p))) continue;
      const d = c.distanceTo(t.pt);
      if (d < bd) { bd = d; best = t.p; }
    }
    return best ? { p: best } : { err: NO_FREE };
  }

  // where a vertex put at latlng goes: { p } a portal, { free: true } stay
  // as put (portals not all known), or { err }. reach: px around latlng a dot
  // counts as aimed at while the portals are not all known.
  function place(latlng, taken, reach) {
    if (full()) return nearest(latlng, taken);
    const r = nearest(latlng, taken);
    if (r.p && map.latLngToContainerPoint(latlng).distanceTo(map.latLngToContainerPoint([r.p.lat, r.p.lng])) <= reach) return r;
    return { free: true };
  }

  // a free vertex v (not one of `taken`), now that the portals may be known:
  // → the portal close by to take, or null
  function settle(v, taken) {
    if (!full() || !map.getBounds().contains([v.lat, v.lng])) return null;
    const r = nearest(v, taken);
    if (!r.p) return null;
    const d = map.latLngToContainerPoint([v.lat, v.lng]).distanceTo(map.latLngToContainerPoint([r.p.lat, r.p.lng]));
    return d <= AUTO_PX ? r.p : null;
  }

  // shape s cloned past vertex vi: → { p } the new vertex, or { err }.
  // `toward` is the screen point the copy would ideally take; with the
  // portals not all known and none fitting, { free: true } — the copy's
  // vertex stays there, to be settled on zoom-in. Only a dot within reach
  // of `toward` is taken then: a linked portal further out is no guess.
  function cloneTarget(model, s, vi, toward, reach) {
    const all = full();
    const ts = targets();
    if (!ts.length) return all ? { err: NO_PORTALS } : { free: true };
    const kept = s.latLngs.filter((_, i) => i !== vi);
    const taken = new Set(s.latLngs.map(keyOf));
    const arcs = planArcs(model);
    const scr = (v) => map.latLngToContainerPoint([v.lat, v.lng]);
    const apex = scr(s.latLngs[vi]);
    const base = kept.map(scr);
    const ring = s.latLngs.map(scr);
    // inside the shape on screen (a convex triangle; a line has no inside)
    const inside = (q) => ring.length >= 3 &&
      ring.every((a, i) => side(a, ring[(i + 1) % ring.length], q) === side(ring[0], ring[1], ring[2]));
    const cands = ts.filter((t) => !taken.has(keyOf(t.p)))
      .sort((x, y) => x.pt.distanceTo(toward) - y.pt.distanceTo(toward));
    for (const { p, pt } of cands) {
      if (!all && pt.distanceTo(toward) > reach) break; // nothing aimed at: stay free
      // a triangle: on the apex's side of the base and outside the shape;
      // a line: anything past the kept end will do
      if (base.length === 2 && (side(base[0], base[1], pt) !== side(base[0], base[1], apex) || inside(pt))) continue;
      const edges = kept.map((v) => greatArc([v.lat, v.lng], [p.lat, p.lng]));
      if (edges.some((e) => arcs.some((a) => arcsCross(e, a)))) continue;
      return { p };
    }
    return all ? { err: NO_CLONE } : { free: true };
  }

  return { targets, nearest, place, settle, cloneTarget };
}
