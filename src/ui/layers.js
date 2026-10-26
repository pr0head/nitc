// The layers toolbar item, a two-column panel:
//   left  — base map (radio, applied at once) + portal/field highlight
//   right — overlay filters (checkboxes, applied live against loaded data via
//           engine.setFilter, no refetch)
import { FACTION } from '../config.js';
import { ARC_OPTS, TEXT_OPTS, TOP_COLOR, BOT_COLOR } from '../map/highlight.js';
import { addToolbarButton } from './toolbar.js';

const LAYERS_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>';

export function mountLayers(container, engine) {
  const f = engine.prefs.filters;
  const { panel } = addToolbarButton(container, { icon: LAYERS_ICON, title: 'Слои и фильтры' });
  panel.classList.add('tb-layers');

  // column 1: base map (radio)
  const col1 = col('Подложка');
  for (const [id, b] of Object.entries(engine.baseMaps)) {
    radio(col1, 'base', b.label, engine.prefs.baseMap === id, () => engine.setBaseMap(id));
  }

  // column 2: overlay filters (checkboxes)
  const col2 = col('Фильтры');
  check(col2, 'Нейтральные', () => f.neutral, (v) => engine.setFilter({ neutral: v }));
  for (let n = 1; n <= 8; n++) {
    check(col2, 'Уровень ' + n, () => f.levels[n], (v) => { f.levels[n] = v; engine.setFilter({}); });
  }
  sep(col2);
  check(col2, 'Поля', () => f.fields, (v) => engine.setFilter({ fields: v }));
  check(col2, 'Линки', () => f.links, (v) => engine.setFilter({ links: v }));
  sep(col2);
  check(col2, FACTION.res.name, () => f.res, (v) => engine.setFilter({ res: v }), FACTION.res.color);
  check(col2, FACTION.enl.name, () => f.enl, (v) => engine.setFilter({ enl: v }), FACTION.enl.color);
  sep(col2);
  check(col2, 'Только с ключами', () => f.keysOnly, (v) => engine.setFilter({ keysOnly: v }));

  // column 1, below the base maps: highlight overlay
  const h = engine.prefs.highlight;
  sep(col1); head(col1, 'Подсветка порталов');
  select(col1, 'Верх', ARC_OPTS, () => h.top, (v) => engine.setHighlight({ top: v }), TOP_COLOR);
  select(col1, 'Низ', ARC_OPTS, () => h.bottom, (v) => engine.setHighlight({ bottom: v }), BOT_COLOR);
  select(col1, 'Текст', TEXT_OPTS, () => h.text, (v) => engine.setHighlight({ text: v }));
  sep(col1); head(col1, 'Подсветка полей');
  check(col1, 'Площадь', () => h.fieldArea, (v) => engine.setHighlight({ fieldArea: v }));
  check(col1, 'MU', () => h.fieldMu, (v) => engine.setHighlight({ fieldMu: v }));

  panel.append(col1, col2);

  // ---- DOM helpers ----
  function col(title) {
    const c = document.createElement('div'); c.className = 'tb-col';
    head(c, title); return c;
  }
  function head(parent, title) {
    const h = document.createElement('div'); h.className = 'tb-col-h'; h.textContent = title;
    parent.append(h);
  }
  function sep(parent) { const d = document.createElement('div'); d.className = 'tb-sep'; parent.append(d); }
  function radio(parent, name, label, checked, on) {
    const row = document.createElement('label'); row.className = 'tb-row';
    const inp = document.createElement('input'); inp.type = 'radio'; inp.name = 'tb-' + name; inp.checked = checked;
    inp.addEventListener('change', on);
    row.append(inp, document.createTextNode(label)); parent.append(row);
  }
  function check(parent, label, get, set, swatch) {
    const row = document.createElement('label'); row.className = 'tb-row';
    const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!get();
    inp.addEventListener('change', () => set(inp.checked));
    row.append(inp);
    if (swatch) { const s = document.createElement('span'); s.className = 'tb-sw'; s.style.background = swatch; row.append(s); }
    row.append(document.createTextNode(label)); parent.append(row);
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
