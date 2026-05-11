(function (global) {
  'use strict';

  const STYLE_ID = 'softora-risky-action-pin-style';
  let activeRequest = null;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.risky-pin-overlay{position:fixed;inset:0;z-index:10080;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(11,13,22,.68);backdrop-filter:blur(2px)}
.risky-pin-card{width:min(430px,100%);position:relative;border:1px solid rgba(155,35,85,.18);border-radius:18px;background:#fff;box-shadow:0 24px 70px rgba(26,26,46,.18);padding:34px 32px 28px;color:#1a1a2e;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.risky-pin-close{position:absolute;top:10px;right:10px;width:38px;height:38px;border:0;border-radius:12px;background:transparent;color:#767887;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.risky-pin-close:hover{background:rgba(155,35,85,.08);color:#9b2355}
.risky-pin-icon{width:52px;height:52px;border-radius:16px;border:1px solid rgba(155,35,85,.18);background:rgba(155,35,85,.08);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:#9b2355}
.risky-pin-eyebrow{margin:0 0 7px;text-align:center;font-family:Oswald,Inter,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#9b2355}
.risky-pin-title{margin:0 0 8px;text-align:center;font-size:23px;line-height:1.2;font-weight:800;color:#1a1a2e}
.risky-pin-copy{margin:0 auto 22px;max-width:330px;text-align:center;font-size:14px;line-height:1.55;color:#666a78}
.risky-pin-label{display:block;margin:0 0 8px;font-family:Oswald,Inter,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#999}
.risky-pin-input{box-sizing:border-box;width:100%;height:52px;border:1px solid rgba(155,35,85,.28);border-radius:10px;background:#fff;color:#1a1a2e;font:700 22px/1 Inter,system-ui,sans-serif;text-align:center;letter-spacing:7px;outline:none}
.risky-pin-input:focus{border-color:#9b2355;box-shadow:0 0 0 4px rgba(155,35,85,.12)}
.risky-pin-error{min-height:20px;margin:10px 0 0;color:#c0392b;font-size:13px;line-height:1.45;text-align:center;font-weight:600}
.risky-pin-actions{display:flex;gap:10px;margin-top:20px}
.risky-pin-button{height:48px;border-radius:8px;border:1px solid rgba(155,35,85,.22);font-family:Oswald,Inter,sans-serif;font-size:13px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;cursor:pointer}
.risky-pin-button--cancel{flex:0 0 118px;background:#fff;color:#777b87}
.risky-pin-button--confirm{flex:1;background:#9b2355;color:#fff;border-color:#9b2355;box-shadow:0 12px 26px rgba(155,35,85,.18)}
.risky-pin-button:disabled{opacity:.62;cursor:wait}
@media(max-width:520px){.risky-pin-card{padding:30px 22px 24px}.risky-pin-actions{flex-direction:column}.risky-pin-button--cancel{flex:auto}}
`;
    document.head.appendChild(style);
  }

  function requestPin(options = {}) {
    if (activeRequest) return activeRequest;
    ensureStyles();

    activeRequest = new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'risky-pin-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'risky-pin-title');
      overlay.innerHTML = [
        '<form class="risky-pin-card" novalidate>',
        '  <button class="risky-pin-close" type="button" aria-label="Sluiten">',
        '    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        '  </button>',
        '  <div class="risky-pin-icon" aria-hidden="true">',
        '    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="10.5" width="17" height="10" rx="2"/><path d="M7.5 10.5V7.5a4.5 4.5 0 0 1 9 0v3"/></svg>',
        '  </div>',
        '  <p class="risky-pin-eyebrow">Beveiligde actie</p>',
        '  <h2 class="risky-pin-title" id="risky-pin-title"></h2>',
        '  <p class="risky-pin-copy" id="risky-pin-copy"></p>',
        '  <label class="risky-pin-label" for="risky-action-pin-input">Pincode</label>',
        '  <input class="risky-pin-input" id="risky-action-pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="6" pattern="[0-9]*" aria-describedby="risky-pin-error">',
        '  <div class="risky-pin-error" id="risky-pin-error" role="alert" aria-live="polite"></div>',
        '  <div class="risky-pin-actions">',
        '    <button class="risky-pin-button risky-pin-button--cancel" type="button">Annuleren</button>',
        '    <button class="risky-pin-button risky-pin-button--confirm" type="submit"></button>',
        '  </div>',
        '</form>',
      ].join('');

      const form = overlay.querySelector('form');
      const input = overlay.querySelector('.risky-pin-input');
      const error = overlay.querySelector('.risky-pin-error');
      const closeButton = overlay.querySelector('.risky-pin-close');
      const cancelButton = overlay.querySelector('.risky-pin-button--cancel');
      const confirmButton = overlay.querySelector('.risky-pin-button--confirm');
      const title = overlay.querySelector('.risky-pin-title');
      const copy = overlay.querySelector('.risky-pin-copy');
      let settled = false;

      title.textContent = options.title || 'Pincode vereist';
      copy.textContent = options.description || 'Typ de pincode om deze actie te starten.';
      confirmButton.textContent = options.confirmLabel || 'Bevestigen';

      function finish(value) {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        activeRequest = null;
        resolve(value || '');
      }

      function setError(message) {
        error.textContent = message || '';
      }

      function setBusy(isBusy) {
        input.disabled = Boolean(isBusy);
        confirmButton.disabled = Boolean(isBusy);
        cancelButton.disabled = Boolean(isBusy);
        closeButton.disabled = Boolean(isBusy);
        confirmButton.textContent = isBusy ? 'Controleren...' : (options.confirmLabel || 'Bevestigen');
      }

      function onKeyDown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish('');
        }
      }

      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '').slice(0, 6);
        setError('');
      });

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const pin = input.value.trim();
        if (!pin) {
          setError('Typ eerst de pincode.');
          input.focus();
          return;
        }
        if (typeof options.validate === 'function') {
          setBusy(true);
          try {
            await options.validate(pin);
          } catch (errorMessage) {
            setBusy(false);
            setError(String(errorMessage && errorMessage.message || errorMessage || 'Pincode is onjuist.'));
            input.select();
            return;
          }
        }
        finish(pin);
      });

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) finish('');
      });
      closeButton.addEventListener('click', () => finish(''));
      cancelButton.addEventListener('click', () => finish(''));
      document.addEventListener('keydown', onKeyDown, true);

      document.body.appendChild(overlay);
      window.setTimeout(() => input.focus(), 40);
    });

    return activeRequest;
  }

  async function requestMailSendPin(showError) {
    if (typeof requestPin !== 'function') {
      if (typeof showError === 'function') {
        showError('Beveiligingspopup kon niet worden geladen. Actie niet gestart.');
      }
      return '';
    }
    return requestPin({
      title: 'Mails versturen bevestigen',
      description: 'Typ de pincode om te voorkomen dat deze actie per ongeluk start.',
      confirmLabel: 'Starten',
    });
  }

  global.SoftoraRiskyActionPin = {
    requestMailSendPin,
    requestPin,
  };
})(window);
