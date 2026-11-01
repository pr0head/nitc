// A point (not a portal) opened from a #ll= link, marked by a red reticle —
// apart from the round portals, the amber "me" and the magenta tracker. The
// ring leaves the point itself open to see what is there; it pulses at first
// so the eye finds it, then stays. One point at a time.
//
// The point belongs to the map, not the screen: panning and zooming leave it
// where it is. Only its centre takes the pointer — the ring stays clear, so
// portals under it remain clickable. Dragging the centre moves the point (the
// map stands still, its coordinates ride above while dragging); a tap opens a
// small menu: copy a link to the point as it is now, or hide it. The address
// keeps #ll= in step with the point, so a reload brings it back. Back closes
// the layers opened since and returns entries holding an older #ll= of ours:
// those are history, not a new link — owns() tells them apart, sync() puts
// the address back in step.
import L from 'leaflet';
import { promptBox } from './dialog.js';

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

export function createPin(map) {
  map.createPane('nitcPin');
  map.getPane('nitcPin').style.zIndex = 655;
  map.getPane('nitcPin').style.pointerEvents = 'none';
  let marker = null, timer = null, menu = null, copiedT = null;
  const written = new Set(); // every #ll= address this pin has stood for

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
    marker.on('drag', () => { label.textContent = fmt(marker.getLatLng()).replace(',', ', '); });
    marker.on('dragend', () => { marker.getElement().classList.remove('drag'); keepAddress(); });
    marker.on('click', openMenu);
    pulse('pulse', PULSE_MS);
  }

  function openMenu() {
    const box = L.DomUtil.create('div', 'nitc-pin-menu__in');
    box.innerHTML = '<button type="button" data-a="copy">Копировать ссылку</button>' +
      '<button type="button" data-a="hide">Скрыть</button>';
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b?.dataset.a === 'hide') hide();
      else if (b?.dataset.a === 'copy') copy(b);
    });
    menu = L.popup({
      className: 'nitc-pin-menu', closeButton: false, autoPanPadding: [16, 16], offset: [0, -14],
    }).setLatLng(marker.getLatLng()).setContent(box).openOn(map);
  }

  function copy(btn) {
    const url = link();
    keepAddress(); // the zoom in the address follows the copied link
    const copied = () => {
      clearTimeout(copiedT);
      btn.classList.add('done'); btn.textContent = '✓ Скопировано';
      pulse('flash', 1000);
      copiedT = setTimeout(() => map.closePopup(menu), COPIED_MS);
    };
    const fallback = () => { map.closePopup(menu); promptBox('Скопируйте ссылку:', url, 'OK'); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(copied, fallback);
    else fallback();
  }

  // quiet: a new point replaces this one, the address is the caller's
  function hide(quiet) {
    clearTimeout(timer); clearTimeout(copiedT);
    if (menu) map.closePopup(menu);
    if (!marker) return;
    marker.remove(); marker = null;
    if (quiet !== true) sync();
  }

  const owns = (h) => written.has(h);
  function sync() {
    if (marker) keepAddress();
    else if (/[#&]ll=/.test(location.hash)) history.replaceState(history.state, '', bare());
  }

  return { show, hide, owns, sync };
}
