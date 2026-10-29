// In-app dialogs and list modals. Our own instead of the browser's
// confirm/prompt/alert: those block the page and look nothing like the UI.
import './dialog.css';
import { backOpen, backClosed } from './back.js';

// → Promise: the field's text (prompt), true (confirm/alert OK), null (cancel).
function openDialog({ message, okLabel = 'OK', cancel = true, cancelLabel = 'Отмена', initial = null }) {
  return new Promise((resolve) => {
    const al = document.createElement('div');
    al.className = 'dlg';
    al.innerHTML = '<div class="dlg-box"><div class="dlg-msg"></div>' +
      (initial == null ? '' : '<input type="text" class="dlg-field">') +
      '<div class="dlg-btns">' +
      (cancel ? '<button type="button" class="dlg-cancel"></button>' : '') +
      '<button type="button" class="dlg-ok"></button></div></div>';
    al.querySelector('.dlg-msg').textContent = message;
    const ok = al.querySelector('.dlg-ok');
    ok.textContent = okLabel;
    if (cancel) al.querySelector('.dlg-cancel').textContent = cancelLabel;
    const field = al.querySelector('.dlg-field');
    if (field) field.value = initial;

    const cancelIt = () => done(null);
    const done = (v) => {
      al.remove(); document.removeEventListener('keydown', onKey, true); backClosed(cancelIt); resolve(v);
    };
    const accept = () => done(field ? field.value : true);
    // capture phase: Escape closes this dialog, not the modal underneath
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      else if (e.key === 'Enter' && field) { e.stopPropagation(); accept(); }
    }
    document.addEventListener('keydown', onKey, true);
    ok.addEventListener('click', accept);
    al.querySelector('.dlg-cancel')?.addEventListener('click', () => done(null));
    al.addEventListener('click', (e) => { if (e.target === al) done(null); });
    document.body.append(al);
    backOpen(cancelIt);
    if (field) { field.focus(); field.select(); } else ok.focus();
  });
}

export const confirmBox = (message, okLabel, cancelLabel) => openDialog({ message, okLabel, cancelLabel }).then(Boolean);
export const promptBox = (message, initial, okLabel) => openDialog({ message, okLabel, initial: initial ?? '' });
export const alertBox = (message) => openDialog({ message, cancel: false });

// Centered modal with a title and a scrolling list body (favorites, plans,
// agent card). cls: an extra class on the box (e.g. a wider layout).
export function createListModal(title, cls = '') {
  const modal = document.createElement('div');
  modal.className = 'lm'; modal.hidden = true;
  modal.innerHTML = '<div class="lm-box" role="dialog">' +
    '<div class="lm-head"><span class="lm-h"></span>' +
    '<button type="button" class="lm-close" title="Закрыть">&times;</button></div>' +
    '<div class="lm-list"></div></div>';
  modal.querySelector('.lm-h').textContent = title;
  modal.querySelector('.lm-box').setAttribute('aria-label', title);
  if (cls) modal.querySelector('.lm-box').classList.add(cls);
  document.body.append(modal);

  const close = () => {
    if (modal.hidden) return;
    modal.hidden = true; backClosed(close);
  };
  modal.querySelector('.lm-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });
  return {
    el: modal,
    list: modal.querySelector('.lm-list'),
    open() { modal.hidden = false; backOpen(close); },
    close,
    get isOpen() { return !modal.hidden; },
    setTitle(text) { modal.querySelector('.lm-h').textContent = text; },
  };
}
