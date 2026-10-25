// Highlight rules (IITC/SBG-style). Each rule is a predicate over an adapted
// portal from the bulk /map response — no per-portal fetch. Only data the map
// endpoint already carries is usable here: level, resonator_count, current/max
// XM — plus the local favorites list.
import { favorites } from '../state/favorites.js';

export const TOP_COLOR = '#b061ff'; // purple, like the SBG top arc
export const BOT_COLOR = '#ff9f40'; // orange, like the SBG bottom arc

// Per-resonator energy is not in bulk, so "weak" is judged on the portal's
// total XM instead: at/below this fraction of max.
const WEAK_XM = 0.25;

// [key, label] pairs for the UI selects. Labels are Russian (app language).
export const ARC_OPTS = [
  ['none', 'Нет'],
  ['freeslots', 'Свободные слоты'],
  ['weak', 'Слабый портал'],
  ['favorite', 'Избранное'],
];
export const TEXT_OPTS = [
  ['none', 'Нет'],
  ['level', 'Уровень'],
];

const claimed = (p) => p.faction !== 'neu';

function arcFn(kind) {
  switch (kind) {
    case 'freeslots': return (p) => claimed(p) && p.resoCount < 8;
    case 'weak': return (p) => p.xm.max > 0 && p.xm.cur / p.xm.max <= WEAK_XM;
    case 'favorite': return (p) => favorites.has(p.id);
    default: return null;
  }
}

function textFn(kind) {
  switch (kind) {
    // unclaimed portals stay blank: a "0" on every neutral dot is noise
    case 'level': return (p) => (claimed(p) ? String(p.level) : '');
    default: return null;
  }
}

// Highlight config → style(portal) → { top, bot, text }, or null when every
// rule is off (portals then render as plain dots, no overlay work at all).
export function styleFn(h) {
  const tf = arcFn(h.top), bf = arcFn(h.bottom), tx = textFn(h.text);
  if (!tf && !bf && !tx) return null;
  return (p) => ({
    top: tf && tf(p) ? TOP_COLOR : null,
    bot: bf && bf(p) ? BOT_COLOR : null,
    text: tx ? tx(p) : '',
  });
}
