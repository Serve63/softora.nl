(function () {
  const STYLE_ID = 'softora-coldmail-location-variable-style';

  function normalizeBodyTemplate(value) {
    return String(value || '')
      .replace(
        /(Met vriendelijke groet,?\s*\n)(?:Serv[ée]\s+Creusen|Martijn\s+van\s+de\s+Ven)(\s*\n+\s*📍\s*)(?:(?:Alphen|Liempde)\b|\{\{\s*(?:stad|plaats|locatie|afzender[_\s-]?(?:plaats|stad|locatie))\s*\}\})/gi,
        '$1{{afzender}}$2{{stad}}'
      )
      .replace(/(^|\n)([ \t]*📍[ \t]*)Haaren([ \t]*(?=\n|$))/gi, '$1$2{{stad}}$3')
      .replace(/(^|\n)([ \t]*📍[ \t]*)\{\{\s*(plaats|locatie)\s*\}\}/gi, '$1$2{{stad}}');
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.mail-variable-note{margin-top:8px;display:inline-flex;align-items:center;gap:8px;align-self:flex-start;color:var(--crimson);background:rgba(155,35,85,.06);border:1px solid rgba(155,35,85,.18);border-radius:6px;padding:5px 9px;font-size:12px;line-height:1.4;flex-wrap:wrap}',
      '.mail-variable-note .var-tag{padding:2px 8px;background:rgba(155,35,85,.12);border-color:rgba(155,35,85,.24)}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function getLocationNoteHost() {
    return document.querySelector('#mail-panel-5 .mail-fields') || document.getElementById('body1')?.parentNode || null;
  }

  function ensureLocationNote() {
    const host = getLocationNoteHost();
    if (!host) return;
    const existing = document.querySelector('.mail-variable-note');
    if (existing) {
      if (!host.contains(existing)) host.appendChild(existing);
      return;
    }
    const note = document.createElement('div');
    note.className = 'mail-variable-note';
    note.setAttribute('aria-label', 'Dynamische klantgegevens en afzender uit systeem');
    const pin = document.createElement('span');
    pin.setAttribute('aria-hidden', 'true');
    pin.textContent = '📍';
    const variable = document.createElement('span');
    variable.className = 'var-tag';
    variable.textContent = '{{stad}}';
    const websiteVariable = document.createElement('span');
    websiteVariable.className = 'var-tag';
    websiteVariable.textContent = '{{website}}';
    const senderVariable = document.createElement('span');
    senderVariable.className = 'var-tag';
    senderVariable.textContent = '{{afzender}}';
    const label = document.createElement('span');
    label.textContent = 'Klantgegevens en afzender uit systeem';
    note.append(pin, variable, websiteVariable, senderVariable, label);
    host.appendChild(note);
  }

  function normalizeCurrentTextarea() {
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
    wrapGlobalFunction('applyColdmailingSettings', (original) => function (settings) {
      const nextSettings = settings && typeof settings === 'object'
        ? Object.assign({}, settings, { body: normalizeBodyTemplate(settings.body) })
        : settings;
      const result = original.call(this, nextSettings);
      normalizeCurrentTextarea();
      return result;
    });

    wrapGlobalFunction('collectColdmailingSettings', (original) => function () {
      const settings = original.apply(this, arguments);
      if (settings && typeof settings === 'object') settings.body = normalizeBodyTemplate(settings.body);
      return settings;
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
