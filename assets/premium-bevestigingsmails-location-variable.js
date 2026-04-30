(function () {
  const STYLE_ID = 'softora-coldmail-location-variable-style';

  function isLeadGeneratorAlias() {
    return document.documentElement.getAttribute('data-softora-lead-generator-alias') === '1';
  }

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
    if (isLeadGeneratorAlias()) return;
    const settingsFields = document.querySelector('#mail-panel-5 .mail-fields');
    if (!settingsFields || document.querySelector('.mail-variable-note')) return;
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
    const intro = settingsFields.querySelector('.settings-intro');
    if (intro && intro.nextSibling) {
      settingsFields.insertBefore(note, intro.nextSibling);
      return;
    }
    settingsFields.insertBefore(note, settingsFields.firstChild);
  }

  function normalizeCurrentTextarea() {
    if (isLeadGeneratorAlias()) return;
    const bodyInput = document.getElementById('body1');
    if (!bodyInput) return;
    const normalized = normalizeBodyTemplate(bodyInput.value);
    if (normalized !== bodyInput.value) bodyInput.value = normalized;
  }

  function wrapGlobalFunction(name, createWrapper) {
    const original = window[name];
    if (typeof original !== 'function' || original.__softoraLocationVariableWrapped) return;
    const wrapped = createWrapper(original);
    wrapped.__softoraLocationVariableWrapped = true;
    window[name] = wrapped;
  }

  function installFunctionWrappers() {
    if (isLeadGeneratorAlias()) return;
    wrapGlobalFunction('applyColdmailingSettings', (original) => function (settings) {
      const nextSettings = settings && typeof settings === 'object'
        ? Object.assign({}, settings, {
            body: normalizeBodyTemplate(settings.body),
            servicePrompts: settings.servicePrompts && typeof settings.servicePrompts === 'object'
              ? Object.keys(settings.servicePrompts).reduce((prompts, key) => {
                  const prompt = settings.servicePrompts[key];
                  prompts[key] = prompt && typeof prompt === 'object'
                    ? Object.assign({}, prompt, { body: normalizeBodyTemplate(prompt.body) })
                    : prompt;
                  return prompts;
                }, {})
              : settings.servicePrompts,
          })
        : settings;
      const result = original.call(this, nextSettings);
      normalizeCurrentTextarea();
      return result;
    });

    wrapGlobalFunction('collectColdmailingSettings', (original) => function () {
      const settings = original.apply(this, arguments);
      if (settings && typeof settings === 'object') settings.body = normalizeBodyTemplate(settings.body);
      if (settings && settings.servicePrompts && typeof settings.servicePrompts === 'object') {
        Object.keys(settings.servicePrompts).forEach((key) => {
          const prompt = settings.servicePrompts[key];
          if (prompt && typeof prompt === 'object') prompt.body = normalizeBodyTemplate(prompt.body);
        });
      }
      return settings;
    });

    wrapGlobalFunction('getColdmailCampaignPayload', (original) => function () {
      const payload = original.apply(this, arguments);
      if (payload && typeof payload === 'object') payload.body = normalizeBodyTemplate(payload.body);
      return payload;
    });
  }

  function install() {
    if (isLeadGeneratorAlias()) return;
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
