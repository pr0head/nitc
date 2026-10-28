// The identity plate's menu: "☰ NITC" opens a dropdown of plugins and account
// actions, so optional tools live one click away without buttons on the map.
// Features add their own items (in mount order) through menu.add().
// The plate and its menu sit above every map panel; only modal dialogs and
// tooltips go over them.
const BARS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>';
import { backOpen, backClosed } from './back.js';

const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

// plate: the .who element; the button is inserted at its start
export function createMenu(plate) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'who__menu'; btn.title = 'Меню';
  btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `${BARS}<span class="who__brand">NITC</span>`;
  plate.prepend(btn);

  const list = document.createElement('div');
  list.className = 'menu'; list.setAttribute('role', 'menu'); list.hidden = true;
  plate.append(list);

  const items = []; // { el, isOn }
  const paint = () => items.forEach((it) => it.isOn && it.el.classList.toggle('on', !!it.isOn()));

  const close = () => setOpen(false);
  function setOpen(open) {
    if (open) backOpen(close); else backClosed(close);
    list.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('on', open);
    if (open) paint();
  }
  btn.addEventListener('click', () => setOpen(list.hidden));
  document.addEventListener('click', (e) => { if (!list.hidden && !plate.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !list.hidden) setOpen(false); });

  return {
    // { icon, label, onClick, isOn? (shows a check while true), href? (a link) }
    add({ icon = '', label, onClick, isOn, href }) {
      const el = document.createElement(href ? 'a' : 'button');
      el.className = 'menu-item'; el.setAttribute('role', 'menuitem');
      if (href) { el.href = href; el.target = '_blank'; el.rel = 'noopener'; } else el.type = 'button';
      el.innerHTML = `<span class="menu-ic">${icon}</span><span class="menu-lb"></span>` +
        (isOn ? `<span class="menu-ck">${CHECK}</span>` : '');
      el.querySelector('.menu-lb').textContent = label;
      el.addEventListener('click', () => { setOpen(false); onClick?.(); });
      list.append(el);
      items.push({ el, isOn });
      return el;
    },
    sep() {
      const s = document.createElement('div'); s.className = 'menu-sep'; list.append(s);
      return s;
    },
    // small muted text, e.g. the version at the very bottom
    note(text) {
      const n = document.createElement('div'); n.className = 'menu-note'; n.textContent = text; list.append(n);
      return n;
    },
    refresh: paint,
  };
}
