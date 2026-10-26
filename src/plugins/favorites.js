// Favorites: menu item → modal with the starred portals, sorted by title.
// Clicking one re-fetches /portals/{id}, refreshes the stored copy, centres the
// map on it and opens its card. Starring happens in the portal card header.
//
// Fetch on click, not in the background: a list may hold hundreds of portals
// and renames/moves are rare, so syncing the whole list would burn the request
// budget for nothing — an entry is refreshed exactly when it is used. A 404
// means the portal is gone: say so and drop it rather than fly to a hole.
import { getPortal } from '../api/intel.js';
import { adaptPortalDetail } from '../adapter/model.js';
import { favorites, favLabel } from '../state/favorites.js';
import { bus } from '../state/bus.js';
import { createListModal, confirmBox, alertBox } from '../ui/dialog.js';
import { esc } from '../ui/esc.js';
import { STAR, TRASH } from '../ui/icons.js';

const OPEN_ZOOM = 15;

export function mountFavorites(menu, engine) {
  const modal = createListModal('Избранное');
  menu.add({ icon: STAR(16), label: 'Избранное', onClick: open });

  function open() { renderList(); modal.open(); }
  bus.on('favoritesChanged', () => { if (modal.isOpen) renderList(); });

  function renderList() {
    const items = favorites.list();
    if (!items.length) {
      modal.list.innerHTML = '<div class="lm-empty">Избранного пока нет.<br><br>' +
        'Нажмите на портал на карте, затем ' +
        `<span class="lm-hint">${STAR(13)}</span> в заголовке его карточки.</div>`;
      return;
    }
    modal.list.innerHTML = items.map((f) =>
      '<div class="lm-item">' +
      `<button type="button" class="lm-row" data-id="${esc(f.id)}"><span class="lm-name">${esc(favLabel(f))}</span></button>` +
      `<button type="button" class="lm-del" data-del="${esc(f.id)}" title="Убрать из избранного">${TRASH}</button>` +
      '</div>').join('');
  }

  let busy = false;
  modal.list.addEventListener('click', async (e) => {
    const del = e.target.closest('.lm-del');
    if (del) {
      const f = favorites.get(del.dataset.del);
      if (!f) { renderList(); return; }
      if (await confirmBox(`Убрать «${favLabel(f)}» из избранного?`, 'Убрать')) favorites.remove(f.id);
      return;
    }
    const row = e.target.closest('.lm-row');
    if (!row || busy) return;
    const f = favorites.get(row.dataset.id);
    if (!f) { renderList(); return; }
    busy = true; row.classList.add('loading');
    try {
      const d = adaptPortalDetail(await getPortal(f.id));
      // it may have been renamed or moved since it was starred — resync
      const lat = Number.isFinite(d.lat) ? d.lat : f.lat;
      const lng = Number.isFinite(d.lng) ? d.lng : f.lng;
      favorites.add({ id: f.id, name: d.name || f.title, lat, lng });
      modal.close();
      if (Number.isFinite(lat) && Number.isFinite(lng)) engine.map.setView([lat, lng], OPEN_ZOOM);
      // hand the fetched detail to the card so it doesn't refetch
      bus.emit('openPortal', { portal: { ...d, lat, lng }, detail: d });
    } catch (err) {
      if (err?.code === 'portal_not_found' || err?.code === 'not_found') {
        favorites.remove(f.id);
        await alertBox(`«${favLabel(f)}» больше не существует и убран из избранного.`);
      } else {
        await alertBox('Не удалось загрузить портал: ' + (err?.code || err?.message || err));
      }
    } finally {
      busy = false; row.classList.remove('loading');
    }
  });
}
