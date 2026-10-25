// Top-right vertical toolbar. Items stack in mount order: layers, favorites,
// draw tools.
//   addToolbarButton — button + side panel. On a mouse the panel opens on hover
//     (kept open while over the icon or the panel, closes hideDelay ms after
//     leaving both) and a click pins/unpins it. On touch, mouseenter fires on
//     tap and would leave panels stuck open, so there the button is a plain
//     toggle and a tap outside closes it.
//   addToolbarAction — a plain button (opens a modal, toggles a tool).
export const coarsePointer = matchMedia('(pointer: coarse)').matches;

function getToolbar(container) {
  let tb = container.querySelector('.toolbar');
  if (!tb) { tb = document.createElement('div'); tb.className = 'toolbar'; container.appendChild(tb); }
  return tb;
}

function makeItem(container, { icon, title }) {
  const item = document.createElement('div'); item.className = 'tb-item';
  const btn = document.createElement('button'); btn.className = 'tb-btn'; btn.type = 'button';
  btn.title = title; btn.innerHTML = icon;
  item.append(btn);
  getToolbar(container).append(item);
  return { item, btn };
}

export function addToolbarButton(container, { icon, title, hideDelay = 1000 }) {
  const { item, btn } = makeItem(container, { icon, title });
  const panel = document.createElement('div'); panel.className = 'tb-panel'; panel.hidden = true;
  item.append(panel);

  let t = null;
  const show = () => { clearTimeout(t); t = null; panel.hidden = false; };
  const scheduleHide = () => {
    clearTimeout(t);
    t = setTimeout(() => { panel.hidden = true; t = null; }, hideDelay);
  };
  if (coarsePointer) {
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !item.contains(e.target)) panel.hidden = true;
    });
  } else {
    btn.addEventListener('mouseenter', show);
    btn.addEventListener('mouseleave', scheduleHide);
    panel.addEventListener('mouseenter', show);
    panel.addEventListener('mouseleave', scheduleHide);
  }
  // click pins/unpins regardless of hover
  btn.addEventListener('click', () => { clearTimeout(t); t = null; panel.hidden = !panel.hidden; });
  return { item, btn, panel };
}

export function addToolbarAction(container, { icon, title, onClick }) {
  const r = makeItem(container, { icon, title });
  r.btn.addEventListener('click', onClick);
  return r;
}
