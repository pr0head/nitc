// The map view: full-screen Leaflet with floating overlays —
//   top-left    : identity plate (brand + email + logout); portal card under it
//   bottom-left : COMM (activity log of the visible area)
//   top-right   : toolbar — layers, favorites, draw tools
//   bottom-right: my location, zoom, map status (what is shown, load state), attribution
import { createMap } from '../map/engine.js';
import { logout } from '../api/auth.js';
import { session } from '../state/session.js';
import { bus } from '../state/bus.js';
import { prefs } from '../state/prefs.js';
import { mountLayers } from './layers.js';
import { mountPortalCard } from './portal-card.js';
import { mountFavorites } from '../plugins/favorites.js';
import { mountPlans } from '../plugins/plans.js';
import { mountDrawTools } from '../plugins/draw-tools.js';
import { createMapStatus } from './map-status.js';
import { mountComm } from './comm.js';
import { mountLocate } from './locate.js';
import { esc } from './esc.js';

const LOGOUT_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';

// Leaving the map (logout, or a 401 from a revoked token) reloads the page:
// every overlay, listener and cache goes with it, and boot shows the login.
const leave = () => location.reload();

export function showApp(root) {
  root.innerHTML = `
    <div class="app">
      <div class="map" id="map"></div>
      <div class="who">
        <span class="who__brand">NITC</span>
        <span class="who__me" title="Вход по email — ник появится, когда API отдаст профиль">${esc(session.email) || 'agent'}</span>
        <button class="who__logout" type="button" title="Выйти">${LOGOUT_ICON}</button>
      </div>
    </div>`;

  const app = root.querySelector('.app');
  const mapEl = root.querySelector('#map');
  const status = createMapStatus();
  const firstVisit = !prefs.view; // no saved map position yet (read before the map saves one)

  const engine = createMap(mapEl, {
    statusEl: status.el,
    onStatus: status.update,
    onUnauthorized: leave,
    onPortalClick: (p) => bus.emit('portalClick', p),
  });

  // toolbar order follows mount order
  mountLayers(app, engine);
  mountFavorites(app, engine);
  mountPlans(engine);
  mountDrawTools(app, engine);
  mountPortalCard(engine);
  mountComm(app, engine);

  root.querySelector('.who__logout').addEventListener('click', async () => {
    if (!confirm(`Выйти из аккаунта${session.email ? ' ' + session.email : ''}?`)) return;
    await logout();
    leave();
  });

  engine.load(); // initial viewport
  // Start view: a deep link; else the last viewed position (restored by the
  // engine); else, on a first visit, the device location — and if that is
  // unavailable or refused, the default centre from config.
  const linked = openDeepLink(engine);
  mountLocate(engine, { centerOnStart: firstVisit && !linked });
  return engine;
}

// #p=<id>,<lat>,<lng> centres the map on a portal and opens its card (the
// card's "ссылка" builds exactly this). Returns whether it did.
function openDeepLink(engine) {
  const m = /[#&]p=([^,&]+),(-?[\d.]+),(-?[\d.]+)/.exec(location.hash);
  if (!m) return false;
  const id = decodeURIComponent(m[1]), lat = +m[2], lng = +m[3];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  engine.map.setView([lat, lng], Math.max(engine.map.getZoom(), 17));
  bus.emit('openPortal', { portal: { id, lat, lng, name: '' } });
  return true;
}
