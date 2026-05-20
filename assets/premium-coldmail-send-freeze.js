(function setupColdmailSendFreeze(global) {
  const STYLE_ID = 'softora-coldmail-send-freeze-style';
  const OVERLAY_ID = 'coldmailSendFreezeOverlay';
  const ROOT_ATTR = 'data-coldmail-send-freeze';
  const state = { active: false, previousFocus: null };

  function getDocument() {
    return global.document || null;
  }

  function injectStyles() {
    const doc = getDocument();
    if (!doc || doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      'html[' + ROOT_ATTR + '="true"],html[' + ROOT_ATTR + '="true"] body{overflow:hidden!important}',
      '.coldmail-send-freeze-overlay{position:fixed;inset:0;z-index:11980;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(249,247,244,.76);backdrop-filter:blur(4px) saturate(.96);-webkit-backdrop-filter:blur(4px) saturate(.96);pointer-events:auto}',
      '.coldmail-send-freeze-overlay[hidden]{display:none!important}',
      '.coldmail-send-freeze-card{width:min(392px,calc(100vw - 32px));box-sizing:border-box;border:1px solid rgba(155,35,85,.18);border-radius:20px;background:rgba(255,255,255,.96);box-shadow:0 22px 70px rgba(31,34,48,.14);padding:30px 30px 28px;text-align:center;color:var(--text-primary,#17172b)}',
      '.coldmail-send-freeze-spinner{--loader-size:58px;margin:0 auto 18px}',
      '.coldmail-send-freeze-kicker{margin:0 0 8px;font-family:Oswald,sans-serif;font-size:.84rem;font-weight:700;letter-spacing:.14em;line-height:1;text-transform:uppercase;color:var(--crimson,#9b2355)}',
      '.coldmail-send-freeze-title{margin:0;font-size:1.34rem;font-weight:800;line-height:1.16;color:var(--text-primary,#17172b)}',
      '.coldmail-send-freeze-copy{max-width:300px;margin:12px auto 0;font-size:.98rem;font-weight:600;line-height:1.48;color:var(--text-muted,#6e7280)}',
      '@media (max-width:640px){.coldmail-send-freeze-card{padding:26px 22px 24px;border-radius:18px}.coldmail-send-freeze-title{font-size:1.2rem}.coldmail-send-freeze-copy{font-size:.94rem}}',
    ].join('');
    (doc.head || doc.documentElement).appendChild(style);
  }

  function createSpinner(doc) {
    const spinner = doc.createElement('div');
    spinner.className = 'premium-boot-spinner coldmail-send-freeze-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    ['softora-dossier-loader__orbit--outer', 'softora-dossier-loader__orbit--inner', 'softora-dossier-loader__dot']
      .forEach((className) => {
        const span = doc.createElement('span');
        span.className = className;
        span.setAttribute('aria-hidden', 'true');
        spinner.appendChild(span);
      });
    return spinner;
  }

  function ensureOverlay() {
    const doc = getDocument();
    if (!doc) return null;
    injectStyles();
    let overlay = doc.getElementById(OVERLAY_ID);
    if (overlay) return overlay;
    overlay = doc.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'coldmail-send-freeze-overlay';
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'coldmailSendFreezeTitle');
    overlay.tabIndex = -1;

    const card = doc.createElement('div');
    card.className = 'coldmail-send-freeze-card';
    card.appendChild(createSpinner(doc));

    const kicker = doc.createElement('p');
    kicker.className = 'coldmail-send-freeze-kicker';
    kicker.textContent = 'Verzending loopt';
    card.appendChild(kicker);

    const title = doc.createElement('h2');
    title.className = 'coldmail-send-freeze-title';
    title.id = 'coldmailSendFreezeTitle';
    title.textContent = 'Mails worden verstuurd';
    card.appendChild(title);

    const copy = doc.createElement('p');
    copy.className = 'coldmail-send-freeze-copy';
    copy.textContent = 'Blijf op deze pagina. Klikken is geblokkeerd tot de verzending klaar is.';
    card.appendChild(copy);

    overlay.appendChild(card);
    (doc.body || doc.documentElement).appendChild(overlay);
    return overlay;
  }

  function handleBeforeUnload(event) {
    if (!state.active) return undefined;
    event.preventDefault();
    event.returnValue = '';
    return '';
  }

  function blockPageKeys(event) {
    if (!state.active) return;
    if (event.key === 'Tab') {
      const overlay = ensureOverlay();
      if (overlay) {
        event.preventDefault();
        overlay.focus({ preventScroll: true });
      }
      return;
    }
    if (event.key === 'Escape') event.preventDefault();
  }

  function show() {
    const doc = getDocument();
    const overlay = ensureOverlay();
    if (!doc || !overlay || state.active) return;
    state.active = true;
    state.previousFocus = doc.activeElement;
    doc.documentElement.setAttribute(ROOT_ATTR, 'true');
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('beforeunload', handleBeforeUnload);
    }
    doc.addEventListener('keydown', blockPageKeys, true);
    overlay.focus({ preventScroll: true });
  }

  function hide() {
    const doc = getDocument();
    const overlay = doc && doc.getElementById(OVERLAY_ID);
    if (!doc || !state.active) return;
    state.active = false;
    doc.documentElement.removeAttribute(ROOT_ATTR);
    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
    }
    if (typeof global.removeEventListener === 'function') {
      global.removeEventListener('beforeunload', handleBeforeUnload);
    }
    doc.removeEventListener('keydown', blockPageKeys, true);
    if (state.previousFocus && typeof state.previousFocus.focus === 'function') {
      try {
        state.previousFocus.focus({ preventScroll: true });
      } catch (_) {}
    }
    state.previousFocus = null;
  }

  function patchSendFreeze() {
    if (global.__softoraColdmailSendFreezeInstalled) return true;
    const original = global.sendColdmailCampaignNow;
    if (typeof original !== 'function' || original.__coldmailSendFreezePatched) return false;
    const wrapped = async function sendColdmailCampaignNowWithFreeze() {
      show();
      try {
        return await original.apply(this, arguments);
      } finally {
        hide();
      }
    };
    wrapped.__coldmailSendFreezePatched = true;
    global.sendColdmailCampaignNow = wrapped;
    global.__softoraColdmailSendFreezeInstalled = true;
    return true;
  }

  function init() {
    injectStyles();
    ensureOverlay();
    if (!patchSendFreeze() && typeof global.setTimeout === 'function') {
      global.setTimeout(patchSendFreeze, 0);
    }
  }

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', init, { once: true });
  } else if (global.document) {
    init();
  }
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('load', patchSendFreeze);
  }

  global.SoftoraColdmailSendFreeze = {
    ensureOverlay,
    hide,
    isActive: function isActive() { return Boolean(state.active); },
    patchSendFreeze,
    show,
  };
})(window);
