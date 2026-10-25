// Shared inline SVG icons (stroke = currentColor, so CSS colours them).
const svg = (size, body, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra}>${body}</svg>`;

// outline star; the card fills it via CSS when the portal is starred
export const STAR = (size) =>
  svg(size, '<polygon points="12 2 15.1 8.6 22 9.6 17 14.5 18.2 21.5 12 18.2 5.8 21.5 7 14.5 2 9.6 8.9 8.6"/>');
export const TRASH = svg(15, '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>');
export const PENCIL = svg(15, '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>');
