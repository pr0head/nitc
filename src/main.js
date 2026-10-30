// Boot flow:
//   token present → validate it → valid: map, dead: login
//   no token → login
// Logout or a 401 later (token revoked server-side) reloads the page, which
// lands back here with no token → login.
import './ui/styles.css';
import { session } from './state/session.js';
import { validateSession } from './api/auth.js';
import { showLogin } from './ui/login.js';
import { showApp } from './ui/app.js';
import { applyHalloween } from './ui/halloween.js';

const root = document.getElementById('app');
applyHalloween();

// the bundle made it: stop the boot watchdog in index.html, drop its screen
window.__nitcBooted?.();

function toApp() {
  showApp(root);
}
function toLogin() {
  session.clear();
  showLogin(root, toApp);
}

async function boot() {
  if (!session.authed) return toLogin();
  try {
    await validateSession();
    toApp();
  } catch (e) {
    if (e?.code === 'unauthorized') toLogin();
    else toApp(); // transient error — keep the session, the map retries itself
  }
}

boot();
