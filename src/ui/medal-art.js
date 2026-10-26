// Medal pictures: the classic (pre-Prime) Ingress medals, one vector per medal
// id, recoloured for the tier on the fly. The art is a bronze set where three
// roles are marked up: m-bg (the hexagon), m-fr (its frame), m-mt (the metal
// of the symbol); accents (cyan, pink…) are the same on every tier.
// Source and licence: ./medals/LICENSE.md.
const ART = Object.fromEntries(Object.entries(
  import.meta.glob('./medals/*.svg', { query: '?raw', import: 'default', eager: true }),
).map(([path, svg]) => [path.slice('./medals/'.length, -'.svg'.length), svg]));

// sampled from the original medals; bg [top, bottom] — platinum and onyx are
// "glass", lighter above; metal runs top → bottom
const TIER = [
  null,
  { bg: ['#49200b', '#49200b'], frame: '#db9775', metal: ['#d5986e', '#e8b491'] }, // bronze
  { bg: ['#394142', '#394142'], frame: '#a3bbc1', metal: ['#a5d2d7', '#c1f6fa'] }, // silver
  { bg: ['#6d4d28', '#6d4d28'], frame: '#f8d188', metal: ['#fad999', '#fee9c0'] }, // gold
  { bg: ['#5e5e5e', '#282828'], frame: '#efefef', metal: ['#cbcbcb', '#f8f8f8'] }, // platinum
  { bg: ['#262626', '#000000'], frame: '#3a3b3c', metal: ['#3e3b3b', '#7d7b78'] }, // onyx
];

let seq = 0; // gradient ids are page-wide

// a medal with no picture yet: the bare hexagon with the title's first letter
const BLANK = (letter) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 169 195" fill-rule="evenodd">\n' +
  '<polygon class="m-bg" points="84,5 164,51 164,143 84,189 5,143 5,51"/>' +
  '<path class="m-fr" d="M84 0l85 49 0 97 -85 49 -84 -49 0 -97 84 -49zm0 5l80 46 0 92 -80 46 -79 -46 0 -92 79 -46z"/>' +
  `<text class="m-mt" x="84" y="122" text-anchor="middle" font-size="90" font-weight="700" font-family="sans-serif">${letter}</text>\n</svg>`;
const LETTER = /^[\p{L}\p{N}]$/u;

// An <svg> of the medal at the tier (0 = not earned: the bronze art, greyed
// by CSS).
export function medalSvg(id, tier, title = '') {
  const first = [...String(title).trim()][0] || '';
  const art = ART[id] || BLANK(LETTER.test(first) ? first.toUpperCase() : '?');
  const t = TIER[tier] || TIER[1];
  const h = art.match(/viewBox="[\d.]+ [\d.]+ [\d.]+ ([\d.]+)"/)[1];
  const g = 'md' + ++seq;
  const grad = (id, [a, b], split) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${h}">` +
    (split ? `<stop offset="0" stop-color="${a}"/><stop offset=".45" stop-color="${a}"/><stop offset=".45" stop-color="${b}"/>`
      : `<stop offset="0" stop-color="${a}"/>`) + `<stop offset="1" stop-color="${b}"/></linearGradient>`;
  const defs = `<defs>${grad(g + 'b', t.bg, true)}${grad(g + 'm', t.metal)}</defs>`;
  return art
    .replace('<svg ', '<svg class="md-art" aria-hidden="true" ')
    .replace(/>\n/, '>' + defs + '\n')
    .replaceAll('class="m-bg"', `fill="url(#${g}b)"`)
    .replaceAll('class="m-fr"', `fill="${t.frame}"`)
    .replaceAll('class="m-mt"', `fill="url(#${g}m)"`)
    .replaceAll('stroke="#2b2a29"', `stroke="${t.bg[1]}"`);
}
