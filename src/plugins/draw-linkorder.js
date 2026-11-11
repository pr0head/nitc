// Link order: the steps the link plan (draw-linkplan.js) is built in. A step
// is one portal and every link thrown from it — an agent comes, throws them
// all, moves on. The rule that orders them: no link goes out from under a
// field, so a portal has to have its step before any plan field over it is
// closed (a field closes with the last of its three links).
//
// The second rule: a link makes at most one field on each side. A link that
// would close several plan fields on one side makes only the largest; the
// rest are lost, so an order should close the nested fields one by one (a
// matryoshka: the base first, then the points from the inside out).
//
// The automatic order walks the portals: next is one not under a closed
// field, whose links close no field over a portal still to come and lose no
// field; of those, the one whose links are in the most fields still open
// (the base before the points), then the nearest to the last step (the first
// step: the one under the most plan fields, the innermost). Where no portal
// fits, the best of the rest goes anyway and the check below flags it.
//
// An order can be set by hand: shape.nitc.step[i] is the step number of side
// i's link (null: not placed). Steps go by number; links without one join
// their portal's step, or are walked in after the numbered ones. Whatever the
// order, it is checked: a step whose portal is under a field closed earlier
// is marked, with the step that closed it.
//
// Only the plan's own fields count: a portal under a field already on the map
// is a crossing matter (the sky tab) — the links out of it cross its edges.
import { distanceM } from '../map/geo.js';

const rad = (d) => (d * Math.PI) / 180;
const vec = (p) => {
  const a = rad(p.lat), l = rad(p.lng);
  return [Math.cos(a) * Math.cos(l), Math.cos(a) * Math.sin(l), Math.sin(a)];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// p strictly inside the spherical triangle t (its vertices and edges are not)
function inside(t, p) {
  if (t.includes(p)) return false;
  const [A, B, C] = t.map(vec), P = vec(p);
  const s1 = dot(cross(A, B), P), s2 = dot(cross(B, C), P), s3 = dot(cross(C, A), P);
  const eps = 1e-12;
  return (s1 > eps && s2 > eps && s3 > eps) || (s1 < -eps && s2 < -eps && s3 < -eps);
}
const far = (a, b) => distanceM([a.lat, a.lng], [b.lat, b.lng]);
// a field's size for "the largest one wins" (planar, enough to compare)
const area = (f) => {
  const [a, b, c] = f.ps;
  return Math.abs((b.lng - a.lng) * (c.lat - a.lat) - (c.lng - a.lng) * (b.lat - a.lat));
};
// which side of link e the field's third corner is on
const sideOf = (e, f) => {
  const c = f.ps.find((p) => p !== e.from && p !== e.to);
  return Math.sign(dot(cross(vec(e.from), vec(e.to)), vec(c)));
};
// throw links in turn over the done set (changed): → {made, lost} fields
function throwLinks(links, done, fields) {
  const made = [], lost = [];
  for (const e of links) {
    done.add(e.id);
    const fresh = fields.filter((f) => f.edges.includes(e.id) && !made.includes(f) && !lost.includes(f) &&
      f.edges.every((id) => done.has(id)) && !f.gone);
    for (const sd of [1, -1]) {
      const on = fresh.filter((f) => sideOf(e, f) === sd).sort((x, y) => area(y) - area(x));
      if (on.length) { made.push(on[0]); lost.push(...on.slice(1)); }
    }
  }
  return { made, lost };
}

// r: the plan from linkPlan (links with from/to/step, fields with ps/edges) →
// { steps: [{n, portal, links, fields, dist, bad}], manual }
export function orderSteps(r) {
  const fields = r.fieldList;
  for (const f of fields) f.over = r.portals.filter((p) => inside(f.ps, p));
  const under = new Map(r.portals.map((p) => [p, fields.filter((f) => f.over.includes(p))]));

  // the numbered links as steps (by number, then portal), the rest by portal
  const manual = r.links.some((e) => e.step != null);
  const steps = [];
  const byNum = new Map();
  for (const e of r.links.filter((x) => x.step != null).sort((x, y) => x.step - y.step)) {
    const k = e.step + '|' + e.from.key;
    if (!byNum.has(k)) { byNum.set(k, { portal: e.from, links: [] }); steps.push(byNum.get(k)); }
    byNum.get(k).links.push(e);
  }
  const loose = new Map();
  for (const e of r.links.filter((x) => x.step == null)) {
    const s = steps.find((x) => x.portal === e.from);
    if (s) { s.links.push(e); continue; }
    if (!loose.has(e.from)) loose.set(e.from, { portal: e.from, links: [] });
    loose.get(e.from).links.push(e);
  }

  // the walk over what is left, from the state the numbered steps leave
  const done = new Set(steps.flatMap((s) => s.links.map((e) => e.id)));
  const closed = (f) => f.edges.every((id) => done.has(id));
  const open = (e) => fields.filter((f) => f.edges.includes(e.id) && !closed(f)).length;
  let rest = [...loose.values()];
  let last = steps.at(-1)?.portal || null;
  while (rest.length) {
    const left = new Set(rest.map((s) => s.portal));
    const free = rest.filter((s) => !under.get(s.portal).some(closed));
    const safe = free.filter((s) => {
      const ids = new Set(s.links.map((e) => e.id));
      // a field these links close, over a portal still to come
      return !fields.some((f) => !closed(f) && f.edges.every((id) => done.has(id) || ids.has(id)) &&
        f.over.some((p) => left.has(p) && p !== s.portal));
    });
    // fields this step would lose
    const loses = (s) => throwLinks(s.links, new Set(done), fields).lost.length;
    const whole = safe.filter((s) => !loses(s));
    const pool = whole.length ? whole : safe.length ? safe : free.length ? free : rest;
    const score = (s) => [
      -s.links.reduce((n, e) => n + open(e), 0),
      last ? far(last, s.portal) : -under.get(s.portal).length,
    ];
    const better = (x, y) => { const a = score(x), b = score(y); return a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1]; };
    const pick = pool.reduce((b, s) => (better(s, b) ? s : b));
    steps.push(pick);
    for (const e of pick.links) done.add(e.id);
    rest = rest.filter((s) => s !== pick);
    last = pick.portal;
  }

  // the check, and what each step makes and loses
  done.clear();
  const at = new Map(); // field → the step that made it
  const lostAll = [];
  steps.forEach((s, i) => {
    s.n = i + 1;
    s.links.sort((x, y) => y.len - x.len);
    s.dist = i ? far(steps[i - 1].portal, s.portal) : 0;
    const f = under.get(s.portal).find((x) => at.has(x));
    s.bad = f ? { by: at.get(f) } : null;
    const { made, lost } = throwLinks(s.links, done, fields);
    for (const x of lost) x.gone = true;
    s.fields = made; s.lost = lost;
    lostAll.push(...lost);
    for (const x of made) at.set(x, s.n);
  });
  for (const f of fields) delete f.gone;
  return { steps, manual, lost: lostAll.length };
}
