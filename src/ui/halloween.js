// Halloween dress-up, 31 Oct – 1 Nov local time (?halloween previews it any
// day): a night-tinted base map, a pumpkin by the logo, the tracker's pins as
// pumpkins, a greeting once a day, bats crossing the screen now and then, and
// a witch on a broom when a tap hits a portal or a pumpkin, or just misses a
// portal. Looks only: no game data or rules change, no requests. One menu
// switch turns all of it off; bats and the witch never take taps and stay
// home under "reduce motion".
import { prefs } from '../state/prefs.js';
import { bus, tools } from '../state/bus.js';

export const PUMPKIN = '<svg class="hw-pumpkin" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M12 6c.2-1.6 1-3 2.6-3.6" fill="none" stroke="#4caf50" stroke-width="2" stroke-linecap="round"/>' +
  '<ellipse cx="7.5" cy="14" rx="5.5" ry="7.5" fill="#e8730c"/><ellipse cx="16.5" cy="14" rx="5.5" ry="7.5" fill="#e8730c"/>' +
  '<ellipse cx="12" cy="14" rx="5" ry="8" fill="#ff8c1a"/>' +
  '<g class="hw-face"><path d="M7 12l2.2-2.4L10.4 12zM13.6 12l1.2-2.4L17 12zM7.5 16.2c1.5 1.6 7.5 1.6 9 0l-1.2.4-1-.9-1 .9-1-.9-1 .9-1-.9-1 .9z" fill="#ffe36b" stroke="#c45a00" stroke-width=".6"/></g></svg>';
const BAT = '<svg viewBox="0 0 48 20" aria-hidden="true"><path d="M24 7c1-2 1.8-3 2.4-1.6L27.6 3l.4 4.4C31 3.6 37 1 48 4c-4.6 1-6.4 3.4-6.2 7-2.6-2.2-5.4-1.6-7 1.6C32.4 9.6 28.6 9.8 24 15c-4.6-5.2-8.4-5.4-10.8-2.4-1.6-3.2-4.4-3.8-7-1.6C6.4 7.4 4.6 5 0 4c11-3 17-.4 20 3.4L20.4 3l1.2 2.4C22.2 4 23 5 24 7z" fill="#3b1655"/></svg>';
const WITCH = '<svg viewBox="0 0 120 70" aria-hidden="true">' +
  '<path d="M4 50L84 40" stroke="#5a3a1a" stroke-width="3" stroke-linecap="round"/>' +
  '<path d="M84 40l26-12 2 8-2 8 6 6-30-2z" fill="#a0702a"/>' +
  '<path d="M30 46l18-24 14 22z" fill="#160b1f"/>' +
  '<circle cx="48" cy="20" r="6" fill="#7bc96f"/>' +
  '<path d="M33 16l26-4-12-12-2 9z" fill="#160b1f"/><path d="M31 18l31-5" stroke="#160b1f" stroke-width="3" stroke-linecap="round"/>' +
  '<path d="M52 28l10 8" stroke="#160b1f" stroke-width="4" stroke-linecap="round"/>' +
  '<path d="M40 44l-6 10M50 44l4 10" stroke="#160b1f" stroke-width="3" stroke-linecap="round"/>' +
  '<path d="M50 20c4 2 8 0 10-4" fill="none" stroke="#e8730c" stroke-width="2"/></svg>';

const GREETED = 'nitc.hwGreeted';
const MISS_PX = 36;        // a tap this close to a portal, yet not on it, is a miss
const WITCH_CHANCE = 0.5;  // not every miss: a surprise, not a rule
const WITCH_REST_MS = 60000;

export function halloweenSeason() {
  const d = new Date(), m = d.getMonth(), day = d.getDate();
  return (m === 9 && day === 31) || (m === 10 && day === 1) || /[?&]halloween\b/.test(location.search);
}
export const halloweenOn = () => halloweenSeason() && prefs.halloween;
// the theme class goes on <html> before any screen draws (login included)
export const applyHalloween = () => document.documentElement.classList.toggle('hw', halloweenOn());

export function mountHalloween(app, engine, menu) {
  if (!halloweenSeason()) return;
  const map = engine.map;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const moving = () => halloweenOn() && !still.matches && !document.hidden;

  const sky = document.createElement('div');
  sky.className = 'hw-sky';
  app.append(sky);

  menu.add({
    icon: PUMPKIN, label: 'Хэллоуин', isOn: () => prefs.halloween,
    onClick: () => {
      prefs.set({ halloween: !prefs.halloween });
      applyHalloween();
      bus.emit('halloweenChanged'); // the tracker's pumpkins
      if (!prefs.halloween) sky.replaceChildren();
    },
  });

  // greeting: once a day, a moment after the map shows
  const today = new Date().toDateString();
  let greeted = null;
  try { greeted = localStorage.getItem(GREETED); } catch { /* private mode */ }
  if (halloweenOn() && greeted !== today) {
    try { localStorage.setItem(GREETED, today); } catch { /* ignore */ }
    setTimeout(() => {
      const t = document.createElement('div');
      t.className = 'hw-hello';
      t.innerHTML = `${PUMPKIN}<span>Счастливого Хэллоуина, агент!</span>`;
      app.append(t);
      setTimeout(() => t.classList.add('out'), 4000);
      setTimeout(() => t.remove(), 4600);
    }, 1200);
  }

  // ---- bats: a small flock every couple of minutes ------------------------
  function flock() {
    if (!moving()) return;
    const w = app.clientWidth, h = app.clientHeight;
    const ltr = Math.random() < 0.5, n = 3 + Math.floor(Math.random() * 3);
    const y0 = h * (0.15 + Math.random() * 0.5);
    for (let i = 0; i < n; i++) {
      const bat = document.createElement('div');
      bat.className = 'hw-bat';
      bat.innerHTML = BAT;
      const size = 22 + Math.random() * 16;
      bat.style.width = `${size}px`;
      sky.append(bat);
      const from = ltr ? -60 : w + 60, to = ltr ? w + 60 : -60;
      const y = y0 + (Math.random() - 0.5) * 80, rise = -h * (0.1 + Math.random() * 0.25);
      const frames = [0, 0.25, 0.5, 0.75, 1].map((k) => ({
        transform: `translate(${from + (to - from) * k}px, ${y + rise * k + Math.sin(k * 9 + i) * 24}px)`,
      }));
      const a = bat.animate(frames, { duration: 5500 + Math.random() * 2500, delay: i * 260, easing: 'linear', fill: 'both' });
      a.onfinish = () => bat.remove();
    }
  }
  setTimeout(function next() {
    flock();
    setTimeout(next, 90000 + Math.random() * 60000);
  }, 8000);

  // ---- the witch: a tap that just misses a portal -------------------------
  let witchAt = 0;
  map.on('click', (e) => {
    if (!moving() || prefs.draw || Date.now() - witchAt < WITCH_REST_MS || onMarker(e.originalEvent)) return;
    const near = engine.getData().portals.some((p) =>
      Number.isFinite(p.lat) && map.latLngToContainerPoint([p.lat, p.lng]).distanceTo(e.containerPoint) < MISS_PX);
    if (!near || Math.random() >= WITCH_CHANCE) return;
    witchAt = Date.now();
    witch();
  });
  // a tap on a portal or a tracker pumpkin always sends her out (unless she
  // is still in the air) — on top of what the tap opens. Not while drawing:
  // there a portal tap places a point.
  const sendOut = () => {
    if (!moving() || tools.drawMode || sky.querySelector('.hw-witch')) return;
    witchAt = Date.now();
    witch();
  };
  bus.on('portalClick', sendOut);
  map.getContainer().addEventListener('click', (ev) => { if (ev.target.closest?.('.trk-pin')) sendOut(); });
  // a tap on a marker (a tracker pumpkin, "me") or in its see-through gaps is
  // aimed at it, not a miss
  function onMarker(ev) {
    if (!ev || ev.clientX == null) return false;
    if (ev.target?.closest?.('.leaflet-marker-icon')) return true;
    return [...map.getPane('markerPane').parentNode.querySelectorAll('.leaflet-marker-icon:not(.nitc-pin)')].some((el) => {
      const r = el.getBoundingClientRect();
      return ev.clientX >= r.left - 6 && ev.clientX <= r.right + 6 && ev.clientY >= r.top - 6 && ev.clientY <= r.bottom + 6;
    });
  }
  if (import.meta.env.DEV) Object.assign(window, { hwFlock: flock, hwWitch: witch }); // try them from the console
  function witch() {
    const w = app.clientWidth, h = app.clientHeight;
    const el = document.createElement('div');
    el.className = 'hw-witch';
    el.innerHTML = WITCH;
    sky.append(el);
    const y = h * (0.25 + Math.random() * 0.3);
    const frames = [0, 0.2, 0.4, 0.6, 0.8, 1].map((k) => ({
      transform: `translate(${-140 + (w + 280) * k}px, ${y - Math.sin(k * Math.PI) * h * 0.18 + Math.sin(k * 14) * 10}px) rotate(${-8 + 10 * k}deg)`,
    }));
    el.animate(frames, { duration: 4200, easing: 'ease-in-out', fill: 'both' }).onfinish = () => el.remove();
  }
}
