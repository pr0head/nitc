// A point (not a portal) opened from a #ll= link, marked by a red reticle —
// apart from the round portals, the amber "me" and the magenta tracker. The
// ring leaves the point itself open to see what is there; it pulses at first
// so the eye finds it, then stays. One point at a time.
//
// The point belongs to the map, not the screen: panning and zooming leave it
// where it is. Only its centre takes the pointer — the ring stays clear, so
// portals under it remain clickable. Dragging the centre moves the point (the
// map stands still, its coordinates ride above while dragging); a tap opens a
// small menu: copy a link to the point as it is now, or its coordinates, or
// hide it. The address
// keeps #ll= in step with the point, so a reload brings it back. Back closes
// the layers opened since and returns entries holding an older #ll= of ours:
// those are history, not a new link — owns() tells them apart, sync() puts
// the address back in step.
//
// Portals whose action range (40 m) takes the point in are tied to it by a
// dashed line with the distance — what could be done from there. Redrawn as
// the point is dragged and as the map loads. The lines meet at the reticle,
// so each distance stands past its portal, out along the line; one that would
// cover another (nearer ones go first) or the reticle is left out until a
// zoom makes room. The menu lists them all by name: a hover marks the portal,
// a click opens its card.
import L from 'leaflet';
import { promptBox } from './dialog.js';
import { bus } from '../state/bus.js';
import { GAME } from '../config.js';
import { esc } from './esc.js';

// ring + four ticks pointing in, drawn twice: a white halo under the red so it
// reads on any base map
const SHAPE = '<circle cx="32" cy="32" r="14"/><path d="M32 6v14M32 44v14M6 32h14M44 32h14"/>';
const PIN = '<svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke-linecap="round">' +
  `<g stroke="#fff" stroke-width="5" opacity="0.85">${SHAPE}</g>` +
  `<g stroke="#ff3b30" stroke-width="2.5">${SHAPE}</g>` +
  '<circle cx="32" cy="32" r="2.5" fill="#ff3b30" stroke="#fff" stroke-width="1.5"/></svg>';
const PULSE_MS = 6000; // three pulses, then the reticle just stands
const COPIED_MS = 1000; // the "copied" tick, then the menu closes

const fmt = (ll) => `${ll.lat.toFixed(6)},${ll.lng.toFixed(6)}`;
const REACH = '#ff3b30';
const LABEL_GAP = 12;   // px from the portal to its distance, out along the line
const LABEL_H = 18;     // a distance label's box, for the overlap test
const PIN_R = 26;       // the reticle's box half-side the labels keep off
const LIST_MAX = 12;    // rows in the menu's "in range" list

// getData: the loaded viewport (its portals)
export function createPin(map, getData) {
  map.createPane('nitcPin');
  map.getPane('nitcPin').style.zIndex = 655;
  map.getPane('nitcPin').style.pointerEvents = 'none';
  let marker = null, timer = null, menu = null, copiedT = null;
  const written = new Set(); // every #ll= address this pin has stood for
  const reach = L.layerGroup().addTo(map); // lines to the portals in range
  const marks = L.layerGroup().addTo(map); // their distances
  const spot = L.layerGroup().addTo(map);  // the portal hovered in the menu
  let near = []; // [{p, m}] portals in range, nearest first

  const hash = () => `#ll=${fmt(marker.getLatLng())}&z=${map.getZoom()}`;
  const bare = () => location.pathname + location.search;
  const link = () => location.origin + bare() + hash();
  function keepAddress() {
    const h = hash();
    written.add(h);
    history.replaceState(history.state, '', bare() + h);
  }

  function pulse(cls, ms) {
    const el = marker?.getElement();
    if (!el) return;
    clearTimeout(timer);
    el.classList.remove('pulse', 'flash');
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
    timer = setTimeout(() => el.classList.remove(cls), ms);
  }

  function show(lat, lng) {
    hide(true);
    written.add(location.hash);
    marker = L.marker([lat, lng], {
      pane: 'nitcPin', keyboard: false, draggable: true, autoPan: true,
      icon: L.divIcon({
        className: 'nitc-pin', iconSize: [64, 64], iconAnchor: [32, 32],
        html: '<div class="nitc-pin__pulse"></div>' + PIN +
          '<div class="nitc-pin__ll"></div><div class="nitc-pin__grip" title="Перетащите или нажмите"></div>',
      }),
    }).addTo(map);
    const label = marker.getElement().querySelector('.nitc-pin__ll');
    marker.on('dragstart', () => { map.closePopup(menu); marker.getElement().classList.add('drag'); });
    marker.on('drag', () => { label.textContent = fmt(marker.getLatLng()).replace(',', ', '); drawReach(); });
    marker.on('dragend', () => { marker.getElement().classList.remove('drag'); keepAddress(); });
    marker.on('click', openMenu);
    pulse('pulse', PULSE_MS);
    drawReach();
  }

  function drawReach() {
    reach.clearLayers();
    near = [];
    if (marker) {
      const at = marker.getLatLng();
      for (const p of getData().portals) {
        if (p.lat == null) continue;
        const m = at.distanceTo([p.lat, p.lng]);
        if (m <= GAME.actionRadiusM) near.push({ p, m });
      }
      near.sort((a, b) => a.m - b.m);
      for (const { p } of near) {
        L.polyline([at, [p.lat, p.lng]], {
          pane: 'nitcPin', color: REACH, weight: 2, opacity: 0.9, dashArray: '5,5', interactive: false,
        }).addTo(reach);
      }
    }
    placeMarks();
  }

  // screen-space: past each portal along its line, nearest first, skipping
  // any that would overlap one already placed or the reticle
  function placeMarks() {
    marks.clearLayers();
    if (!marker) return;
    const c = map.latLngToContainerPoint(marker.getLatLng());
    const taken = [[c.x - PIN_R, c.y - PIN_R, c.x + PIN_R, c.y + PIN_R]];
    for (const { p, m } of near) {
      const txt = `${Math.round(m)} м`;
      const w = 12 + 7 * txt.length;
      const q = map.latLngToContainerPoint([p.lat, p.lng]);
      let dx = q.x - c.x, dy = q.y - c.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
      // out along the line until the box clears the portal
      const out = LABEL_GAP + Math.abs(dx) * w / 2 + Math.abs(dy) * LABEL_H / 2;
      const x = q.x + dx * out, y = q.y + dy * out;
      const box = [x - w / 2, y - LABEL_H / 2, x + w / 2, y + LABEL_H / 2];
      if (taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) continue;
      taken.push(box);
      L.marker(map.containerPointToLatLng([x, y]), {
        pane: 'nitcPin', interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'nitc-pin-reach', iconSize: null, html: `<span>${txt}</span>` }),
      }).addTo(marks);
    }
  }
  bus.on('mapData', () => { drawReach(); fillList(); });
  map.on('zoomend', placeMarks);

  function spotOn(p) {
    spot.clearLayers();
    if (!p || !marker) return;
    L.polyline([marker.getLatLng(), [p.lat, p.lng]], {
      pane: 'nitcPin', color: REACH, weight: 4, opacity: 1, interactive: false,
    }).addTo(spot);
    L.circleMarker([p.lat, p.lng], {
      pane: 'nitcPin', radius: 13, color: REACH, weight: 3, fill: false, interactive: false,
    }).addTo(spot);
  }

  // the menu's "in range" list, kept up to date while it is open
  let listEl = null;
  function fillList() {
    if (!listEl) return;
    spotOn(null);
    const rows = near.slice(0, LIST_MAX);
    listEl.hidden = !rows.length;
    listEl.innerHTML = rows.length
      ? '<div class="nitc-pin-menu__h">В радиусе действия</div>' + rows.map(({ p, m }, i) =>
        `<button type="button" class="nitc-pin-menu__p" data-i="${i}"><span>${esc(p.name || 'Портал')}</span><b>${Math.round(m)} м</b></button>`).join('') +
        (near.length > LIST_MAX ? `<div class="nitc-pin-menu__h">и ещё ${near.length - LIST_MAX}</div>` : '')
      : '';
  }

  function openMenu() {
    const box = L.DomUtil.create('div', 'nitc-pin-menu__in');
    box.innerHTML = '<button type="button" data-a="link">Скопировать ссылку</button>' +
      '<button type="button" data-a="ll">Скопировать координаты</button>' +
      '<button type="button" data-a="hide">Скрыть</button><div class="nitc-pin-menu__list"></div>';
    listEl = box.querySelector('.nitc-pin-menu__list');
    fillList();
    const rowOf = (e) => near[+e.target.closest('.nitc-pin-menu__p')?.dataset.i]?.p;
    box.addEventListener('mouseover', (e) => spotOn(rowOf(e)));
    box.addEventListener('mouseleave', () => spotOn(null));
    box.addEventListener('click', (e) => {
      const p = rowOf(e);
      if (p) {
        map.closePopup(menu);
        bus.emit('openPortal', { portal: { id: p.id, name: p.name, lat: p.lat, lng: p.lng, faction: p.faction } });
        return;
      }
      const b = e.target.closest('button');
      if (b?.dataset.a === 'hide') hide();
      else if (b?.dataset.a === 'link') {
        keepAddress(); // the zoom in the address follows the copied link
        copy(b, link(), 'Скопируйте ссылку:');
      } else if (b?.dataset.a === 'll') copy(b, fmt(marker.getLatLng()).replace(',', ', '), 'Скопируйте координаты:');
    });
    menu = L.popup({
      className: 'nitc-pin-menu', closeButton: false, autoPanPadding: [16, 16], offset: [0, -14],
    }).setLatLng(marker.getLatLng()).setContent(box).openOn(map);
    menu.on('remove', () => { listEl = null; spotOn(null); });
  }

  function copy(btn, txt, ask) {
    const copied = () => {
      clearTimeout(copiedT);
      btn.classList.add('done'); btn.textContent = '✓ Скопировано';
      pulse('flash', 1000);
      copiedT = setTimeout(() => map.closePopup(menu), COPIED_MS);
    };
    const fallback = () => { map.closePopup(menu); promptBox(ask, txt, 'OK'); };
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(copied, fallback);
    else fallback();
  }

  // quiet: a new point replaces this one, the address is the caller's
  function hide(quiet) {
    clearTimeout(timer); clearTimeout(copiedT);
    if (menu) map.closePopup(menu);
    if (!marker) return;
    marker.remove(); marker = null;
    drawReach();
    if (quiet !== true) sync();
  }

  const owns = (h) => written.has(h);
  function sync() {
    if (marker) keepAddress();
    else if (/[#&]ll=/.test(location.hash)) history.replaceState(history.state, '', bare());
  }

  return { show, hide, owns, sync };
}
