// Pure geometry helpers: great-circle paths and circles, geodesic ring area,
// human formatting. No Leaflet, no state — just math on [lat,lng] points.
const R = 6378137; // WGS84 mean earth radius, metres
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// ---- great circles ------------------------------------------------------
// Links are great-circle arcs; Leaflet joins points with a straight line on
// the projected map (a rhumb line), which strays from the arc as links grow:
// ~1 m at 5 km, ~280 m at 100 km, ~28 km at 1000 km (east–west at 55°N).
// geodesicPath() adds points along the arc to every segment longer than
// STEP_M, so it is drawn as a smooth curve; shorter segments (under a metre
// of error) stay as they are. Longitudes come out continuous (unwrapped), so a
// path over the 180th meridian runs on past ±180 instead of across the world.
const STEP_M = 2000;
const MAX_STEPS = 512;

const vec = (lat, lng) => {
  const p = rad(lat), l = rad(lng);
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
};

// central angle between two points (haversine, stable for short distances)
function angle(a, b) {
  const dp = rad(b[0] - a[0]), dl = rad(b[1] - a[1]);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dl / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// pts: [[lat,lng],…]; closed: a polygon ring (the last→first edge too, without
// repeating the first point). → [[lat,lng],…]
export function geodesicPath(pts, closed = false) {
  const n = pts.length;
  if (n < 2) return pts.slice();
  const out = [[pts[0][0], pts[0][1]]];
  const edges = closed ? n : n - 1;
  for (let i = 0; i < edges; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const d = angle(a, b);
    const steps = Math.min(MAX_STEPS, Math.ceil((d * R) / STEP_M));
    if (steps > 1) {
      const A = vec(a[0], a[1]), B = vec(b[0], b[1]), s = Math.sin(d);
      for (let k = 1; k < steps; k++) {
        const t = k / steps, k1 = Math.sin((1 - t) * d) / s, k2 = Math.sin(t * d) / s;
        const x = k1 * A[0] + k2 * B[0], y = k1 * A[1] + k2 * B[1], z = k1 * A[2] + k2 * B[2];
        out.push([deg(Math.atan2(z, Math.hypot(x, y))), deg(Math.atan2(y, x))]);
      }
    }
    if (!closed || i < n - 1) out.push([b[0], b[1]]);
  }
  // keep longitudes continuous across the antimeridian
  for (let i = 1; i < out.length; i++) {
    const dl = out[i][1] - out[i - 1][1];
    if (dl > 180) out[i][1] -= 360 * Math.round(dl / 360);
    else if (dl < -180) out[i][1] += 360 * Math.round(-dl / 360);
  }
  return out;
}

// A circle of radius m metres on the sphere around c=[lat,lng], as a ring of
// points (for a link range of hundreds of km a projected circle is off).
export function geodesicCircle(c, m, points = 96) {
  const p1 = rad(c[0]), l1 = rad(c[1]), d = m / R;
  const ring = [];
  for (let i = 0; i < points; i++) {
    const br = (2 * Math.PI * i) / points;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(br));
    const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    ring.push([deg(p2), deg(l2)]); // l2 stays near c's longitude: no wrap jump
  }
  return ring;
}

// The point m metres from c=[lat,lng] along the initial bearing br (degrees
// clockwise from north), on the sphere.
export function destination(c, br, m) {
  const p1 = rad(c[0]), l1 = rad(c[1]), d = m / R, b = rad(br);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [deg(p2), deg(l2)];
}

// Absolute area of a lat/lng ring in m² (spherical excess). ring: [[lat,lng],…].
export function ringArea(ring) {
  const n = ring.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const [lat1, lng1] = ring[i];
    const [lat2, lng2] = ring[(i + 1) % n];
    sum += rad(lng2 - lng1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((sum * R * R) / 2);
}

export function fmtArea(m2) {
  const km2 = m2 / 1e6;
  if (km2 >= 100) return Math.round(km2) + ' km²';
  if (km2 >= 1) return km2.toFixed(1) + ' km²';
  if (km2 >= 0.01) return km2.toFixed(2) + ' km²';
  return Math.round(m2) + ' m²'; // "0.00 km²" would say nothing
}
