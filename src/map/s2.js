// S2 cell of a point, as a canonical token: what the territorial rating takes
// for a region (level 4) or a cell (level 6); and the region's name, to show
// before the server answers. Only the forward mapping lat/lng → cell; borders
// are not drawn.
//
// The sphere is a cube of six faces; a point goes to the face its direction
// hits, then to face coordinates (u,v) → (s,t) by the quadratic transform,
// then to the integer grid (i,j) of 2^30 steps, and the cell id walks a
// Hilbert curve over that grid two bits per level.
const MAX_LEVEL = 30;
const GRID = 2 ** MAX_LEVEL;
// position on the curve of each (i,j) quadrant, per orientation, and how the
// orientation turns after a position (swap = 1, invert = 2)
const IJ_TO_POS = [[0, 1, 3, 2], [0, 3, 1, 2], [2, 3, 1, 0], [2, 1, 3, 0]];
const POS_TO_ORIENT = [1, 0, 0, 3];

function faceUV(x, y, z) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let face = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  if ((face === 0 ? x : face === 1 ? y : z) < 0) face += 3;
  switch (face) {
    case 0: return [face, y / x, z / x];
    case 1: return [face, -x / y, z / y];
    case 2: return [face, -x / z, -y / z];
    case 3: return [face, z / x, y / x];
    case 4: return [face, z / y, -x / y];
    default: return [face, -y / z, -x / z];
  }
}
const uvToST = (u) => (u >= 0 ? 0.5 * Math.sqrt(1 + 3 * u) : 1 - 0.5 * Math.sqrt(1 - 3 * u));
const stToIJ = (s) => Math.max(0, Math.min(GRID - 1, Math.floor(s * GRID)));

function faceIJ(lat, lng) {
  const la = (lat * Math.PI) / 180, ln = (lng * Math.PI) / 180;
  const [face, u, v] = faceUV(Math.cos(la) * Math.cos(ln), Math.cos(la) * Math.sin(ln), Math.sin(la));
  return { face, i: stToIJ(uvToST(u)), j: stToIJ(uvToST(v)) };
}

// The cell's token: the 64-bit id in hex, trailing zeros dropped.
export function s2Token(lat, lng, level) {
  const { face, i, j } = faceIJ(lat, lng);
  let orient = face & 1, pos = 0n;
  for (let k = MAX_LEVEL - 1; k >= MAX_LEVEL - level; k--) {
    const p = IJ_TO_POS[orient][(((i / 2 ** k) & 1) << 1) | ((j / 2 ** k) & 1)];
    pos = (pos << 2n) | BigInt(p);
    orient ^= POS_TO_ORIENT[p];
  }
  const shift = BigInt(2 * (MAX_LEVEL - level));
  const id = (BigInt(face) << 61n) | (pos << (shift + 1n)) | (1n << shift);
  return id.toString(16).padStart(16, '0').replace(/0+$/, '');
}

// A region's (level 4) name, as in the game: the face, the column 01–16 and
// a code word for the row, e.g. NR04-ECHO. On odd faces the axes are swapped.
const FACES = ['AF', 'AS', 'NR', 'PA', 'AM', 'ST'];
const WORDS = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL',
  'JULIET', 'KILO', 'LIMA', 'MIKE', 'NOVEMBER', 'PAPA', 'ROMEO', 'SIERRA'];
export function regionName(lat, lng) {
  const { face, i, j } = faceIJ(lat, lng);
  const [a, b] = face & 1 ? [j, i] : [i, j];
  const col = Math.floor(a / 2 ** (MAX_LEVEL - 4)), row = Math.floor(b / 2 ** (MAX_LEVEL - 4));
  return `${FACES[face]}${String(col + 1).padStart(2, '0')}-${WORDS[row]}`;
}
