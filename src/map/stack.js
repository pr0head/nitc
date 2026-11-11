// Field stack: how many layers a field is part of. Tap a field anywhere and
// the answer is the same — the depth of its matryoshka, not the count under
// the finger.
//
// A matryoshka is a set of fields on one base AB (two anchor portals), all on
// the same side of it. Links don't cross, so two fields ABP and ABQ on one
// side are always nested (one apex is inside the other field): the number of
// fields on a base side IS the depth of that stack. No geometry search — every
// field the map returns carries all three vertices with portal IDs, even the
// ones off screen, so the anchors are known from a piece of the stack too.
//
// The base of a tapped field is the side of it the most fields share. Of all
// the fields under the finger, the deepest such stack wins.
import { ringArea } from './geo.js';

const rad = (d) => (d * Math.PI) / 180;
const vec = (p) => {
  const a = rad(p.lat), l = rad(p.lng);
  return [Math.cos(a) * Math.cos(l), Math.cos(a) * Math.sin(l), Math.sin(a)];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const ok = (fd) => fd.v.length === 3 && fd.v.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
// a portal's key: its ID, or (a vertex without one) its position
const keyOf = (p) => p.id ?? `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

// is P inside the spherical triangle ABC (the edges count as inside)
function inside(P, [A, B, C]) {
  const s = Math.sign(dot(cross(A, B), C));
  if (!s) return false; // degenerate
  return dot(cross(A, B), P) * s >= 0 && dot(cross(B, C), P) * s >= 0 && dot(cross(C, A), P) * s >= 0;
}

// the fields that cover a point (the original layer count)
export function fieldsAt(fields, pt) {
  const P = vec(pt);
  return fields.filter((fd) => ok(fd) && inside(P, fd.v.map(vec)));
}

// the three sides of a field as stack keys: the base's portals in a fixed
// order plus the side of it the field's apex is on
function sides(fd) {
  return [[0, 1, 2], [1, 2, 0], [2, 0, 1]].map(([i, j, k]) => {
    let a = fd.v[i], b = fd.v[j];
    if (keyOf(a) > keyOf(b)) [a, b] = [b, a];
    const side = Math.sign(dot(cross(vec(a), vec(b)), vec(fd.v[k])));
    return { key: `${fd.faction}|${keyOf(a)}|${keyOf(b)}|${side}`, a, b };
  });
}

// fields: what is loaded; pt: {lat,lng}. → null when no field covers it, else
//   over  — the fields covering the point
//   stack — the deepest stack among them, outermost first
//   base  — its two anchors [a, b] ({id, lat, lng})
//   outer — the outermost field of the stack
export function stackAt(fields, pt) {
  const over = fieldsAt(fields, pt);
  if (!over.length) return null;
  const groups = new Map();
  for (const fd of fields) {
    if (!ok(fd)) continue;
    for (const s of sides(fd)) {
      let g = groups.get(s.key);
      if (!g) groups.set(s.key, g = { a: s.a, b: s.b, fields: [] });
      g.fields.push(fd);
    }
  }
  let best = null;
  for (const fd of over) {
    for (const s of sides(fd)) {
      const g = groups.get(s.key);
      if (!best || g.fields.length > best.fields.length) best = g;
    }
  }
  const area = (fd) => (fd._area ??= ringArea(fd.v.map((p) => [p.lat, p.lng])));
  const stack = [...best.fields].sort((x, y) => area(y) - area(x));
  return { over, stack, base: [best.a, best.b], outer: stack[0] };
}
