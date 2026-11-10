// A custom canvas overlay for portal arcs/text and field-area labels.
//
// Why a bespoke layer and not L.marker/divIcon (as IITC does): divIcon is one
// DOM node per highlighted portal, and the Text rule applies to *every* portal —
// thousands of nodes would undo the preferCanvas perf win. Here everything is
// drawn onto a single <canvas>, like the portal/link/field renderer.
//
// The transform/zoom-animation plumbing mirrors Leaflet's own L.Renderer so the
// overlay pans and zoom-animates in lockstep with the vector canvas.
import L from 'leaflet';
import { labelPx, screenArea } from './label.js';

const PAD = 0.1; // draw a little beyond the viewport so pans need fewer redraws
// the real device pixel ratio (fractional on scaled desktops, 3 on most
// phones), re-read on every resize: browser zoom and moving the window to
// another monitor change it
const dpr = () => Math.min(3, window.devicePixelRatio || 1);
const MIN_LABEL_PX = 2500; // ~50×50 px of on-screen triangle before it gets an area label
const FONT = '-apple-system, system-ui, "Segoe UI", Roboto, Arial, sans-serif';

// Own pane between overlayPane (400, where the portal canvas lives) and
// shadowPane (500): the portal canvas is created lazily on first data, so in a
// shared pane it would stack on top and hide the text drawn at portal centres.
const PANE = 'nitcHighlight';

const HighlightLayer = L.Layer.extend({
  options: { pane: PANE },

  initialize() { this._marks = []; this._labels = []; },

  beforeAdd(map) {
    if (map.getPane(PANE)) return;
    const pane = map.createPane(PANE);
    pane.style.zIndex = 450;
    pane.style.pointerEvents = 'none';
  },

  // marks: [{lat,lng,r,top,bot,text}] · labels: [{ring:[[lat,lng]×3],text,color}]
  setData(marks, labels) {
    this._marks = marks || [];
    this._labels = labels || [];
    this._redraw();
  },

  onAdd() {
    const c = this._canvas = L.DomUtil.create('canvas', 'nitc-hl');
    c.style.position = 'absolute';
    c.style.pointerEvents = 'none'; // never steal clicks from the portal markers
    this._ctx = c.getContext('2d');
    this.getPane().appendChild(c);
    if (this._map._zoomAnimated) L.DomUtil.addClass(c, 'leaflet-zoom-animated');
    this._update();
  },

  onRemove() { L.DomUtil.remove(this._canvas); this._dprWatch?.(); },

  // a DPR change without a resize (another monitor) only shows up here
  _watchDpr() {
    this._dprWatch?.();
    const mq = matchMedia(`(resolution: ${this._dpr}dppx)`);
    const on = () => this._update();
    mq.addEventListener('change', on, { once: true });
    this._dprWatch = () => mq.removeEventListener('change', on);
  },

  getEvents() {
    const e = { viewreset: this._reset, zoom: this._onZoom, moveend: this._update, zoomend: this._update };
    if (this._map._zoomAnimated) e.zoomanim = this._onAnimZoom;
    return e;
  },

  _onAnimZoom(ev) { this._updateTransform(ev.center, ev.zoom); },
  _onZoom() { this._updateTransform(this._map.getCenter(), this._map.getZoom()); },

  _updateTransform(center, zoom) {
    const scale = this._map.getZoomScale(zoom, this._zoom);
    const off = this._map.getSize().multiplyBy(0.5 + PAD).multiplyBy(-scale)
      .add(this._map.project(this._center, zoom))
      .subtract(this._map._getNewPixelOrigin(center, zoom));
    L.DomUtil.setTransform(this._canvas, off, scale);
  },

  _reset() { this._update(); this._updateTransform(this._center, this._zoom); },

  _update() {
    if (this._map._animatingZoom && this._bounds) return;
    const size = this._map.getSize();
    const min = this._map.containerPointToLayerPoint(size.multiplyBy(-PAD)).round();
    this._bounds = new L.Bounds(min, min.add(size.multiplyBy(1 + PAD * 2)).round());
    this._center = this._map.getCenter();
    this._zoom = this._map.getZoom();

    const s = this._bounds.getSize(), c = this._canvas;
    L.DomUtil.setPosition(c, this._bounds.min);
    const r = dpr();
    if (r !== this._dpr) { this._dpr = r; this._watchDpr(); }
    c.width = Math.round(r * s.x); c.height = Math.round(r * s.y);
    c.style.width = s.x + 'px'; c.style.height = s.y + 'px';
    this._redraw();
  },

  _redraw() {
    const ctx = this._ctx, b = this._bounds, c = this._canvas;
    if (!ctx || !b) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.scale(c.width / (b.max.x - b.min.x), c.height / (b.max.y - b.min.y));
    ctx.translate(-b.min.x, -b.min.y); // now we can draw in map layer-point coords
    this._drawMarks(ctx, b);
    this._drawLabels(ctx);
  },

  _drawMarks(ctx, b) {
    for (const m of this._marks) {
      const p = this._map.latLngToLayerPoint([m.lat, m.lng]);
      if (!b.contains(p)) continue; // cull off-screen
      const r = m.r + 2.5;
      ctx.lineWidth = 2.6;
      if (m.top) { ctx.strokeStyle = m.top; ctx.beginPath(); ctx.arc(p.x, p.y, r, Math.PI, 2 * Math.PI); ctx.stroke(); }
      if (m.bot) { ctx.strokeStyle = m.bot; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI); ctx.stroke(); }
      if (m.text) this._label(ctx, m.text, p.x, p.y, '#fff', 11);
    }
  },

  _drawLabels(ctx) {
    for (const lb of this._labels) {
      const pts = lb.ring.map((ll) => this._map.latLngToLayerPoint(ll));
      // on-screen triangle area; skip slivers / tiny fields (they nest heavily)
      const px = screenArea(pts);
      if (px < MIN_LABEL_PX) continue;
      const cx = (pts[0].x + pts[1].x + pts[2].x) / 3;
      const cy = (pts[0].y + pts[1].y + pts[2].y) / 3;
      this._label(ctx, lb.text, cx, cy, lb.color, labelPx(px));
    }
  },

  // bold text over a crisp dark outline (a stroke under the fill, not a
  // blurred glow) so it stays legible over any base map and its own field
  _label(ctx, text, x, y, color, size) {
    ctx.save();
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  },
});

export const createHighlightLayer = () => new HighlightLayer();
