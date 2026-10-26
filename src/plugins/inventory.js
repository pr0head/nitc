// Inventory: menu item → modal with two tabs.
//   Предметы — own items by kind and level (/v1/intel/me/inventory), capsule
//              contents included; read on open, kept for a minute (no-store).
//              Keys are left out here: they have their own tab.
//   Ключи    — the own key set (state/keys.js) with a name search, sorted by
//              name or by distance from the map centre (pressing the active
//              sort again flips its direction); a click flies to the portal
//              and opens its card
// "Обновить" re-reads both. Personal data: memory only.
import './inventory.css';
import { getInventory } from '../api/intel.js';
import { keys } from '../state/keys.js';
import { bus } from '../state/bus.js';
import { createListModal } from '../ui/dialog.js';
import { esc } from '../ui/esc.js';

const TTL_MS = 60000;
const OPEN_ZOOM = 15;
const ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>';
// Display names; an unknown kind shows as the server wrote it.
const KIND = {
  xmp: 'XMP Burster',
  ultra_strike: 'Ultra Strike',
  resonator: 'Резонатор',
  cube: 'Power Cube',
  lawson: 'Lawson Power Cube',
  capsule: 'Капсула',
  mufg: 'MUFG-капсула',
  quantum: 'Квантовая капсула',
  ada: 'ADA Refactor',
  jarvis: 'JARVIS Virus',
  fracker: 'Portal Fracker',
  beacon: 'Маяк',
};
const TABS = [['items', 'Предметы'], ['keys', 'Ключи']];

const n = (v) => v.toLocaleString('ru-RU');
const kindName = (k) => KIND[k] || k.replace(/_/g, ' ');
const SORTS = [['name', 'по названию'], ['dist', 'по расстоянию']];
const fmtDist = (m) => (m >= 1000 ? `${n(+(m / 1000).toFixed(m >= 100000 ? 0 : 1))} км` : `${Math.round(m)} м`);

export function mountInventory(menu, engine) {
  const modal = createListModal('Инвентарь', 'inv-box');
  menu.add({ icon: ICON, label: 'Инвентарь', onClick: open });

  let tab = 'items';
  let query = '', sort = 'name', desc = false; // keys tab, kept while the page is open
  let inv = null, invAt = 0, invErr = '', loading = false;

  function open() {
    modal.open();
    paint();
    if (!inv || Date.now() - invAt > TTL_MS) loadItems();
  }
  bus.on('keysChanged', () => { if (modal.isOpen) paint(); });

  async function loadItems() {
    loading = true; invErr = ''; paint();
    try {
      inv = (await getInventory())?.items || [];
      invAt = Date.now();
    } catch (e) {
      invErr = e?.code === 'rate_limited' ? 'слишком много запросов, попробуйте позже' : 'не удалось загрузить: ' + (e?.code || e);
    } finally {
      loading = false;
      if (modal.isOpen) paint();
    }
  }

  // items without the key row (keys have their own tab)
  const itemRows = () => (inv || []).filter((it) => it.kind !== 'key');
  const sum = (rows, f) => rows.reduce((s, r) => s + (Number(f(r)) || 0), 0);

  function paint() {
    const parts = [];
    // tab titles carry the totals, so nothing has to be added up by eye
    const count = {
      items: inv ? sum(itemRows(), (r) => r.quantity) : null,
      keys: keys.state === 'ready' || keys.size ? sum(keys.list(), (k) => k.qty) : null,
    };
    parts.push('<div class="inv-top"><div class="seg">' + TABS.map(([k, t]) =>
      `<button type="button" data-tab="${k}"${k === tab ? ' class="on"' : ''}>${t}` +
      `${count[k] != null ? ` · ${n(count[k])}` : ''}</button>`).join('') + '</div>' +
      '<button type="button" class="inv-refresh" title="Обновить">обновить</button></div>');
    parts.push(tab === 'items' ? itemsHtml() : keysHtml());
    modal.list.innerHTML = parts.join('');
  }

  // one row per kind; levelled kinds list their levels (L1 97 · L2 23)
  function itemsHtml() {
    if (!inv) return `<div class="lm-empty">${loading ? 'загрузка…' : esc(invErr || 'нет данных')}</div>`;
    const rows = itemRows();
    if (!rows.length) return '<div class="lm-empty">Предметов нет.</div>';
    const byKind = new Map();
    for (const it of rows) {
      if (!byKind.has(it.kind)) byKind.set(it.kind, []);
      byKind.get(it.kind).push({ level: it.level | 0, qty: Number(it.quantity) || 0 });
    }
    return (invErr ? `<div class="lm-empty">${esc(invErr)}</div>` : '') +
      [...byKind].map(([kind, rows]) => {
        const sum = rows.reduce((s, r) => s + r.qty, 0);
        const lv = rows.some((r) => r.level > 0)
          ? rows.map((r) => `<span class="inv-lv"><b>L${r.level}</b> ${n(r.qty)}</span>`).join('') : '';
        return `<div class="inv-row"><span class="inv-k">${esc(kindName(kind))}</span>` +
          `<span class="inv-lvs">${lv}</span><span class="inv-q">${n(sum)}</span></div>`;
      }).join('');
  }

  // search + sort controls stay put; typing re-renders only the list below
  function keysHtml() {
    if (keys.state === 'loading') return '<div class="lm-empty">загрузка…</div>';
    if (keys.state === 'error') return '<div class="lm-empty">Не удалось загрузить ключи.</div>';
    if (!keys.size) return '<div class="lm-empty">Ключей нет.</div>';
    return '<div class="inv-kbar">' +
      `<input type="search" class="inv-search" placeholder="Поиск по названию" value="${esc(query)}">` +
      `<div class="seg inv-sort">${sortButtons()}</div></div>` +
      `<div class="inv-klist">${keyRows()}</div>`;
  }

  // the active sort shows its direction; pressing it again flips it
  const sortButtons = () => SORTS.map(([k, t]) =>
    `<button type="button" data-sort="${k}"${k === sort ? ' class="on"' : ''} title="${k === sort ? 'Сменить направление' : ''}">` +
    `${t}${k === sort ? (desc ? ' ↓' : ' ↑') : ''}</button>`).join('');

  function keyRows() {
    const q = query.trim().toLocaleLowerCase('ru');
    const c = engine.map.getCenter();
    let list = keys.list()
      .filter((k) => !q || k.name.toLocaleLowerCase('ru').includes(q))
      .map((k) => ({ k, d: Number.isFinite(k.lat) && Number.isFinite(k.lng) ? engine.map.distance(c, [k.lat, k.lng]) : Infinity }));
    if (sort === 'dist') list.sort((a, b) => a.d - b.d); // keys.list() is already by name
    if (desc) list.reverse();
    const head = `<div class="inv-sum">Порталов: ${n(list.length)}${q ? ` из ${n(keys.size)}` : ''}` +
      (sort === 'dist' ? ' · расстояние от центра карты' : '') + '</div>';
    if (!list.length) return head + '<div class="lm-empty">Ничего не найдено.</div>';
    return head + list.map(({ k, d }) => {
      const meta = [
        Number.isFinite(d) ? fmtDist(d) : '',
        k.inCaps ? `${k.free} своб. + ${k.inCaps} в капсулах` : '',
      ].filter(Boolean).join(' · ');
      return '<div class="lm-item">' +
        `<button type="button" class="lm-row" data-key="${esc(k.id)}"><span class="lm-name">${esc(k.name || 'портал')}</span>` +
        (meta ? `<span class="lm-meta">${meta}</span>` : '') +
        `</button><span class="inv-q">${n(k.qty)}</span></div>`;
    }).join('');
  }

  modal.list.addEventListener('input', (e) => {
    if (!e.target.closest('.inv-search')) return;
    query = e.target.value;
    const box = modal.list.querySelector('.inv-klist');
    if (box) box.innerHTML = keyRows();
  });

  modal.list.addEventListener('click', (e) => {
    const s = e.target.closest('.seg button[data-sort]');
    if (s) {
      if (s.dataset.sort === sort) desc = !desc;
      else { sort = s.dataset.sort; desc = false; }
      s.parentNode.innerHTML = sortButtons();
      modal.list.querySelector('.inv-klist').innerHTML = keyRows();
      return;
    }
    const t = e.target.closest('.seg button[data-tab]');
    if (t) { tab = t.dataset.tab; paint(); return; }
    if (e.target.closest('.inv-refresh')) { loadItems(); keys.reload(); return; }
    const row = e.target.closest('[data-key]');
    if (!row) return;
    const k = keys.get(row.dataset.key);
    if (!k) return;
    modal.close();
    if (Number.isFinite(k.lat) && Number.isFinite(k.lng)) {
      engine.map.setView([k.lat, k.lng], Math.max(engine.map.getZoom(), OPEN_ZOOM));
    }
    bus.emit('openPortal', { portal: { id: k.id, name: k.name, lat: k.lat, lng: k.lng } });
  });
}
