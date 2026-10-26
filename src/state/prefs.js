// Persisted UI preferences: base map + overlay filters. localStorage only,
// per-viewer convenience — safe to come back empty (private mode, cleared data).
const KEY = 'nitc.prefs';

function defaults() {
  const levels = {};
  for (let n = 1; n <= 8; n++) levels[n] = true;
  return {
    baseMap: 'yandex',
    filters: { levels, neutral: true, res: true, enl: true, links: true, fields: true, keysOnly: false },
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
    if (s.filters) {
      Object.assign(d.filters, s.filters);
      if (s.filters.levels) Object.assign(d.filters.levels, s.filters.levels);
    }
    if (s.highlight) Object.assign(d.highlight, s.highlight); // migrate: prefs saved before highlight existed
    if (s.view && Array.isArray(s.view.center)) d.view = s.view;
    if (s.comm) Object.assign(d.comm, s.comm);
    if (typeof s.draw === 'boolean') d.draw = s.draw;
  } catch { /* defaults */ }
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
