// Session token store. The token is an opaque, eternal `ngi_…` bearer with
// scope intel:read. It lives in localStorage so a reload keeps the user in.
// It never goes to git, logs, or any third party — only the Authorization
// header on Netgress requests.
const KEY = 'nitc.token';
const EMAIL_KEY = 'nitc.email'; // remembered for the login field only, not a secret

let token = null;
try { token = localStorage.getItem(KEY) || null; } catch { /* private mode */ }

export const session = {
  get token() { return token; },
  get authed() { return !!token; },

  set(t) {
    token = t || null;
    try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* ignore */ }
  },

  clear() { this.set(null); },

  get email() {
    try { return localStorage.getItem(EMAIL_KEY) || ''; } catch { return ''; }
  },
  rememberEmail(e) {
    try { e ? localStorage.setItem(EMAIL_KEY, e) : localStorage.removeItem(EMAIL_KEY); } catch { /* ignore */ }
  },
};
