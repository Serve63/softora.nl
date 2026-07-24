(function (global) {
  function create(options = {}) {
    const documentRef = options.document || global.document;
    let timer = 0;

    function show(messageText, actionOptions = null) {
      const toast = documentRef?.getElementById('toast');
      if (!toast) return;
      global.clearTimeout(timer);
      toast.textContent = '';
      const message = documentRef.createElement('span');
      message.textContent = String(messageText || '');
      toast.appendChild(message);
      const action = actionOptions && typeof actionOptions.action === 'function'
        ? actionOptions
        : null;
      if (action) {
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.className = 'toast-action';
        button.textContent = String(action.label || 'Ongedaan maken');
        button.addEventListener('click', async () => {
          button.disabled = true;
          await action.action();
        }, { once: true });
        toast.appendChild(button);
      }
      toast.classList.add('show');
      timer = global.setTimeout(() => toast.classList.remove('show'), action ? 8000 : 2500);
    }

    return { show };
  }

  const api = { create };
  global.SoftoraMailboxToast = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
