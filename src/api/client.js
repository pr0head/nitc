// Transport: fetch + Bearer, JSON, ETag revalidation, error → code mapping.
// Business rules (link direction, geometry, antimeridian) do NOT live here —
// that is the adapter's job. This layer only moves bytes and normalizes errors.
import { API_BASE } from '../config.js';
import { session } from '../state/session.js';

// Raised for every non-2xx (and network) failure, carrying a stable `code`
// callers can branch on without parsing messages.
export class ApiError extends Error {
  constructor(code, message, { status = 0, retryAfter = 0 } = {}) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// path-keyed ETag cache for GETs: { etag, data }. 304 → return cached data.
const etagCache = new Map();

function mapError(status, body) {
  const code = body?.error?.code;
  if (code) return code;
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'origin_denied';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'request_failed';
}

async function request(method, path, { body, signal, auth = true, etag = false } = {}) {
  const url = API_BASE + path;
  const headers = {};
  if (auth && session.token) headers.Authorization = 'Bearer ' + session.token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const cached = etag && etagCache.get(path);
  if (cached) headers['If-None-Match'] = cached.etag;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e; // let callers ignore stale aborts
    throw new ApiError('network', 'Сеть недоступна');
  }

  if (res.status === 304 && cached) return cached.data;
  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 401) session.clear(); // token dead — force re-login
    throw new ApiError(mapError(res.status, data), data?.error?.message, {
      status: res.status,
      retryAfter: Number(res.headers.get('Retry-After')) || 0,
    });
  }

  if (etag) {
    const tag = res.headers.get('ETag');
    if (tag) etagCache.set(path, { etag: tag, data });
  }
  return data;
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts),
};
