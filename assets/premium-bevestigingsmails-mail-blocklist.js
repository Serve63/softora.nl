(function () {
  const FIELD_ID = 'coldmailingEmailBlocklist';
  const STYLE_ID = 'softora-coldmailing-email-blocklist-style';
  let saveTimer = null;

  function isLeadGeneratorMode() {
    return document.documentElement.getAttribute('data-softora-lead-generator-alias') === '1';
  }

  function normalizeBlocklistText(value) {
    const seen = new Set();
    return String(value || '')
      .split(/[\s,;|]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry))
      .filter((entry) => {
        if (seen.has(entry)) return false;
        seen.add(entry);
        return true;
      })
      .join('\n');
  }

  function getBlocklistText() {
    const field = document.getElementById(FIELD_ID);
    return normalizeBlocklistText(field ? field.value : '');
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.coldmailing-email-blocklist{margin-top:14px}',
      '.coldmailing-email-blocklist-input{width:100%;height:108px;min-height:108px;padding:10px 12px;border:1px solid var(--border);border-radius:5px;background:var(--field-bg);color:var(--dark);font-family:Inter,sans-serif;font-size:13px;line-height:1.55;resize:vertical;outline:none;transition:border-color .15s}',
      '.coldmailing-email-blocklist-input:focus{border-color:var(--crimson)}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function ensureBlocklistField() {
    if (isLeadGeneratorMode() || document.getElementById(FIELD_ID)) return;
    const specialActionSelect = document.getElementById('campaignSpecialAction');
    const specialActionRow = specialActionSelect && specialActionSelect.closest('.mf-row');
    if (!specialActionRow) return;

    const row = document.createElement('div');
    row.className = 'mf-row coldmailing-email-blocklist';

    const label = document.createElement('div');
    label.className = 'mf-label';
    label.textContent = 'Bloklijst';

    const textarea = document.createElement('textarea');
    textarea.className = 'coldmailing-email-blocklist-input';
    textarea.id = FIELD_ID;
    textarea.rows = 5;
    textarea.inputMode = 'email';
    textarea.placeholder = 'info@example.nl';
    textarea.setAttribute('aria-label', 'Mailadressen die nooit gemaild mogen worden');

    const help = document.createElement('div');
    help.className = 'mf-help';
    help.textContent = 'Een mailadres per regel. Deze adressen worden nooit meegenomen in de coldmailcampagne.';

    row.append(label, textarea, help);
    specialActionRow.insertAdjacentElement('afterend', row);
  }

  function wrapGlobalFunction(name, createWrapper) {
    const original = window[name];
    if (typeof original !== 'function' || original.__softoraMailBlocklistWrapped) return;
    const wrapped = createWrapper(original);
    wrapped.__softoraMailBlocklistWrapped = true;
    window[name] = wrapped;
  }

  function installFunctionWrappers() {
    wrapGlobalFunction('collectColdmailingSettings', (original) => function () {
      const settings = original.apply(this, arguments);
      if (settings && typeof settings === 'object') settings.emailBlocklist = getBlocklistText();
      return settings;
    });

    wrapGlobalFunction('applyColdmailingSettings', (original) => function (settings) {
      const result = original.apply(this, arguments);
      const field = document.getElementById(FIELD_ID);
      if (field && settings && typeof settings === 'object') {
        field.value = normalizeBlocklistText(settings.emailBlocklist || settings.blockedEmails || '');
      }
      return result;
    });

    wrapGlobalFunction('getColdmailRecipientPreviewUrl', (original) => function () {
      const url = original.apply(this, arguments);
      if (isLeadGeneratorMode()) return url;
      const blockedEmails = getBlocklistText();
      if (!blockedEmails) return url;
      const separator = url.includes('?') ? '&' : '?';
      return url + separator + 'blockedEmails=' + encodeURIComponent(blockedEmails);
    });

    wrapGlobalFunction('getColdmailCampaignPayload', (original) => function () {
      const payload = original.apply(this, arguments);
      if (payload && typeof payload === 'object' && !isLeadGeneratorMode()) {
        payload.blockedEmails = getBlocklistText();
        payload.emailBlocklist = payload.blockedEmails;
      }
      return payload;
    });
  }

  async function hydrateBlocklistFromSettings() {
    if (
      typeof window.fetchColdmailingUiState !== 'function' ||
      typeof window.getCampaignSettingsScope !== 'function' ||
      typeof window.getCampaignSettingsKey !== 'function'
    ) return;
    try {
      const data = await window.fetchColdmailingUiState(window.getCampaignSettingsScope());
      const values = data && data.values && typeof data.values === 'object' ? data.values : {};
      const settings = JSON.parse(String(values[window.getCampaignSettingsKey()] || '{}'));
      const field = document.getElementById(FIELD_ID);
      if (field) field.value = normalizeBlocklistText(settings.emailBlocklist || settings.blockedEmails || '');
    } catch (_) {
      /* De bloklijst blijft lokaal leeg als voorkeuren niet geladen konden worden. */
    }
  }

  function persistBlocklistSoon() {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const settings = typeof window.collectColdmailingSettings === 'function'
        ? window.collectColdmailingSettings()
        : {};
      settings.emailBlocklist = getBlocklistText();
      if (
        typeof window.saveColdmailingUiState === 'function' &&
        typeof window.getCampaignSettingsScope === 'function' &&
        typeof window.getCampaignSettingsKey === 'function'
      ) {
        window.saveColdmailingUiState(window.getCampaignSettingsScope(), {
          [window.getCampaignSettingsKey()]: JSON.stringify(settings),
        }).catch(() => {});
      }
      if (typeof window.hydrateCampaignCompanyCountFromSupabase === 'function') {
        window.hydrateCampaignCompanyCountFromSupabase();
      }
      if (typeof window.hydrateCampaignRecipientListSoon === 'function') {
        window.hydrateCampaignRecipientListSoon();
      }
    }, 250);
  }

  function bindBlocklistField() {
    const field = document.getElementById(FIELD_ID);
    if (!field || field.dataset.blocklistBound === '1') return;
    field.dataset.blocklistBound = '1';
    field.addEventListener('input', persistBlocklistSoon);
    field.addEventListener('change', function () {
      field.value = normalizeBlocklistText(field.value);
      persistBlocklistSoon();
    });
  }

  async function install() {
    if (isLeadGeneratorMode()) return;
    injectStyle();
    ensureBlocklistField();
    installFunctionWrappers();
    await hydrateBlocklistFromSettings();
    bindBlocklistField();
    if (typeof window.hydrateCampaignCompanyCountFromSupabase === 'function') {
      window.hydrateCampaignCompanyCountFromSupabase();
    }
  }

  window.SoftoraBevestigingsmailsMailBlocklist = {
    install,
    normalizeBlocklistText,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    void install();
  }
})();
