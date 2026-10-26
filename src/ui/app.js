// The map view: full-screen Leaflet with floating overlays, laid out the way
// IITC players expect: map tools on the left, information on the right.
//   top-left    : identity plate — "☰ NITC" menu (plugins, account) + email;
//                 always on top. Draw tools panel under it, when switched on
//   bottom-left : COMM (activity log of the visible area); expanded, it covers
//                 the draw panel
//   top-centre  : world MU balance
//   top-right   : layers button; the portal card docks in the corner and the
//                 button moves to its left while the card is open
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
import { mountScore } from './score.js';
import { mountAgentCard } from './agent-card.js';
import { getMe } from '../api/intel.js';
import { adaptAgent } from '../adapter/model.js';
import { fcol } from '../map/render.js';
import { createMenu } from './menu.js';
import { confirmBox } from './dialog.js';
import { esc } from './esc.js';

const LOGOUT_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
const PHONE_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/></svg>';
const APK_URL = 'https://github.com/pr0head/nitc/releases/latest';
// the Android shell appends this to its user agent
const inAndroidApp = /NITC-Android/.test(navigator.userAgent);

// Leaving the map (logout, or a 401 from a revoked token) reloads the page:
// every overlay, listener and cache goes with it, and boot shows the login.
const leave = () => location.reload();

export function showApp(root) {
  root.innerHTML = `
    <div class="app">
      <div class="map" id="map"></div>
      <div class="who">
        <span class="who__me" title="${esc(session.email)}">${esc(session.email) || 'agent'}</span>
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

  // the card and the layers button share the top-right corner: keep the card
  // above the bottom-right stack (location, zoom, status)
  const br = mapEl.querySelector('.leaflet-bottom.leaflet-right');
  new ResizeObserver(() => document.documentElement.style.setProperty('--br-h', br.offsetHeight + 'px')).observe(br);

  // menu items follow mount order: plugins, then the account section
  const menu = createMenu(root.querySelector('.who'));
  mountLayers(app, engine);
  mountPlans(engine); // before draw tools: they open the last plan
  mountDrawTools(app, engine, menu);
  mountFavorites(menu, engine);
  mountPortalCard(engine);
  mountComm(app, engine);
  mountScore(app);
  mountAgentCard();
  showMe(root.querySelector('.who__me'));

  menu.sep();
  if (!inAndroidApp) menu.add({ icon: PHONE_ICON, label: 'Приложение для Android', href: APK_URL });
  menu.add({
    icon: LOGOUT_ICON, label: 'Выйти',
    onClick: async () => {
      if (!(await confirmBox(`Выйти из аккаунта${session.email ? ' ' + session.email : ''}?`, 'Выйти'))) return;
      await logout();
      leave();
    },
  });

  engine.load(); // initial viewport
  // Start view: a deep link; else the last viewed position (restored by the
  // engine); else, on a first visit, the device location — and if that is
  // unavailable or refused, the default centre from config.
  const linked = openDeepLink(engine);
  mountLocate(engine, { centerOnStart: firstVisit && !linked });
  return engine;
}

// The plate shows the agent — nickname in faction colour and level — once
// /me answers; until then (or if it fails) the login email stays.
async function showMe(el) {
  let me;
  try { me = adaptAgent(await getMe()); } catch { return; }
  if (!me.nick) return;
  el.innerHTML = `<b style="color:${fcol(me.faction)}">${esc(me.nick)}</b> <span class="who__lvl">L${me.level}</span>`;
  // the plate's own name opens the agent's own card
  el.classList.add('who__me--link');
  el.addEventListener('click', () => bus.emit('openAgent', { id: me.id, nick: me.nick }));
  el.title = [
    session.email,
    `AP: ${me.ap.toLocaleString('ru-RU')}`,
    me.next ? `до L${me.next.level}: ${me.next.remaining.toLocaleString('ru-RU')} AP` : '',
  ].filter(Boolean).join('\n');
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
