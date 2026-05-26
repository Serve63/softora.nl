(function () {
  const STYLE_ID = 'softora-coldmail-location-variable-style';

  function normalizeBodyTemplate(value) {
    return String(value || '')
      .replace(/(^|\n)([ \t]*📍[ \t]*)Haaren([ \t]*(?=\n|$))/gi, '$1$2{{stad}}$3')
      .replace(/(^|\n)([ \t]*📍[ \t]*)\{\{\s*(plaats|locatie)\s*\}\}/gi, '$1$2{{stad}}');
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.mail-variable-note{margin-top:8px;display:inline-flex;align-items:center;gap:8px;align-self:flex-start;color:var(--crimson);background:rgba(155,35,85,.06);border:1px solid rgba(155,35,85,.18);border-radius:6px;padding:5px 9px;font-size:12px;line-height:1.4}',
      '.mail-variable-note .var-tag{padding:2px 8px;background:rgba(155,35,85,.12);border-color:rgba(155,35,85,.24)}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function ensureLocationNote() {
    const bodyInput = document.getElementById('body1');
    if (!bodyInput || document.querySelector('.mail-variable-note')) return;
    const note = document.createElement('div');
    note.className = 'mail-variable-note';
    note.setAttribute('aria-label', 'Dynamische plaats uit database');
    const pin = document.createElement('span');
    pin.setAttribute('aria-hidden', 'true');
    pin.textContent = '📍';
    const variable = document.createElement('span');
    variable.className = 'var-tag';
    variable.textContent = '{{stad}}';
    const label = document.createElement('span');
    label.textContent = 'Plaats uit database';
    note.append(pin, variable, label);
    bodyInput.insertAdjacentElement('afterend', note);
  }

  function normalizeCurrentTextarea() {
    const bodyInput = document.getElementById('body1');
    if (!bodyInput) return;
    const normalized = normalizeBodyTemplate(bodyInput.value);
    if (normalized !== bodyInput.value) bodyInput.value = normalized;
  }

  function normalizeSettingsBodies(settings) {
    if (!settings || typeof settings !== 'object') return settings;
    if (typeof settings.body === 'string') settings.body = normalizeBodyTemplate(settings.body);
    if (settings.senders && typeof settings.senders === 'object') {
      Object.keys(settings.senders).forEach((key) => {
        const template = settings.senders[key];
        if (template && typeof template === 'object' && typeof template.body === 'string') {
          template.body = normalizeBodyTemplate(template.body);
        }
      });
    }
    return settings;
  }

  function wrapGlobalFunction(name, createWrapper) {
    const original = window[name];
    if (typeof original !== 'function' || original.__softoraLocationVariableWrapped) return;
    const wrapped = createWrapper(original);
    wrapped.__softoraLocationVariableWrapped = true;
    window[name] = wrapped;
  }

  function installFunctionWrappers() {
    wrapGlobalFunction('applyColdmailingSettings', (original) => function (settings) {
      const nextSettings = settings && typeof settings === 'object'
        ? normalizeSettingsBodies(Object.assign({}, settings))
        : settings;
      const result = original.call(this, nextSettings);
      normalizeCurrentTextarea();
      return result;
    });

    wrapGlobalFunction('collectColdmailingSettings', (original) => function () {
      const settings = original.apply(this, arguments);
      return normalizeSettingsBodies(settings);
    });

    wrapGlobalFunction('getColdmailCampaignPayload', (original) => function () {
      const payload = original.apply(this, arguments);
      if (payload && typeof payload === 'object') payload.body = normalizeBodyTemplate(payload.body);
      return payload;
    });
  }

  function install() {
    injectStyle();
    ensureLocationNote();
    normalizeCurrentTextarea();
    installFunctionWrappers();
  }

  window.SoftoraColdmailLocationVariable = {
    install,
    normalizeBodyTemplate,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
