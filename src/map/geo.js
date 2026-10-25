// Pure geometry helpers: geodesic ring area + human formatting. No Leaflet,
// no state — just math on [lat,lng] rings.
const R = 6378137; // WGS84 mean earth radius, metres
const rad = (d) => (d * Math.PI) / 180;

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
