// Leaflet engine: base tiles, viewport→bbox map loading (debounced, abortable,
// generation-guarded, ETag-cached via the client), and render. One load wins:
// a newer request supersedes an older in-flight one.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MAP } from '../config.js';
import { getMap } from '../api/intel.js';
import { adaptMap } from '../adapter/model.js';
import { makeGroups, render, fieldVisible, fcol, ll } from './render.js';
import { createHighlightLayer } from './overlay.js';
import { styleFn } from './highlight.js';
import { ringArea, fmtArea } from './geo.js';
import { prefs } from '../state/prefs.js';
import { bus } from '../state/bus.js';

// Base maps. Most are EPSG:3857; the Yandex scheme is requested in
// web_mercator to fit that grid. Yandex satellite exists ONLY in EPSG:3395
// (it ignores the projection parameter), so the Yandex hybrid switches the
// whole map to 3395 while it is on — every overlay is drawn from lat/lng, so
// portals, links and fields re-project with it.
const Y = 'https://core-renderer-tiles.maps.yandex.net/tiles';
const yScheme = () => L.tileLayer(
  `${Y}?l=map&projection=web_mercator&x={x}&y={y}&z={z}&scale=1&lang=ru_RU`,
  { maxZoom: 21, attribution: '© Yandex' });
const yHybrid = () => L.layerGroup([
  L.tileLayer('https://core-sat.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&scale=1&lang=ru_RU',
    { maxZoom: 21, maxNativeZoom: 19, zIndex: 1, attribution: '© Yandex' }),
  L.tileLayer(`${Y}?l=skl&x={x}&y={y}&z={z}&scale=1&lang=ru_RU`, { maxZoom: 21, zIndex: 2 }),
]);
const gTile = (lyrs) => () => L.tileLayer(
  `https://mt{s}.google.com/vt/lyrs=${lyrs}&x={x}&y={y}&z={z}`,
  { subdomains: '0123', maxZoom: 21, attribution: '© Google' });

// in panel order
const BASE_MAPS = {
  yandex: { label: 'Yandex', build: yScheme },
  yhyb: { label: 'Yandex гибрид', build: yHybrid, crs: L.CRS.EPSG3395 },
  groad: { label: 'Google', build: gTile('m') },
  ghyb: { label: 'Google гибрид', build: gTile('y') },
  osm: { label: 'OSM', build: () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }) },
};
const crsOf = (id) => BASE_MAPS[id].crs || L.CRS.EPSG3857;

export function createMap(el, { onStatus, onPortalClick, onUnauthorized, statusEl } = {}) {
  // preferCanvas: portals/links/fields render onto a single <canvas> instead of
  // thousands of SVG nodes — the big win for smooth panning with 2000+ portals
  // (SVG repositions every DOM node on drag; canvas just translates one element).
  const view = prefs.view; // restore the last map position, if any
  // a base map no longer offered (e.g. removed) falls back to the default
  if (!BASE_MAPS[prefs.baseMap]) prefs.set({ baseMap: 'yandex' });
  const map = L.map(el, {
    center: view ? view.center : MAP.center,
    zoom: view ? view.zoom : MAP.zoom,
    crs: crsOf(prefs.baseMap),
    zoomControl: false, attributionControl: true, worldCopyJump: true,
    preferCanvas: true,
    renderer: L.canvas({ padding: 0.5 }), // draw a bit beyond the viewport → fewer redraws on pan
  });
  // only the tile providers' credits, without Leaflet's own prefix (as IITC)
  map.attributionControl.setPrefix('');
  // bottom-right stack, bottom to top: attribution, map status, zoom (Leaflet
  // puts each later bottom control above the earlier ones). Top-left is the
  // identity plate.
  if (statusEl) {
    const status = L.control({ position: 'bottomright' });
    status.onAdd = () => { L.DomEvent.disableClickPropagation(statusEl); return statusEl; };
    status.addTo(map);
  }
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  let tiles = BASE_MAPS[prefs.baseMap].build().addTo(map);
  const groups = makeGroups(map);
  const highlight = createHighlightLayer().addTo(map); // single canvas, drawn above the portals

  let gen = 0;          // generation guard — only the latest load may render
  let inflight = null;  // AbortController of the current request
  let debounce = null;
  let selectedId = null;
  let lastData = null;  // last adapted /map response — filters re-render this, no refetch

  // Render markers, then feed the overlay the arcs/text of the portals that got
  // a highlight style and the area labels of the fields actually shown.
  function paint() {
    if (!lastData) return;
    const f = prefs.filters, h = prefs.highlight;
    const marks = render(groups, lastData, { onPortalClick, selectedId, filters: f, style: styleFn(h) });
    // field label: area and/or the server's MU (null = not computed yet → "?",
    // never 0 and never our own estimate)
    const labels = [];
    if (h.fieldArea || h.fieldMu) {
      for (const fd of lastData.fields) {
        if (fd.v.length < 3 || !fd.v.every(ll) || !fieldVisible(fd, f)) continue;
        const ring = fd.v.map((v) => [v.lat, v.lng]);
        const text = [
          h.fieldArea ? fmtArea(ringArea(ring)) : null,
          h.fieldMu ? `${fd.mu == null ? '?' : fd.mu.toLocaleString('ru-RU')} MU` : null,
        ].filter(Boolean).join(' · ');
        labels.push({ ring, text, color: fcol(fd.faction) });
      }
    }
    highlight.setData(marks, labels);
  }

  function bboxOf() {
    const b = map.getBounds();
    return { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() };
  }

  async function load() {
    const my = ++gen;
    inflight?.abort();
    inflight = new AbortController();
    const zoom = map.getZoom();
    onStatus?.({ loading: true, zoom });
    try {
      const raw = await getMap(bboxOf(), zoom, inflight.signal);
      if (my !== gen) return; // superseded
      const data = adaptMap(raw);
      lastData = data;
      paint();
      onStatus?.({
        loading: false,
        counts: { portals: data.portals.length, corners: data.corners.length, links: data.links.length, fields: data.fields.length },
        portalsOmitted: data.portalsOmitted,
        truncated: data.truncated,
        lod: data.lod,
        zoom,
      });
    } catch (e) {
      if (e?.name === 'AbortError' || my !== gen) return;
      if (e?.code === 'unauthorized') { onUnauthorized?.(); return; }
      onStatus?.({ loading: false, error: e?.code || 'request_failed', retryAfter: e?.retryAfter || 0, zoom });
    }
  }

  function scheduleLoad() {
    clearTimeout(debounce);
    debounce = setTimeout(load, MAP.moveDebounceMs);
  }

  map.on('moveend', () => {
    const c = map.getCenter();
    prefs.set({ view: { center: [c.lat, c.lng], zoom: map.getZoom() } });
    scheduleLoad();
  });

  function setBaseMap(id) {
    const def = BASE_MAPS[id];
    if (!def) return;
    map.removeLayer(tiles);
    const crs = crsOf(id);
    if (map.options.crs !== crs) {
      // switch projection in place: same centre/zoom, view fully reset so every
      // layer re-projects (a plain setView would just pan by the tiny offset)
      const c = map.getCenter(), z = map.getZoom();
      map.options.crs = crs;
      map.setView(c, z, { reset: true });
    }
    tiles = def.build().addTo(map); // the tile pane holds only the base map
    prefs.set({ baseMap: id });
  }

  // Merge a filter patch, persist, and re-render loaded data (no network).
  function setFilter(patch) {
    Object.assign(prefs.filters, patch);
    prefs.save();
    paint();
  }

  // Merge a highlight patch, persist, re-render the overlay (no network).
  function setHighlight(patch) {
    Object.assign(prefs.highlight, patch);
    prefs.save();
    paint();
    bus.emit('highlightChanged', prefs.highlight); // drawn polygons' area labels
  }

  // Selected portal (or null): its outline turns red on repaint. Portals are
  // rebuilt on every render, so the selection lives here to survive pan/zoom.
  function setSelected(id) { selectedId = id ?? null; paint(); }

  // Loaded viewport data — the portal card counts links/fields from it and the
  // draw tools snap to its portals.
  const getData = () => lastData || { portals: [], corners: [], links: [], fields: [] };

  // a starred portal may carry the "favorite" arc
  bus.on('favoritesChanged', paint);
  bus.on('keysChanged', paint); // key arcs and counts

  // periodic refresh, paused when the tab is hidden
  let timer = setInterval(() => { if (!document.hidden) load(); }, MAP.refreshMs);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleLoad(); });

  function destroy() { clearInterval(timer); inflight?.abort(); map.remove(); }

  return { map, baseMaps: BASE_MAPS, prefs, setBaseMap, setFilter, setHighlight, setSelected, getData, load, destroy };
}
