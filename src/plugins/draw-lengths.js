// Link lengths on the plan: every edge of the drawn shapes gets its
// great-circle length at the middle of its arc, turned along it — for reading
// a finished plan (ranges, link amps), not for the drawing itself. Toggled by
// the ruler in the draw panel, remembered in prefs.
//
// Nested fields draw the same base again and again, and their edges fan out
// of one or two anchors: labelled naively, they would pile up. So an edge
// shared by several shapes is labelled once, the longest edges are placed
// first, and a label that would overlap one already placed — or does not fit
// along its own edge on screen — is left out. Zooming in brings the rest
// back: the layout is redone on every move.
import L from 'leaflet';
import { prefs } from '../state/prefs.js';
import { distanceM, midpoint, fmtLength } from '../map/geo.js';
import { labelPx } from '../map/label.js';
import { esc } from '../ui/esc.js';

const FONT = '-apple-system, system-ui, "Segoe UI", Roboto, Arial, sans-serif';
const END_GAP = 12; // px kept free at each end of an edge (its vertices)
const PAD = 2;      // px between two labels

const measure = document.createElement('canvas').getContext('2d');

// shapes → unique edges [{a, b, m, color}], longest first
function edgesOf(model, defColor) {
  const seen = new Map();
  const key = (p) => p[0].toFixed(6) + ',' + p[1].toFixed(6);
  for (const s of model) {
    const lls = s.latLngs.map((p) => [p.lat, p.lng]);
    const n = s.type === 'polygon' ? lls.length : lls.length - 1;
    for (let i = 0; i < n; i++) {
      const a = lls[i], b = lls[(i + 1) % lls.length];
      const ka = key(a), kb = key(b);
      if (ka === kb) continue;
      const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      if (!seen.has(k)) seen.set(k, { a, b, m: distanceM(a, b), color: s.color || defColor });
    }
  }
  return [...seen.values()].sort((x, y) => y.m - x.m);
}

// do two rotated boxes {x, y, hw, hh, c, s} overlap? (separating axes)
function overlap(p, q) {
  for (const [ax, ay] of [[p.c, p.s], [-p.s, p.c], [q.c, q.s], [-q.s, q.c]]) {
    const r = (b) => b.hw * Math.abs(b.c * ax + b.s * ay) + b.hh * Math.abs(-b.s * ax + b.c * ay);
    if (Math.abs((q.x - p.x) * ax + (q.y - p.y) * ay) > r(p) + r(q)) return false;
  }
  return true;
}

export function createLengths({ map, pane, defColor }) {
  const layer = L.layerGroup();
  let model = [], shown = false;

  function layout() {
    layer.clearLayers();
    if (!shown || !prefs.drawLengths || !model.length) return;
    const size = map.getSize(), px = labelPx(0);
    measure.font = `700 ${px}px ${FONT}`;
    const placed = [];
    for (const e of edgesOf(model, defColor)) {
      const pa = map.latLngToContainerPoint(e.a), pb = map.latLngToContainerPoint(e.b);
      const mid = midpoint(e.a, e.b), pm = map.latLngToContainerPoint(mid);
      if (pm.x < 0 || pm.y < 0 || pm.x > size.x || pm.y > size.y) continue;
      const text = fmtLength(e.m);
      const w = measure.measureText(text).width + 4; // + the outline
      const len = pa.distanceTo(pb);
      if (len < w + 2 * END_GAP) continue; // does not fit along its edge
      let ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
      if (ang > Math.PI / 2) ang -= Math.PI; else if (ang <= -Math.PI / 2) ang += Math.PI; // never upside down
      const box = { x: pm.x, y: pm.y, hw: w / 2 + PAD, hh: px / 2 + 2 + PAD, c: Math.cos(ang), s: Math.sin(ang) };
      if (placed.some((p) => overlap(p, box))) continue;
      placed.push(box);
      L.marker(mid, {
        interactive: false, keyboard: false, pane,
        icon: L.divIcon({
          className: 'map-lbl', iconSize: null,
          html: `<span style="color:${esc(e.color)};font-size:${px}px;transform:translate(-50%,-50%) rotate(${ang.toFixed(3)}rad)">${text}</span>`,
        }),
      }).addTo(layer);
    }
  }
  map.on('moveend', () => { if (shown) layout(); });

  return {
    update(m) { model = m; layout(); },
    show() { shown = true; layer.addTo(map); layout(); },
    hide() { shown = false; map.removeLayer(layer); layer.clearLayers(); },
    get on() { return !!prefs.drawLengths; },
    toggle() { prefs.set({ drawLengths: !prefs.drawLengths }); layout(); return !!prefs.drawLengths; },
  };
}
