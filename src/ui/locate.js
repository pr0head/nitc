// "Where am I": the device position as an amber marker (pulsing, with a
// heading arrow when the device has a compass), the action radius around it,
// a faint GPS accuracy circle, and a button (bottom-right, above zoom) that
// centres on it and then follows it. Dragging the map, or pressing the button
// again, stops following. When asked (first visit), one centring at startup
// unless the user moves the map first.
// The position stays in the page: it is never sent anywhere.
import L from 'leaflet';
import { MAP, GAME } from '../config.js';
import { alertBox } from './dialog.js';

const ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>';
const COLOR = '#ffb300'; // amber: apart from either faction's colour
const OPTS = { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 };
const BUTTON_ZOOM = MAP.minPortalZoom; // the button shows the portals around you
const RANGE_ZOOM = MAP.minPortalZoom;  // the action radius: only where portals are
const FOLLOW_PAD = -0.15;              // follow: re-centre once outside the inner 70%
const COMPASS_STALE_MS = 3000;         // no compass reading for this long: use GPS course

let lastFix = null;
// the last known device position as [lat, lng], or null (e.g. for the route
// button, to tell a walk from a drive)
export const myPosition = () => lastFix;

export function mountLocate(engine, { centerOnStart = true } = {}) {
  const map = engine.map;
  if (!('geolocation' in navigator)) return;

  map.createPane('nitcMe');
  map.getPane('nitcMe').style.zIndex = 630; // above portals, under the overlays
  map.getPane('nitcMe').style.pointerEvents = 'none';
  const ov = { pane: 'nitcMe', renderer: L.svg({ pane: 'nitcMe' }), interactive: false };
  const acc = L.circle([0, 0], { radius: 0, stroke: false, fillColor: COLOR, fillOpacity: 0.07, ...ov });
  const range = L.circle([0, 0], {
    radius: GAME.actionRadiusM, color: COLOR, weight: 1.5, opacity: 0.85, dashArray: '5 4',
    fillColor: COLOR, fillOpacity: 0.06, ...ov,
  });
  const me = L.marker([0, 0], {
    pane: 'nitcMe', interactive: false, keyboard: false,
    icon: L.divIcon({
      className: 'nitc-me', iconSize: [48, 48], iconAnchor: [24, 24],
      html: '<div class="nitc-me__pulse"></div><div class="nitc-me__rot" hidden><div class="nitc-me__head"></div></div><div class="nitc-me__dot"></div>',
    }),
  });

  let pos = null;              // last fix: [lat, lng]
  // centre on the next fix: 'start' keeps the zoom, 'button' zooms in
  let pending = centerOnStart ? 'start' : null;
  let follow = false;
  map.on('dragstart', () => { pending = null; setFollow(false); }); // the user took over
  map.on('zoomend', showRange);

  const ctl = L.control({ position: 'bottomright' });
  let btn;
  ctl.onAdd = () => {
    const bar = L.DomUtil.create('div', 'leaflet-bar');
    btn = L.DomUtil.create('a', 'nitc-locate', bar);
    btn.href = '#'; btn.role = 'button'; btn.title = 'Моё местоположение'; btn.innerHTML = ICON;
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.on(btn, 'click', (e) => {
      L.DomEvent.preventDefault(e);
      askCompass(); // iOS lets a page read the compass only after a tap
      if (follow) return setFollow(false);
      setFollow(true);
      if (pos) map.setView(pos, Math.max(map.getZoom(), BUTTON_ZOOM));
      else { pending = 'button'; watch(); }
    });
    return bar;
  };
  ctl.addTo(map);

  function setFollow(on) {
    follow = on;
    btn.classList.toggle('follow', on);
    btn.title = on ? 'Следую за вами — нажмите, чтобы перестать' : 'Моё местоположение';
  }

  function showRange() {
    const want = !!pos && map.getZoom() >= RANGE_ZOOM;
    if (want && !map.hasLayer(range)) range.addTo(map);
    else if (!want && map.hasLayer(range)) range.remove();
  }

  function onFix(p) {
    pos = lastFix = [p.coords.latitude, p.coords.longitude];
    acc.setLatLng(pos).setRadius(p.coords.accuracy || 0);
    range.setLatLng(pos);
    me.setLatLng(pos);
    if (!map.hasLayer(me)) { acc.addTo(map); me.addTo(map); drawHeading(); }
    showRange();
    btn.classList.add('on');
    // no compass: the GPS course (reported while moving) still points the way
    if (Date.now() - compassAt > COMPASS_STALE_MS) setHeading(p.coords.speed > 0.5 ? p.coords.heading : null);
    if (pending) { map.setView(pos, pending === 'button' ? BUTTON_ZOOM : map.getZoom()); pending = null; }
    else if (follow && !map.getBounds().pad(FOLLOW_PAD).contains(pos)) map.panTo(pos);
  }
  // silent at startup; after a button press say why nothing happened
  function onError(e) {
    const asked = pending === 'button';
    pending = null;
    if (e.code === e.PERMISSION_DENIED) {
      stop();
      setFollow(false);
      btn.classList.remove('on');
      btn.title = 'Доступ к геопозиции запрещён';
      if (asked) alertBox('Доступ к геопозиции запрещён. Разрешите его в настройках браузера или приложения.');
    } else if (asked && !pos) {
      alertBox('Не удалось определить местоположение. Попробуйте ещё раз.');
    }
  }

  // ---- heading: compass where there is one, else the GPS course ----------
  let heading = null;          // degrees clockwise from north, or null
  let compassAt = 0;           // when the compass last answered
  function setHeading(h) {
    if (h != null && !Number.isFinite(h)) h = null;
    if (h === heading || (h != null && heading != null && Math.abs(h - heading) < 2)) return;
    heading = h;
    drawHeading();
  }
  // the compass may answer before the first fix puts the marker on the map
  function drawHeading() {
    const rot = me.getElement()?.querySelector('.nitc-me__rot');
    if (!rot) return;
    rot.hidden = heading == null;
    if (heading != null) rot.style.transform = `rotate(${heading}deg)`;
  }
  // the screen's own turn (landscape) adds to where the device points
  const screenAngle = () => screen.orientation?.angle ?? window.orientation ?? 0;
  function onOrientation(e) {
    let h = null;
    if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;            // iOS
    else if (e.absolute && e.alpha != null) h = 360 - e.alpha;                 // Android, Chrome
    if (h == null) return;
    compassAt = Date.now();
    setHeading((h + screenAngle() + 360) % 360);
  }
  const ORIENT = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  let compassOn = false;
  function compass(on) {
    if (on === compassOn) return;
    compassOn = on;
    if (on) addEventListener(ORIENT, onOrientation);
    else removeEventListener(ORIENT, onOrientation);
  }
  function askCompass() {
    const ask = window.DeviceOrientationEvent?.requestPermission;
    if (typeof ask !== 'function') return;
    ask.call(DeviceOrientationEvent).then((r) => { if (r === 'granted') compass(true); }).catch(() => {});
  }

  let watchId = null;
  function watch() {
    if (watchId == null) watchId = navigator.geolocation.watchPosition(onFix, onError, OPTS);
    // on iOS this listens to nothing until a tap grants the compass
    compass(true);
  }
  function stop() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    compass(false);
  }
  // no GPS or compass work in a hidden tab
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (pos) watch(); });

  watch();
}
