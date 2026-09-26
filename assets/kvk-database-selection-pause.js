// Keeps text on the KVK database page copyable: periodic re-renders wait while the
// user is selecting (mouse held down) or still has a text selection on the page.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, () => {
  function create(win) {
    let pointerDown = false;

    function hasSelection() {
      const selection = win.getSelection ? win.getSelection() : null;
      return Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed
        && String(selection).trim() !== '');
    }

    return {
      isSelecting() { return pointerDown || hasSelection(); },
      pointerDown() { pointerDown = true; },
      pointerUp() { pointerDown = false; },
    };
  }

  function install(win) {
    const pause = create(win);
    win.document.addEventListener('pointerdown', (event) => { if (event.button === 0) pause.pointerDown(); }, true);
    win.addEventListener('pointerup', pause.pointerUp, true);
    win.addEventListener('pointercancel', pause.pointerUp, true);
    win.addEventListener('blur', pause.pointerUp);
    win.SoftoraKvkSelectionPause = pause;
    return pause;
  }

  // Runs a periodic render unless the user is selecting text right now.
  function whenNotSelecting(win, render) {
    return (...args) => (win.SoftoraKvkSelectionPause?.isSelecting() ? undefined : render(...args));
  }

  return { create, install, whenNotSelecting };
});
