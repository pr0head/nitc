// How a COMM event reads — shared by the COMM feed and the portal card's
// history, so both name the same action the same way.

// event kind → feed group (the COMM type filter)
export const GROUP = {
  capture: 'capture', neutralize: 'capture',
  link_create: 'link', link_destroy: 'link', first_link: 'link',
  field_create: 'field', field_destroy: 'field',
};
// neutral noun forms: a nickname tells nothing about the agent's gender
export const KIND_LABEL = {
  capture: 'захват', neutralize: 'нейтрализация',
  link_create: 'линк', link_destroy: 'снос линка', first_link: 'первый линк',
  field_create: 'поле', field_destroy: 'снос поля',
};
// the client adds the sign: `mu` itself is never a negative delta
export const MU_SIGN = { field_create: '+', field_destroy: '−' };

const pad = (n) => String(n).padStart(2, '0');
// "13:05" today, "26.10 13:05" before
export function fmtTime(ms) {
  const d = new Date(ms), now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === now.toDateString() ? hm : `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${hm}`;
}
