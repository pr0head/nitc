// Persisted UI preferences: base map + overlay filters. localStorage only,
// per-viewer convenience — safe to come back empty (private mode, cleared data).
const KEY = 'nitc.prefs';

// Overlay filters: a portal level range (0 = unclaimed) and a type × faction
// matrix — each of portals/links/fields shown per faction on its own.
const FILTER_ROWS = ['portals', 'links', 'fields'];
const both = () => ({ res: true, enl: true });

function defaults() {
  const show = {};
  for (const r of FILTER_ROWS) show[r] = both();
  return {
    baseMap: 'yandex',
    filters: { minLevel: 0, maxLevel: 8, show },
    // Portal/field highlight overlay (IITC-style). Arc/text values are option
    // keys from map/highlight.js; unknown keys degrade to "no highlight".
    highlight: { top: 'none', bottom: 'none', text: 'none', fieldArea: false, fieldMu: false },
    // COMM panel: event group filter, faction toggles, expanded or compact
    comm: { kind: 'all', res: true, enl: true, open: false },
    draw: false, // draw tools switched on (plate menu)
  };
}

function load() {
  const d = defaults();
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (s.baseMap) d.baseMap = s.baseMap;
    if (s.filters) d.filters = loadFilters(s.filters, d.filters);
    if (s.highlight) Object.assign(d.highlight, s.highlight); // migrate: prefs saved before highlight existed
    if (s.view && Array.isArray(s.view.center)) d.view = s.view;
    if (s.comm) Object.assign(d.comm, s.comm);
    if (typeof s.draw === 'boolean') d.draw = s.draw;
  } catch { /* defaults */ }
  return d;
}

// Saved filters, current shape or the older one: per-level checkboxes + a
// neutral toggle become the range from the lowest to the highest level on;
// a faction or type switched off turns off its whole column or row.
function loadFilters(s, d) {
  const lvl = (v) => (Number.isInteger(v) && v >= 0 && v <= 8 ? v : null);
  if (s.show) {
    for (const r of FILTER_ROWS) Object.assign(d.show[r], s.show[r]);
    d.minLevel = lvl(s.minLevel) ?? d.minLevel;
    d.maxLevel = Math.max(d.minLevel, lvl(s.maxLevel) ?? d.maxLevel);
    return d;
  }
  const on = [];
  if (s.neutral !== false) on.push(0);
  for (let n = 1; n <= 8; n++) if (!s.levels || s.levels[n] !== false) on.push(n);
  if (on.length) { d.minLevel = on[0]; d.maxLevel = on[on.length - 1]; }
  for (const r of FILTER_ROWS) {
    for (const fac of ['res', 'enl']) d.show[r][fac] = s[fac] !== false && (r === 'portals' || s[r] !== false);
  }
  return d;
}

let state = load();

export const prefs = {
  get all() { return state; },
  get baseMap() { return state.baseMap; },
  get filters() { return state.filters; },
  get highlight() { return state.highlight; },
  get view() { return state.view || null; }, // last {center:[lat,lng], zoom}
  get comm() { return state.comm; },
  get draw() { return state.draw; },
  set(patch) {
    state = { ...state, ...patch };
    this.save();
  },
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  },
};
