// "Where am I": the device position as a dot with its accuracy circle, a
// button (bottom-right, above zoom) that centres on it, and, when asked
// (first visit), one centring at startup unless the user moves the map first.
// The position stays in the page: it is never sent anywhere.
import L from 'leaflet';
import { MAP } from '../config.js';
import { alertBox } from './dialog.js';

const ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>';
const COLOR = '#4da3ff';
const OPTS = { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 };
const BUTTON_ZOOM = MAP.minPortalZoom; // the button shows the portals around you

export function mountLocate(engine, { centerOnStart = true } = {}) {
  const map = engine.map;
  if (!('geolocation' in navigator)) return;

  map.createPane('nitcMe');
  map.getPane('nitcMe').style.zIndex = 630; // above portals, under the overlays
  map.getPane('nitcMe').style.pointerEvents = 'none';
  const ov = { pane: 'nitcMe', renderer: L.svg({ pane: 'nitcMe' }), interactive: false };
  const acc = L.circle([0, 0], { radius: 0, color: COLOR, weight: 1, opacity: 0.5, fillOpacity: 0.08, ...ov });
  const dot = L.circleMarker([0, 0], { radius: 6, color: '#fff', weight: 2, fillColor: COLOR, fillOpacity: 1, ...ov });

  let pos = null;              // last fix: [lat, lng]
  // centre on the next fix: 'start' keeps the zoom, 'button' zooms in
  let pending = centerOnStart ? 'start' : null;
  map.on('dragstart', () => { pending = null; }); // the user took over

  const ctl = L.control({ position: 'bottomright' });
  let btn;
  ctl.onAdd = () => {
    const bar = L.DomUtil.create('div', 'leaflet-bar');
    btn = L.DomUtil.create('a', 'nitc-locate', bar);
    btn.href = '#'; btn.role = 'button'; btn.title = 'Моё местоположение'; btn.innerHTML = ICON;
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.on(btn, 'click', (e) => {
      L.DomEvent.preventDefault(e);
      if (pos) map.setView(pos, BUTTON_ZOOM);
      else { pending = 'button'; watch(); }
    });
    return bar;
  };
  ctl.addTo(map);

  function onFix(p) {
    pos = [p.coords.latitude, p.coords.longitude];
    acc.setLatLng(pos).setRadius(p.coords.accuracy || 0);
    dot.setLatLng(pos);
    if (!map.hasLayer(dot)) { acc.addTo(map); dot.addTo(map); }
    btn.classList.add('on'); btn.title = 'Моё местоположение';
    if (pending) { map.setView(pos, pending === 'button' ? BUTTON_ZOOM : map.getZoom()); pending = null; }
  }
  // silent at startup; after a button press say why nothing happened
  function onError(e) {
    const asked = pending === 'button';
    pending = null;
    if (e.code === e.PERMISSION_DENIED) {
      stop();
      btn.classList.remove('on');
      btn.title = 'Доступ к геопозиции запрещён';
      if (asked) alertBox('Доступ к геопозиции запрещён. Разрешите его в настройках браузера или приложения.');
    } else if (asked && !pos) {
      alertBox('Не удалось определить местоположение. Попробуйте ещё раз.');
    }
  }

  let watchId = null;
  function watch() {
    if (watchId != null) return;
    watchId = navigator.geolocation.watchPosition(onFix, onError, OPTS);
  }
  function stop() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  // no GPS work in a hidden tab
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (pos) watch(); });

  watch();
}
