// The map view: full-screen Leaflet with floating overlays, laid out the way
// IITC players expect: map tools on the left, information on the right.
//   top-left    : identity plate — "☰ NITC" menu (plugins, account) + email;
//                 always on top. Draw tools panel under it, when switched on
//   bottom-left : COMM (activity log of the visible area); expanded, it covers
//                 the draw panel
//   top-centre  : world MU balance; under it, the agent the tracker focuses
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
import { mountInventory } from '../plugins/inventory.js';
import { mountTracker } from '../plugins/tracker.js';
import { keys } from '../state/keys.js';
import { createMapStatus } from './map-status.js';
import { mountComm } from './comm.js';
import { mountLocate } from './locate.js';
import { createPin } from './pin.js';
import { mountScore } from './score.js';
import { mountAgentCard } from './agent-card.js';
import { getMe } from '../api/intel.js';
import { adaptAgent } from '../adapter/model.js';
import { fcol } from '../map/render.js';
import { createMenu } from './menu.js';
import { confirmBox } from './dialog.js';
import { esc } from './esc.js';
import { APK_URL, inAndroidApp, androidAppVersion, releaseUrl, appUpdate, updateUrl } from './android.js';
import { version } from '../../package.json';

const LOGOUT_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
const PHONE_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/></svg>';

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
  mountInventory(menu, engine);
  mountPortalCard(engine);
  mountTracker(app, engine); // before COMM: it lives on COMM's events
  mountComm(app, engine, menu);
  mountScore(app, menu);
  mountAgentCard();
  keys.start(); // own key set: card line, key highlight/filter, inventory
  showMe(root.querySelector('.who__me'));

  menu.sep();
  if (!inAndroidApp) menu.add({ icon: PHONE_ICON, label: 'Приложение для Android', href: APK_URL });
  if (appUpdate) menu.add({ icon: PHONE_ICON, label: `Обновить до ${appUpdate}`, href: updateUrl });
  menu.add({
    icon: LOGOUT_ICON, label: 'Выйти',
    onClick: async () => {
      if (!(await confirmBox(`Выйти из аккаунта${session.email ? ' ' + session.email : ''}?`, 'Выйти'))) return;
      await logout();
      leave();
    },
  });
  // the map comes from the site, so its version is the site's; the app shell
  // has its own (it is rebuilt only when it changes). Links to the release notes.
  menu.note(`NITC ${version}` + (androidAppVersion ? ` · приложение ${androidAppVersion}` : ''), releaseUrl(version));

  engine.load(); // initial viewport
  // Start view: a deep link; else the last viewed position (restored by the
  // engine); else, on a first visit, the device location — and if that is
  // unavailable or refused, the default centre from config.
  const pin = createPin(engine.map);
  const linked = openDeepLink(engine, pin);
  mountLocate(engine, { centerOnStart: firstVisit && !linked });
  // a link pasted into the open tab changes only the hash: no reload
  addEventListener('hashchange', () => openDeepLink(engine, pin));
  offerUpdate();
  return engine;
}

// A newer app shell: say so once per version, a moment after the map starts;
// the menu keeps its update item while the app is out of date. Without
// storage we can't remember the answer, so we stay quiet rather than nag.
const OFFERED = 'nitc.apkOffered';
function offerUpdate() {
  if (!appUpdate) return;
  try {
    if (localStorage.getItem(OFFERED) === appUpdate) return;
    localStorage.setItem(OFFERED, appUpdate);
  } catch { return; }
  setTimeout(async () => {
    const msg = `Вышла новая версия приложения: ${appUpdate} (у вас ${androidAppVersion}). ` +
      'Скачайте её и установите поверх старой.';
    if (await confirmBox(msg, 'Скачать', 'Позже')) location.assign(updateUrl);
  }, 3000);
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
// card's "ссылка" builds exactly this). #ll=<lat>,<lng>[&z=<zoom>] centres on
// a point and drops a pin there; without z the zoom stays as it was (the last
// one, or the default). Returns whether a link was opened. The link is used
// up: it leaves the address, so a reload doesn't open it again.
function openDeepLink(engine, pin) {
  const h = location.hash;
  const p = /[#&]p=([^,&]+),(-?[\d.]+),(-?[\d.]+)/.exec(h);
  const q = /[#&]ll=(-?[\d.]+),(-?[\d.]+)/.exec(h);
  if (!p && !q) return false;
  history.replaceState(history.state, '', location.pathname + location.search);
  if (p) {
    const id = decodeURIComponent(p[1]), lat = +p[2], lng = +p[3];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    engine.map.setView([lat, lng], Math.max(engine.map.getZoom(), 17));
    bus.emit('openPortal', { portal: { id, lat, lng, name: '' } });
    return true;
  }
  const lat = +q[1], lng = +q[2];
  if (!(Math.abs(lat) <= 85) || !(Math.abs(lng) <= 180)) return false;
  const z = /[#&]z=(\d{1,2})(?![\d.])/.exec(h);
  const zoom = z ? Math.min(Math.max(+z[1], 3), 21) : engine.map.getZoom();
  engine.map.setView([lat, lng], zoom);
  pin.show(lat, lng);
  return true;
}
