// Read-only intel endpoints. bbox order is west,south,east,north. These return
// raw API JSON; the adapter turns it into the internal model.
import { api } from './client.js';

const bboxStr = (b) => `${b.w},${b.s},${b.e},${b.n}`;

// GET /v1/intel/map?bbox=W,S,E,N&zoom=0..22
export function getMap(bbox, zoom, signal) {
  const z = Math.max(0, Math.min(22, Math.round(zoom)));
  return api.get(`/v1/intel/map?bbox=${bboxStr(bbox)}&zoom=${z}`, { signal, etag: true });
}

// GET /v1/intel/portals/{uuid}
export function getPortal(id, signal) {
  return api.get(`/v1/intel/portals/${encodeURIComponent(id)}`, { signal, etag: true });
}

// GET /v1/intel/activity?bbox=…[&cursor|&after]
export function getActivity(bbox, { cursor, after } = {}, signal) {
  let q = `/v1/intel/activity?bbox=${bboxStr(bbox)}`;
  if (cursor) q += `&cursor=${encodeURIComponent(cursor)}`;
  else if (after) q += `&after=${encodeURIComponent(after)}`;
  return api.get(q, { signal, etag: false });
}
