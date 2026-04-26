(function () {
  const dialogStyleId = 'softora-site-input-dialog-style';

  function ensureDialogStyles() {
    if (typeof document === 'undefined' || document.getElementById(dialogStyleId)) return;
    const styleEl = document.createElement('style');
    styleEl.id = dialogStyleId;
    styleEl.textContent = `
.site-dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(8, 10, 18, 0.72);
    backdrop-filter: blur(10px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
}

.site-dialog {
    width: min(100%, 34rem);
    background: var(--bg-secondary, #0d0d0d);
    border: 1px solid rgba(139,34,82,0.25);
    box-shadow: 0 25px 80px rgba(0,0,0,0.45);
    padding: 1.2rem;
    animation: siteDialogFadeUp 0.2s ease forwards;
}

@keyframes siteDialogFadeUp {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.site-dialog-title {
    font-family: 'Oswald', sans-serif;
    font-size: 0.95rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary, #888);
    margin-bottom: 0.45rem;
}

.site-dialog-text {
    color: var(--text-primary, #f5f5f5);
    font-size: 0.95rem;
    margin-bottom: 0.9rem;
}

.site-dialog-input {
    width: 100%;
    padding: 1rem 1.2rem;
    background: rgba(255,255,255,0.03);
    border: 2px solid var(--border, rgba(255, 255, 255, 0.06));
    color: var(--text-primary, #f5f5f5);
    font-family: 'Inter', sans-serif;
    font-size: 1rem;
    outline: none;
    cursor: text;
    transition: all 0.3s var(--ease-out-expo, ease);
}

.site-dialog-input:focus {
    border-color: var(--accent-light, #A62D65);
    background: rgba(139, 34, 82, 0.03);
    box-shadow: 0 0 30px rgba(139, 34, 82, 0.08);
}

.site-dialog-error {
    min-height: 1.25rem;
    margin-top: 0.55rem;
    font-size: 0.8rem;
    color: #f4a0bc;
}

.site-dialog-actions {
    margin-top: 0.9rem;
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
}

.site-dialog-btn {
    border: 1px solid var(--border, rgba(255, 255, 255, 0.06));
    background: rgba(255,255,255,0.03);
    color: var(--text-primary, #f5f5f5);
    font-family: 'Oswald', sans-serif;
    font-size: 0.8rem;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0.75rem 1.15rem;
    min-width: 7.5rem;
    cursor: pointer;
    transition: all 0.2s ease;
}

.site-dialog-btn:hover,
.site-dialog-btn:focus-visible {
    border-color: var(--accent-light, #A62D65);
    outline: none;
}

.site-dialog-btn--primary {
    background: linear-gradient(135deg, rgba(139,34,82,0.9), rgba(183,28,92,0.95));
    border-color: rgba(139,34,82,0.45);
    color: #fff;
    box-shadow: 0 10px 24px rgba(139,34,82,0.22);
}
`;
    document.head.appendChild(styleEl);
  }

  function openSiteInputDialog({
    title,
    message,
    initialValue = '',
    placeholder = '',
    confirmLabel = 'OK',
    cancelLabel = 'Annuleren',
    validate = () => '',
  } = {}) {
    if (typeof document === 'undefined' || !document.body) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      ensureDialogStyles();

      const previousActive = document.activeElement;
      const backdrop = document.createElement('div');
      backdrop.className = 'site-dialog-backdrop';

      const dialog = document.createElement('div');
      dialog.className = 'site-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');

      const titleEl = document.createElement('div');
      titleEl.className = 'site-dialog-title';
      titleEl.textContent = String(title || 'Invoer');

      const textEl = document.createElement('div');
      textEl.className = 'site-dialog-text';
      textEl.textContent = String(message || '');

      const inputEl = document.createElement('input');
      inputEl.className = 'site-dialog-input';
      inputEl.type = 'text';
      inputEl.inputMode = 'numeric';
      inputEl.autocomplete = 'off';
      inputEl.placeholder = String(placeholder || '');
      inputEl.value = String(initialValue ?? '');

      const errorEl = document.createElement('div');
      errorEl.className = 'site-dialog-error';

      const actionsEl = document.createElement('div');
      actionsEl.className = 'site-dialog-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'site-dialog-btn';
      cancelBtn.textContent = String(cancelLabel || 'Annuleren');

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'site-dialog-btn site-dialog-btn--primary';
      confirmBtn.textContent = String(confirmLabel || 'OK');

      actionsEl.appendChild(cancelBtn);
      actionsEl.appendChild(confirmBtn);
      dialog.appendChild(titleEl);
      dialog.appendChild(textEl);
      dialog.appendChild(inputEl);
      dialog.appendChild(errorEl);
      dialog.appendChild(actionsEl);
      backdrop.appendChild(dialog);

      function cleanup(value) {
        document.removeEventListener('keydown', onKeydown, true);
        backdrop.remove();
        if (previousActive && typeof previousActive.focus === 'function') {
          previousActive.focus();
        }
        resolve(value);
      }

      function submit() {
        const value = inputEl.value.trim();
        let validationMessage = '';
        try {
          validationMessage = String(validate(value) || '');
        } catch (error) {
          validationMessage = String((error && error.message) || 'Ongeldige invoer.');
        }
        if (validationMessage) {
          errorEl.textContent = validationMessage;
          inputEl.focus();
          inputEl.select();
          return;
        }
        cleanup(value);
      }

      function onKeydown(event) {
        if (!document.body.contains(backdrop)) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          cleanup(null);
          return;
        }
        if (event.key === 'Enter' && dialog.contains(event.target)) {
          event.preventDefault();
          submit();
        }
      }

      cancelBtn.addEventListener('click', () => cleanup(null));
      confirmBtn.addEventListener('click', submit);
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) {
          cleanup(null);
        }
      });
      inputEl.addEventListener('input', () => {
        if (errorEl.textContent) errorEl.textContent = '';
      });

      document.body.appendChild(backdrop);
      document.addEventListener('keydown', onKeydown, true);
      window.requestAnimationFrame(() => {
        inputEl.focus();
        inputEl.select();
      });
    });
  }

  window.openSiteInputDialog = openSiteInputDialog;
})();
