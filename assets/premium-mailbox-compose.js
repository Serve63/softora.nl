(function (global) {
  'use strict';

  let rewriteUsed = false;

  function getRewriteButton(documentRef = global.document) {
    return documentRef?.querySelector?.('[data-mailbox-action="rewrite-compose"]') || null;
  }

  function reset(isSuggestedReply = false, documentRef = global.document) {
    rewriteUsed = false;
    const button = getRewriteButton(documentRef);
    if (!button) return;
    button.hidden = false;
    button.disabled = false;
    button.textContent = isSuggestedReply ? 'Voorgestelde reactie' : 'Verwoord dit beter';
  }

  function complete(button) {
    rewriteUsed = true;
    if (button) button.hidden = true;
  }

  function finish(button, fallbackLabel) {
    if (!button) return;
    button.disabled = rewriteUsed;
    if (!rewriteUsed) button.textContent = fallbackLabel;
  }

  const api = { complete, finish, isUsed: () => rewriteUsed, reset };
  global.SoftoraMailboxCompose = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
