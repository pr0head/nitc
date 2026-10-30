// A point (not a portal) opened from a #ll= link, marked by a red reticle —
// apart from the round portals, the amber "me" and the magenta tracker. The
// ring leaves the point itself open to see what is there; it pulses at first
// so the eye finds it, then stays. It takes no taps: portals under it stay
// clickable. One point at a time.
import L from 'leaflet';

// ring + four ticks pointing in, drawn twice: a white halo under the red so it
// reads on any base map
const SHAPE = '<circle cx="32" cy="32" r="14"/><path d="M32 6v14M32 44v14M6 32h14M44 32h14"/>';
const PIN = '<svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke-linecap="round">' +
  `<g stroke="#fff" stroke-width="5" opacity="0.85">${SHAPE}</g>` +
  `<g stroke="#ff3b30" stroke-width="2.5">${SHAPE}</g>` +
  '<circle cx="32" cy="32" r="2.5" fill="#ff3b30" stroke="#fff" stroke-width="1.5"/></svg>';
const PULSE_MS = 6000; // three pulses, then the reticle just stands

export function createPin(map) {
  map.createPane('nitcPin');
  map.getPane('nitcPin').style.zIndex = 655;
  map.getPane('nitcPin').style.pointerEvents = 'none';
  let marker = null, timer = null;

  function show(lat, lng) {
    clearTimeout(timer);
    marker?.remove();
    marker = L.marker([lat, lng], {
      pane: 'nitcPin', interactive: false, keyboard: false,
      icon: L.divIcon({
        className: 'nitc-pin pulse', iconSize: [64, 64], iconAnchor: [32, 32],
        html: `<div class="nitc-pin__pulse"></div>${PIN}`,
      }),
    }).addTo(map);
    timer = setTimeout(() => marker?.getElement()?.classList.remove('pulse'), PULSE_MS);
  }

  return { show };
}
