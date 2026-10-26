// The Back button (Android's, and the browser's) closes the topmost open layer
// — a dialog, modal, the portal card, an open panel or mode — instead of
// leaving the app. A layer, when it opens, puts an entry into the history;
// Back takes it out and closes the layer; closing the layer any other way
// (its ×, Escape, a tap outside) takes its entry out too.
//   backOpen(close)   — the layer opened; close() closes it (and must call
//                       backClosed itself — a no-op by then)
//   backClosed(close) — the layer closed by other means
const stack = []; // close functions, the newest last
let skip = 0;     // our own history.back() calls: their popstate is not a Back
let owed = 0;     // entries for layers opened while such a call is in flight

const push = () => history.pushState({ nitc: true }, '');

export function backOpen(close) {
  if (stack.includes(close)) return;
  stack.push(close);
  // pushing now would race the pending back() and lose the new entry
  if (skip) owed++; else push();
}

export function backClosed(close) {
  const i = stack.lastIndexOf(close);
  if (i < 0) return;
  stack.splice(i, 1);
  if (owed) { owed--; return; } // its entry was never pushed
  skip++;
  history.back();
}

addEventListener('popstate', () => {
  if (skip) {
    if (--skip === 0) for (; owed; owed--) push();
    return;
  }
  stack.pop()?.();
});
