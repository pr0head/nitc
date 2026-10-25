// Tiny app-wide event bus: features talk through named events instead of
// importing each other (map ↔ portal card ↔ favorites ↔ draw tools).
//
// Events:
//   portalClick portal              a portal dot was clicked on the map
//   openPortal  {portal, detail?}   open the card (favorites, deep link)
//   favoritesChanged                the starred list changed
//   highlightChanged                highlight prefs changed (area labels)
//   drawChanged shapes              draw tools saved its model
//   drawLoad    shapes              plans hands draw tools a model to show
//   toolActivated name              a map tool took over map clicks
const handlers = new Map();

export const bus = {
  on(ev, fn) {
    if (!handlers.has(ev)) handlers.set(ev, []);
    handlers.get(ev).push(fn);
  },
  emit(ev, data) {
    for (const fn of handlers.get(ev) || []) {
      try { fn(data); } catch (e) { console.error(ev, e); }
    }
  },
};

// One map tool at a time: a tool announces itself on open and every other tool
// hears 'toolActivated' with a name not its own and closes, so two crosshair
// modes never fight over the same map click. `drawMode` is true while a drawing
// tool captures portal clicks as vertices (the portal card then stays shut).
export const tools = {
  active: null,
  drawMode: false,
  activate(name) { this.active = name; bus.emit('toolActivated', name); },
  release(name) { if (this.active === name) this.active = null; },
};
