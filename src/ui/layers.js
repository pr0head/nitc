// The layers toolbar item, a two-column panel (stacked on narrow screens):
//   left  — base map + portal/field highlight
//   right — overlay filters: a portal level range (unclaimed = level 0) and a
//           type × faction matrix; applied live against loaded data via
//           engine.setFilter, no refetch
import { FACTION } from '../config.js';
import { ARC_OPTS, TEXT_OPTS, TOP_COLOR, BOT_COLOR } from '../map/highlight.js';
import { addToolbarButton } from './toolbar.js';

const LAYERS_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>';

const LEVEL_OPTS = [['0', 'Нейтр.'], ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [String(n), String(n)])];
const MATRIX_ROWS = [['portals', 'Порталы'], ['links', 'Линки'], ['fields', 'Поля']];
const MATRIX_COLS = [['res', 'RES'], ['enl', 'ENL']];

export function mountLayers(container, engine) {
  const f = engine.prefs.filters;
  const { panel } = addToolbarButton(container, { icon: LAYERS_ICON, title: 'Слои и фильтры' });
  panel.classList.add('tb-layers');

  // column 1: base map, then the highlight overlay
  const col1 = col();
  const bases = Object.entries(engine.baseMaps).map(([id, b]) => [id, b.label]);
  select(col1, 'Подложка', bases, () => engine.prefs.baseMap, (id) => engine.setBaseMap(id));
  const h = engine.prefs.highlight;
  sep(col1); head(col1, 'Подсветка');
  select(col1, 'Верх', ARC_OPTS, () => h.top, (v) => engine.setHighlight({ top: v }), TOP_COLOR);
  select(col1, 'Низ', ARC_OPTS, () => h.bottom, (v) => engine.setHighlight({ bottom: v }), BOT_COLOR);
  select(col1, 'Текст', TEXT_OPTS, () => h.text, (v) => engine.setHighlight({ text: v }));
  chips(col1, 'Поля', [
    ['Площадь', () => h.fieldArea, (v) => engine.setHighlight({ fieldArea: v })],
    ['MU', () => h.fieldMu, (v) => engine.setHighlight({ fieldMu: v })],
  ]);

  // column 2: filters
  const col2 = col();
  head(col2, 'Фильтры');
  levelRange(col2);
  matrix(col2);

  panel.append(col1, col2);

  // "from – to": moving one end past the other drags the other along
  function levelRange(parent) {
    const row = document.createElement('div'); row.className = 'tb-sel';
    const lab = document.createElement('span'); lab.className = 'tb-sel-l'; lab.textContent = 'Уровни';
    const box = document.createElement('span'); box.className = 'tb-range';
    const lo = levelSelect('от'), hi = levelSelect('до');
    const sync = () => { lo.value = String(f.minLevel); hi.value = String(f.maxLevel); };
    lo.addEventListener('change', () => {
      const v = +lo.value; engine.setFilter({ minLevel: v, maxLevel: Math.max(v, f.maxLevel) }); sync();
    });
    hi.addEventListener('change', () => {
      const v = +hi.value; engine.setFilter({ maxLevel: v, minLevel: Math.min(v, f.minLevel) }); sync();
    });
    sync();
    box.append(lo, document.createTextNode('–'), hi);
    row.append(lab, box); parent.append(row);
  }
  function levelSelect(title) {
    const sel = document.createElement('select'); sel.title = title; sel.setAttribute('aria-label', 'Уровень ' + title);
    for (const [v, t] of LEVEL_OPTS) {
      const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o);
    }
    return sel;
  }

  // type × faction: a cell toggles one pair; a column/row heading turns its
  // whole line on, or off when it is all on already
  function matrix(parent) {
    const grid = document.createElement('div'); grid.className = 'tb-mx';
    const boxes = []; // [row, fac, input]
    const paint = () => { for (const [r, fac, inp] of boxes) inp.checked = !!f.show[r][fac]; };
    const toggle = (cells) => {
      const on = !cells.every(([r, fac]) => f.show[r][fac]);
      for (const [r, fac] of cells) f.show[r][fac] = on;
      engine.setFilter({}); paint();
    };
    grid.append(document.createElement('span'));
    for (const [fac, name] of MATRIX_COLS) {
      const b = mxBtn(name, 'Все объекты ' + FACTION[fac].name, () => toggle(MATRIX_ROWS.map(([r]) => [r, fac])));
      b.style.color = FACTION[fac].color;
      grid.append(b);
    }
    for (const [r, label] of MATRIX_ROWS) {
      grid.append(mxBtn(label, label + ': обе фракции', () => toggle(MATRIX_COLS.map(([fac]) => [r, fac])), 'tb-mx-row'));
      for (const [fac] of MATRIX_COLS) {
        const cell = document.createElement('label'); cell.className = 'tb-mx-cell';
        const inp = document.createElement('input'); inp.type = 'checkbox';
        inp.setAttribute('aria-label', label + ' ' + FACTION[fac].name);
        inp.addEventListener('change', () => { f.show[r][fac] = inp.checked; engine.setFilter({}); });
        boxes.push([r, fac, inp]);
        cell.append(inp); grid.append(cell);
      }
    }
    paint();
    parent.append(grid);
  }
  function mxBtn(text, title, on, cls = '') {
    const b = document.createElement('button'); b.type = 'button';
    b.className = ('tb-mx-h ' + cls).trim(); b.textContent = text; b.title = title;
    b.addEventListener('click', on);
    return b;
  }

  // ---- DOM helpers ----
  function col() {
    const c = document.createElement('div'); c.className = 'tb-col'; return c;
  }
  function head(parent, title) {
    const h = document.createElement('div'); h.className = 'tb-col-h'; h.textContent = title;
    parent.append(h);
  }
  function sep(parent) { const d = document.createElement('div'); d.className = 'tb-sep'; parent.append(d); }
  // label + toggle chips in one row; `items` are [text, get, set]
  function chips(parent, label, items) {
    const row = document.createElement('div'); row.className = 'tb-sel';
    const lab = document.createElement('span'); lab.className = 'tb-sel-l'; lab.textContent = label;
    const box = document.createElement('span'); box.className = 'tb-chips';
    for (const [text, get, set] of items) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tb-chip'; b.textContent = text;
      const paint = () => b.setAttribute('aria-pressed', String(!!get()));
      b.addEventListener('click', () => { set(!get()); paint(); });
      paint(); box.append(b);
    }
    row.append(lab, box); parent.append(row);
  }
  // label + <select>; `opts` are [value,text] pairs; current value via get().
  function select(parent, label, opts, get, set, swatch) {
    const row = document.createElement('label'); row.className = 'tb-sel';
    const lab = document.createElement('span'); lab.className = 'tb-sel-l';
    if (swatch) { const s = document.createElement('span'); s.className = 'tb-sw'; s.style.marginRight = '5px'; s.style.background = swatch; lab.append(s); }
    lab.append(document.createTextNode(label));
    const sel = document.createElement('select');
    const cur = get();
    for (const [v, t] of opts) {
      const o = document.createElement('option'); o.value = v; o.textContent = t;
      if (v === cur) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener('change', () => set(sel.value));
    row.append(lab, sel); parent.append(row);
  }
}
