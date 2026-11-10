// Field-label sizing shared by the field overlay and drawn polygons: the
// bigger a field is on screen, the bigger its label (11…13 px, +1 on touch
// screens, read at arm's length).
const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 1 : 0;

// areaPx: the shape's on-screen area in CSS px²
export function labelPx(areaPx) {
  const side = Math.sqrt(Math.max(0, areaPx));
  return TOUCH + Math.round(Math.min(13, Math.max(11, 11 + (side - 50) / 100)));
}

// Absolute area of an on-screen polygon (points with x/y), shoelace formula.
export function screenArea(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  return Math.abs(s) / 2;
}
