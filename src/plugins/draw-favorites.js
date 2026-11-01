// Draw from favorites: while the line or triangle tool is on, the ★ in the
// draw panel opens the favorites as a picker. A tap on a portal makes it the
// next vertex, exactly as a tap on it on the map would; the list stays open
// until the shape is complete. Taps on the map and picks from the list feed
// the same shape, so near portals can be tapped and far ones picked.
//   - a picked portal shows its vertex number; tapping the last one again
//     takes it back, the others are locked (one portal, one vertex)
//   - search and groups as in the favorites window; a portal in several
//     groups shows in each
// No requests: the stored positions are used as they are.
import { favorites, favLabel } from '../state/favorites.js';
import { createListModal } from '../ui/dialog.js';
import { esc } from '../ui/esc.js';

const CARET = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';
const NUM = ['①', '②', '③'];
const NONE = '__none__';

// state(): { name, need, ids } — the tool's name, vertices it needs, the
// favorites already picked (by vertex; null for a vertex tapped on the map)
export function createFavPicker({ state, onPick, onUndo, onClose }) {
  const modal = createListModal('', 'fav-box');
  let query = '';
  const folded = new Set();

  // closed by ×, the backdrop, Escape or Back alike
  new MutationObserver(() => { if (modal.el.hidden) onClose(); })
    .observe(modal.el, { attributes: true, attributeFilter: ['hidden'] });

  function open() {
    modal.list.innerHTML =
      '<div class="fav-bar">' +
      `<input type="search" class="fav-search" placeholder="Поиск по названию" value="${esc(query)}"></div>` +
      '<div class="dfav-hint"></div><div class="fav-groups"></div>';
    render();
    modal.open();
  }

  function render() {
    const { name, need, ids } = state();
    modal.setTitle(`${name}: вершина ${Math.min(ids.length + 1, need)} из ${need}`);
    modal.list.querySelector('.dfav-hint').textContent = ids.some(Boolean)
      ? 'Нажмите портал — он станет следующей вершиной. Нажмите последний номер ещё раз, чтобы убрать его.'
      : 'Нажмите портал — он станет следующей вершиной.';
    const box = modal.list.querySelector('.fav-groups');
    if (!favorites.list().length) {
      box.innerHTML = '<div class="lm-empty">Избранного пока нет.</div>';
      return;
    }
    const q = query.trim().toLocaleLowerCase('ru');
    const match = (f) => !q || favLabel(f).toLocaleLowerCase('ru').includes(q);
    const sections = favorites.groups().map((g) => ({ key: g.id, name: g.name, items: favorites.inGroup(g.id).filter(match) }));
    sections.push({ key: NONE, name: 'Без группы', items: favorites.ungrouped().filter(match) });
    const last = ids.length - 1;
    const row = (f) => {
      const at = ids.indexOf(f.id);
      const ok = Number.isFinite(f.lat) && Number.isFinite(f.lng);
      const locked = !ok || (at >= 0 && at !== last);
      return '<div class="lm-item">' +
        `<button type="button" class="lm-row${at >= 0 ? ' dfav-on' : ''}" data-id="${esc(f.id)}"${locked ? ' disabled' : ''}>` +
        `<span class="lm-name">${esc(favLabel(f))}</span>` +
        (at >= 0 ? `<span class="dfav-n">${NUM[at] || at + 1}</span>` : '') +
        '</button></div>';
    };
    const html = sections.filter((s) => s.items.length).map((s) => {
      const open = !!q || !folded.has(s.key);
      return '<div class="fav-g"><div class="fav-gh">' +
        `<button type="button" class="fav-caret${open ? ' on' : ''}" data-fold="${esc(s.key)}">${CARET}</button>` +
        `<span class="fav-gname" data-fold="${esc(s.key)}">${esc(s.name)}</span>` +
        `<span class="fav-gcount">${s.items.length}</span></div>` +
        (open ? `<div class="fav-items">${s.items.map(row).join('')}</div>` : '') + '</div>';
    }).join('');
    box.innerHTML = html || '<div class="lm-empty">Ничего не найдено.</div>';
  }

  modal.list.addEventListener('input', (e) => {
    if (e.target.closest('.fav-search')) { query = e.target.value; render(); }
  });
  modal.list.addEventListener('click', (e) => {
    const fold = e.target.closest('[data-fold]');
    if (fold) {
      const k = fold.dataset.fold;
      if (folded.has(k)) folded.delete(k); else folded.add(k);
      render();
      return;
    }
    const b = e.target.closest('.lm-row');
    if (!b || b.disabled) return;
    const f = favorites.get(b.dataset.id);
    if (!f) return;
    const { ids } = state();
    if (ids.length && ids[ids.length - 1] === f.id) onUndo();
    else if (onPick(f)) { modal.close(); return; } // the shape is complete
    render();
  });

  return { open, get isOpen() { return modal.isOpen; } };
}
