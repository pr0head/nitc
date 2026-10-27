// Agent tracker: where agents were in the last hours, drawn from the COMM
// events already loaded (state/tracks.js). Switched per faction by the
// "Агенты" row of the layers matrix; hidden below TRACK.minZoom (kept, not
// dropped).
//   pin   — an agent's last place, faction colour, fading with age; agents
//           last seen at one portal share a pin with a count; from
//           TRACK.labelZoom the nickname stands over it (freshest, "+N" more)
//   trail — dashed line through the agent's places, one colour, thinner and
//           paler in four age steps
//   click — a window: each agent there, the portal now and all places before
//           (a scrolling block), one line each: clock time (how long ago in
//           the tooltip), portal, what was done there;
//           with a mouse it docks on the right without a shade, and hovering
//           a place rings it on the map (panned into view if hidden)
//   focus — one agent's trail stands out, the rest dim (from the window or
//           the agent card); a chip on the map names them
//           (opens their card) and clears it
import L from 'leaflet';
import './tracker.css';
import { MAP, TRACK } from '../config.js';
import { tracks, ago } from '../state/tracks.js';
import { bus, tools } from '../state/bus.js';
import { fcol } from '../map/render.js';
import { geodesicPath } from '../map/geo.js';
import { createListModal } from '../ui/dialog.js';
import { coarsePointer } from '../ui/toolbar.js';
import { agentLink } from '../ui/agent-card.js';
import { esc } from '../ui/esc.js';
import { KIND_LABEL } from '../ui/events.js';

const BUCKETS = 4;
const OPEN_ZOOM = MAP.minPortalZoom; // a portal opens where portals are visible
const pin = (col) =>
  '<svg width="20" height="28" viewBox="0 0 20 28"><path d="M10 27S2 16.5 2 10a8 8 0 0 1 16 0c0 6.5-8 17-8 17z" ' +
  `fill="${col}" stroke="#000" stroke-width="1.3"/><circle cx="10" cy="10" r="3.2" fill="#000" fill-opacity=".45"/></svg>`;
const lastOf = (a) => a.places[a.places.length - 1];
const pad = (v) => String(v).padStart(2, '0');
const hhmm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const X_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

export function mountTracker(container, engine) {
  const map = engine.map;
  map.createPane('nitcTrack');
  map.getPane('nitcTrack').style.zIndex = 630; // over portals, under the COMM highlight
  const LINE = { pane: 'nitcTrack', renderer: L.svg({ pane: 'nitcTrack' }), interactive: false };
  const layer = L.layerGroup().addTo(map);
  const modal = createListModal('Трекер агента', 'trk-box');
  if (!coarsePointer) modal.el.classList.add('trk-lm');
  const spot = L.layerGroup().addTo(map); // the hovered place
  let focus = null;  // focused agent key
  let atPin = [];    // agent keys of the open window

  const chip = document.createElement('div');
  chip.className = 'trk-chip'; chip.hidden = true;
  container.append(chip);
  L.DomEvent.disableClickPropagation(chip);
  chip.addEventListener('click', (e) => {
    if (e.target.closest('.trk-chip-x')) { setFocus(null); return; }
    const ag = e.target.closest('.ag-link');
    if (ag) { e.preventDefault(); bus.emit('openAgent', { id: ag.dataset.id, nick: ag.dataset.nick }); }
  });

  // a focused agent shows even when their faction's row is off
  const shown = (a) => a.key === focus || !!engine.prefs.filters.show.agents[a.faction];

  function draw() {
    layer.clearLayers();
    if (map.getZoom() < TRACK.minZoom) return;
    const now = Date.now(), split = TRACK.windowMs / BUCKETS;
    const labels = map.getZoom() >= TRACK.labelZoom;
    const list = tracks.all().filter(shown);

    for (const a of list) {
      const on = a.key === focus, dim = focus && !on;
      for (let i = 1; i < a.places.length; i++) {
        const from = a.places[i - 1].portal, to = a.places[i].portal;
        const b = Math.min(BUCKETS - 1, Math.floor((now - a.places[i].time) / split)); // age of the newer end
        L.polyline(geodesicPath([[from.lat, from.lng], [to.lat, to.lng]]), {
          ...LINE, color: TRACK.color, dashArray: '5,8',
          weight: 2 - 0.25 * b + (on ? 1 : 0), opacity: (1 - 0.2 * b) * (dim ? 0.25 : 1),
        }).addTo(layer);
      }
    }

    const at = new Map(); // portal id → agents last seen there, freshest first
    for (const a of list) {
      const id = lastOf(a).portal.id;
      if (!at.has(id)) at.set(id, []);
      at.get(id).push(a);
    }
    for (const group of at.values()) {
      group.sort((x, y) => lastOf(y).time - lastOf(x).time);
      const { portal, time } = lastOf(group[0]);
      const mine = group.some((a) => a.key === focus);
      const fresh = Math.max(0, 1 - (now - time) / TRACK.windowMs);
      const icon = L.divIcon({
        className: 'trk-pin',
        html: pin(fcol(group[0].faction)) + (group.length > 1 ? `<span class="trk-n">${group.length}</span>` : '') +
          (labels ? `<span class="trk-nick" style="color:${fcol(group[0].faction)}">${esc(group[0].nick)}` +
            `${group.length > 1 ? ` <i>+${group.length - 1}</i>` : ''}</span>` : ''),
        iconSize: [20, 28], iconAnchor: [10, 27],
      });
      L.marker([portal.lat, portal.lng], {
        icon, pane: 'nitcTrack', keyboard: false, zIndexOffset: mine ? 1000 : 0,
        opacity: (0.3 + 0.7 * fresh) * (focus && !mine ? 0.4 : 1),
        title: group.map((a) => `${a.nick}, ${ago(lastOf(a).time, now)}`).join('\n'),
      }).on('click', () => {
        // drawing: the pin stands on a portal — let the click pick the portal
        if (tools.drawMode) { bus.emit('portalClick', { id: portal.id, name: portal.name, lat: portal.lat, lng: portal.lng }); return; }
        atPin = group.map((a) => a.key); paintWindow(); modal.open();
      }).addTo(layer);
    }
  }

  // ---- the pin's window ----
  function portalLink(a, i) {
    const p = a.places[i].portal;
    const href = `#p=${encodeURIComponent(p.id)},${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
    return `<a class="trk-p" href="${esc(href)}" data-key="${esc(a.key)}" data-i="${i}">${esc(p.name || 'портал')}</a>`;
  }
  // what was done at a place, in order: "захват · линк → Target". A first
  // link comes as its own event beside the link: it only renames that link.
  function actions(place) {
    const firsts = new Set(place.actions.filter((x) => x.kind === 'first_link').map((x) => x.target?.id));
    const links = new Set(place.actions.filter((x) => x.kind === 'link_create').map((x) => x.target?.id));
    const parts = [];
    for (const x of place.actions) {
      if (x.kind === 'first_link' && links.has(x.target?.id)) continue;
      const label = KIND_LABEL[x.kind === 'link_create' && firsts.has(x.target?.id) ? 'first_link' : x.kind] || x.kind;
      parts.push(esc(label) + (x.target ? ' → ' + esc(x.target.name || 'портал') : ''));
    }
    const text = parts.join(' · ');
    return `<span class="trk-act" title="${text}">${text}</span>`;
  }

  function paintWindow() {
    const now = Date.now();
    const list = atPin.map((k) => tracks.get(k)).filter(Boolean);
    if (!list.length) { modal.close(); return; }
    modal.setTitle(list.length === 1 ? 'Трекер агента' : `Агенты здесь: ${list.length}`);
    modal.list.innerHTML = list.map((a) => {
      const n = a.places.length;
      const before = [];
      for (let i = n - 2; i >= 0; i--) {
        const t = a.places[i].time;
        before.push(`<div class="trk-row"><span class="trk-t" title="${ago(t, now)}">${hhmm(t)}</span>` +
          `${portalLink(a, i)}${actions(a.places[i])}</div>`);
      }
      return '<div class="trk-ag">' +
        `<div class="trk-h">${agentLink(a.nick, { id: a.id, color: fcol(a.faction) })}` +
        `<span class="trk-t">${ago(a.places[n - 1].time, now)}</span></div>` +
        `<div class="trk-row trk-now">${portalLink(a, n - 1)}${actions(a.places[n - 1])}</div>` +
        (before.length ? `<div class="trk-sub">Ранее · ${before.length}</div><div class="trk-before">${before.join('')}</div>` : '') +
        `<button type="button" class="trk-btn" data-key="${esc(a.key)}">${a.key === focus ? 'Снять выделение' : 'Выделить след'}</button>` +
        '</div>';
    }).join('');
  }
  modal.list.addEventListener('click', (e) => {
    const ag = e.target.closest('.ag-link');
    if (ag) {
      e.preventDefault(); modal.close();
      bus.emit('openAgent', { id: ag.dataset.id, nick: ag.dataset.nick });
      return;
    }
    const pl = e.target.closest('.trk-p');
    if (pl) {
      e.preventDefault();
      const p = tracks.get(pl.dataset.key)?.places[+pl.dataset.i]?.portal;
      if (!p) return;
      ring(null); modal.close();
      map.setView([p.lat, p.lng], Math.max(map.getZoom(), OPEN_ZOOM));
      bus.emit('openPortal', { portal: { id: p.id, name: p.name, lat: p.lat, lng: p.lng } });
      return;
    }
    const b = e.target.closest('.trk-btn');
    if (b) { ring(null); modal.close(); setFocus(b.dataset.key === focus ? null : b.dataset.key); }
  });

  // hovering a place in the window rings it; the map pans just enough to show
  // it beside the window
  function ring(p) {
    spot.clearLayers();
    if (!p) return;
    const ll = [p.lat, p.lng];
    L.circleMarker(ll, { ...LINE, radius: 14, color: TRACK.color, weight: 3, fill: false }).addTo(spot);
    L.circleMarker(ll, { ...LINE, radius: 4, color: TRACK.color, weight: 1, fillColor: TRACK.color, fillOpacity: 1 }).addTo(spot);
    const box = modal.el.querySelector('.lm-box').getBoundingClientRect();
    map.panInside(ll, { paddingTopLeft: [40, 40], paddingBottomRight: [window.innerWidth - box.left + 40, 40] });
  }
  if (!coarsePointer) {
    modal.list.addEventListener('mouseover', (e) => {
      const a = e.target.closest('.trk-now, .trk-row')?.querySelector('.trk-p');
      ring(a ? tracks.get(a.dataset.key)?.places[+a.dataset.i]?.portal : null);
    });
    modal.list.addEventListener('mouseleave', () => ring(null));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ring(null); });
  }

  // ---- focus ----
  function setFocus(key, { center = false } = {}) {
    const a = key ? tracks.get(key) : null;
    focus = a ? key : null;
    bus.emit('agentFocus', a ? { id: a.id, nick: a.nick, faction: a.faction } : null);
    chip.hidden = !a;
    if (a) {
      chip.innerHTML = `<span class="trk-chip-dot" style="border-color:${TRACK.color}"></span>` +
        agentLink(a.nick, { id: a.id, color: fcol(a.faction) }) +
        `<button type="button" class="trk-chip-x" title="Снять выделение">${X_ICON}</button>`;
    }
    if (a && center) {
      const p = lastOf(a).portal;
      map.setView([p.lat, p.lng], Math.max(map.getZoom(), OPEN_ZOOM));
    }
    draw();
  }
  // the agent card: by profile id or nickname; no track → nothing to show
  bus.on('focusAgent', (q) => {
    const a = q && tracks.find(q);
    setFocus(a ? a.key : null, { center: true });
  });

  bus.on('commEvents', (evs) => { if (tracks.add(evs)) draw(); });
  // only the agents row concerns the tracker; other filters leave it be
  let agentsWas = JSON.stringify(engine.prefs.filters.show.agents);
  bus.on('filtersChanged', (f) => {
    const now = JSON.stringify(f.show.agents);
    if (now !== agentsWas) { agentsWas = now; draw(); }
  });
  map.on('zoomend', draw);
  // once a minute: drop what aged out of the window, refade the pins
  setInterval(() => {
    tracks.prune();
    if (focus && !tracks.get(focus)) setFocus(null); else draw();
  }, 60000);
}
