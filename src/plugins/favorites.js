// Favorites: menu item → modal with the starred portals in groups.
//   - a group is a collapsible section: name, count, and actions — the eye
//     (its portals take part in the "Избранное" highlight; on by default),
//     rename, export (JSON to the clipboard), delete
//   - a portal may sit in several groups; "Без группы" holds the rest and has
//     an eye of its own
//   - search filters every group by portal name
//   - "+ группа" and "импорт" (JSON from another NITC, or an IITC bookmarks
//     export) at the top
// Group membership is set from the portal card (the ▾ next to its star).
//
// Clicking a portal re-fetches /portals/{id}, refreshes the stored copy,
// centres the map on it and opens its card. Fetch on click, not in the
// background: a list may hold hundreds of portals and renames/moves are rare,
// so syncing the whole list would burn the request budget for nothing. A 404
// (the portal is gone, or the id came stale from an import) still centres the
// map on the stored position and says so; the entry stays — removing it is
// the user's call.
import './favorites.css';
import { getPortal } from '../api/intel.js';
import { adaptPortalDetail } from '../adapter/model.js';
import { favorites, favLabel } from '../state/favorites.js';
import { bus } from '../state/bus.js';
import { createListModal, confirmBox, promptBox, alertBox } from '../ui/dialog.js';
import { esc } from '../ui/esc.js';
import { STAR, TRASH, PENCIL } from '../ui/icons.js';

const OPEN_ZOOM = 15;
const svg = (body) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const EYE = svg('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>');
const COPY = svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>');
const EYE_OFF = svg('<path d="M17.94 17.94A10.1 10.1 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 7 11 7a18.6 18.6 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>');
const CARET = svg('<polyline points="9 6 15 12 9 18"/>');
const OUT = svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>');
const NONE = '__none__'; // the "Без группы" section's key

export function mountFavorites(menu, engine) {
  const modal = createListModal('Избранное', 'fav-box');
  menu.add({ icon: STAR(16), label: 'Избранное', onClick: open });

  let query = '';
  let noneOpen = true;

  function open() { render(); modal.open(); }
  bus.on('favoritesChanged', () => { if (modal.isOpen) renderList(); });

  // the bar (search, actions) is drawn once per open; typing redraws the list only
  function render() {
    modal.list.innerHTML =
      '<div class="fav-bar">' +
      `<input type="search" class="fav-search" placeholder="Поиск по названию" value="${esc(query)}">` +
      '<button type="button" class="fav-act" data-act="new">+ группа</button>' +
      '<button type="button" class="fav-act" data-act="import">импорт</button></div>' +
      '<div class="fav-groups"></div>';
    renderList();
  }

  function renderList() {
    const box = modal.list.querySelector('.fav-groups');
    if (!box) return;
    if (!favorites.list().length && !favorites.groups().length) {
      box.innerHTML = '<div class="lm-empty">Избранного пока нет.<br><br>' +
        'Нажмите на портал на карте, затем ' +
        `<span class="lm-hint">${STAR(13)}</span> в заголовке его карточки.</div>`;
      return;
    }
    const q = query.trim().toLocaleLowerCase('ru');
    const match = (f) => !q || favLabel(f).toLocaleLowerCase('ru').includes(q);
    const sections = favorites.groups().map((g) => ({ g, items: favorites.inGroup(g.id).filter(match) }));
    sections.push({ g: null, items: favorites.ungrouped().filter(match) });
    const html = sections
      // while searching, only groups with hits; otherwise every group (an empty
      // one too — it was made for a reason), and "Без группы" when not empty
      .filter(({ g, items }) => (q ? items.length : g || items.length))
      .map(({ g, items }) => section(g, items, !!q)).join('');
    box.innerHTML = html || '<div class="lm-empty">Ничего не найдено.</div>';
  }

  function section(g, items, searching) {
    const key = g ? g.id : NONE;
    const isOpen = searching || (g ? g.open : noneOpen);
    const head = '<div class="fav-gh">' +
      `<button type="button" class="fav-caret${isOpen ? ' on' : ''}" data-act="fold" data-g="${key}" title="${isOpen ? 'Свернуть' : 'Развернуть'}">${CARET}</button>` +
      `<span class="fav-gname" data-act="fold" data-g="${key}">${esc(g ? g.name : 'Без группы')}</span>` +
      `<span class="fav-gcount">${items.length}</span>` +
      eye(g ? g.shown : favorites.noneShown, key) +
      (g ? `<button type="button" class="fav-ic" data-act="rename" data-g="${g.id}" title="Переименовать">${PENCIL}</button>` +
        `<button type="button" class="fav-ic" data-act="export" data-g="${g.id}" title="Экспорт (скопировать JSON)">${COPY}</button>` +
        `<button type="button" class="fav-ic fav-del" data-act="delgroup" data-g="${g.id}" title="Удалить группу">${TRASH}</button>` : '') +
      '</div>';
    if (!isOpen) return `<div class="fav-g">${head}</div>`;
    const rows = items.length ? items.map((f) =>
      '<div class="lm-item">' +
      `<button type="button" class="lm-row" data-id="${esc(f.id)}"><span class="lm-name">${esc(favLabel(f))}</span></button>` +
      (g ? `<button type="button" class="lm-del" data-act="out" data-g="${g.id}" data-id="${esc(f.id)}" title="Убрать из группы">${OUT}</button>`
        : `<button type="button" class="lm-del" data-act="del" data-id="${esc(f.id)}" title="Убрать из избранного">${TRASH}</button>`) +
      '</div>').join('')
      : '<div class="fav-empty">Пусто: добавьте порталы через ▾ у звёздочки в карточке.</div>';
    return `<div class="fav-g">${head}<div class="fav-items">${rows}</div></div>`;
  }

  // the eye: whether this section's portals take part in the highlight
  const eye = (on, key) =>
    `<button type="button" class="fav-ic${on ? ' on' : ' off'}" data-act="show" data-g="${key}" ` +
    `title="${on ? 'Подсвечивается (Подсветка → Избранное) — выключить' : 'Не подсвечивается — включить'}">${on ? EYE : EYE_OFF}</button>`;

  modal.list.addEventListener('input', (e) => {
    if (e.target.closest('.fav-search')) { query = e.target.value; renderList(); }
  });

  modal.list.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (a) {
      const gid = a.dataset.g, g = favorites.group(gid);
      switch (a.dataset.act) {
        case 'new': {
          const name = await promptBox('Название группы:', '', 'Создать');
          if (name && name.trim()) favorites.addGroup(name);
          return;
        }
        case 'import': await importJson(); return;
        case 'fold':
          if (gid === NONE) { noneOpen = !noneOpen; renderList(); } else if (g) favorites.updateGroup(gid, { open: !g.open });
          return;
        case 'show':
          if (gid === NONE) favorites.setNoneShown(!favorites.noneShown);
          else if (g) favorites.updateGroup(gid, { shown: !g.shown });
          return;
        case 'rename': {
          if (!g) return;
          const name = await promptBox('Название группы:', g.name, 'Сохранить');
          if (name && name.trim()) favorites.updateGroup(gid, { name: name.trim() });
          return;
        }
        case 'export': if (g) copyJson(favorites.exportGroups([gid])); return;
        case 'delgroup':
          if (g && await confirmBox(`Удалить группу «${g.name}»? Порталы останутся в избранном.`, 'Удалить')) favorites.removeGroup(gid);
          return;
        case 'out': favorites.setInGroup({ id: a.dataset.id }, gid, false); return;
        case 'del': {
          const f = favorites.get(a.dataset.id);
          if (f && await confirmBox(`Убрать «${favLabel(f)}» из избранного?`, 'Убрать')) favorites.remove(f.id);
          return;
        }
        default: return;
      }
    }
    const row = e.target.closest('.lm-row');
    if (row) openFav(row);
  });

  function copyJson(data) {
    const txt = JSON.stringify(data);
    const fallback = () => promptBox('Скопируйте:', txt, 'OK');
    if (!navigator.clipboard) { fallback(); return; }
    navigator.clipboard.writeText(txt)
      .then(() => alertBox('Группа скопирована как JSON: отправьте её, вставить можно через «импорт».'), fallback);
  }

  async function importJson() {
    const raw = await promptBox('Вставьте JSON группы избранного NITC или экспорт закладок IITC:', '', 'Импорт');
    if (!raw) return;
    let data;
    try { data = JSON.parse(raw); } catch { alertBox('Некорректный JSON'); return; }
    try {
      const r = favorites.importGroups(data);
      alertBox(`Готово: новых групп ${r.groups}, добавлено порталов ${r.portals}.`);
    } catch { alertBox('Это не избранное NITC и не закладки IITC.'); }
  }

  let busy = false;
  async function openFav(row) {
    if (busy) return;
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
        modal.close();
        if (Number.isFinite(f.lat) && Number.isFinite(f.lng)) engine.map.setView([f.lat, f.lng], OPEN_ZOOM);
        await alertBox(`Портал «${favLabel(f)}» не найден на сервере. Карта показывает место, где он был сохранён; ` +
          'если это ошибка в данных, уберите его из избранного.');
      } else {
        await alertBox('Не удалось загрузить портал: ' + (err?.code || err?.message || err));
      }
    } finally {
      busy = false; row.classList.remove('loading');
    }
  }
}
