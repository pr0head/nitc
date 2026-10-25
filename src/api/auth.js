// Auth flow: exchange email+password for an intel bearer, validate a stored
// token, revoke on logout. Login is rate-limited server-side (10 / 15 min / email).
import { api, ApiError } from './client.js';
import { session } from '../state/session.js';

// POST /v1/auth/intel/login → { token: "ngi_…", scope: "intel:read" }
export async function login(email, password) {
  const data = await api.post('/v1/auth/intel/login', { email, password }, { auth: false });
  if (!data?.token) throw new ApiError('invalid_response', 'Сервер не вернул токен');
  session.set(data.token);
  session.rememberEmail(email);
  return data;
}

// Cheapest authed call that confirms the token still works: a degenerate-bbox
// map request at links-only zoom (no portals, minimal payload). 200 → valid,
// ApiError('unauthorized') → dead token.
export async function validateSession(signal) {
  await api.get('/v1/intel/map?bbox=37.61,55.75,37.62,55.76&zoom=13', { signal, etag: false });
  return true;
}

// DELETE /v1/intel/session → 204. Clear locally even if the call fails.
export async function logout() {
  try { await api.del('/v1/intel/session'); } catch { /* best effort */ }
  session.clear();
}
