(function (global) {
  "use strict";

  const DEFAULT_SCOPE = "premium_coldmailing_settings";
  const DEFAULT_KEY = "softora_coldmailing_settings_v1";
  const DEFAULT_TONE = "Vriendelijk & professioneel";
  const DEFAULT_AI_INSTRUCTIONS = "Pas de mail aan op basis van het bedrijf. Noem de naam van het bedrijf in de aanhef. Als het bedrijf een restaurant is, noem dan iets over hun online menu of reserveringen. Als het een bouwbedrijf is, noem dan portfolio of projectfoto's. Houd de mail kort - maximaal 5 zinnen. Vermijd verkooptaal.";
  const DEFAULT_SUBJECT = "Korte vraag over uw website - Softora.nl";
  const DEFAULT_BODIES = {
    "serve@softora.nl": "Goedemorgen {{naam}},\n\nIk zag uw website en vroeg me af of u weleens heeft nagedacht over een modernere online aanpak.\n\nBij Softora.nl helpen wij MKB-bedrijven met professionele websites die klanten aantrekken - snel, persoonlijk en voor een vaste prijs.\n\nZou u hier open voor staan?\n\nMet vriendelijke groet,\nServé Creusen\n\n📍 {{stad}}\n\nSoftora.nl | +31 6 43 26 27 92",
    "servec321@gmail.com": "Goedemorgen {{naam}},\n\nIk zag uw website en vroeg me af of u weleens heeft nagedacht over een modernere online aanpak.\n\nBij Softora.nl helpen wij MKB-bedrijven met professionele websites die klanten aantrekken - snel, persoonlijk en voor een vaste prijs.\n\nZou u hier open voor staan?\n\nMet vriendelijke groet,\nServé Creusen\n\n📍 {{stad}}\n\nSoftora.nl | +31 6 43 26 27 92",
    "serve290@gmail.com": "Goedemorgen {{naam}},\n\nIk zag uw website en vroeg me af of u weleens heeft nagedacht over een modernere online aanpak.\n\nBij Softora.nl helpen wij MKB-bedrijven met professionele websites die klanten aantrekken - snel, persoonlijk en voor een vaste prijs.\n\nZou u hier open voor staan?\n\nMet vriendelijke groet,\nServé Creusen\n\n📍 {{stad}}\n\nSoftora.nl | +31 6 43 26 27 92",
    "servecreusen7@gmail.com": "Goedemorgen {{naam}},\n\nIk zag uw website en vroeg me af of u weleens heeft nagedacht over een modernere online aanpak.\n\nBij Softora.nl helpen wij MKB-bedrijven met professionele websites die klanten aantrekken - snel, persoonlijk en voor een vaste prijs.\n\nZou u hier open voor staan?\n\nMet vriendelijke groet,\nServé Creusen\n\n📍 {{stad}}\n\nSoftora.nl | +31 6 43 26 27 92",
    "martijn@softora.nl": "Goedemorgen {{naam}},\n\nIk zag uw website en vroeg me af of u weleens heeft nagedacht over een modernere online aanpak.\n\nBij Softora.nl helpen wij MKB-bedrijven met professionele websites die klanten aantrekken - snel, persoonlijk en voor een vaste prijs.\n\nZou u hier open voor staan?\n\nMet vriendelijke groet,\nMartijn van de Ven\n\n📍 {{stad}}\n\nSoftora.nl",
    "martijnven123@gmail.com": "Goedemorgen {{naam}},\n\nIk zag uw website en vroeg me af of u weleens heeft nagedacht over een modernere online aanpak.\n\nBij Softora.nl helpen wij MKB-bedrijven met professionele websites die klanten aantrekken - snel, persoonlijk en voor een vaste prijs.\n\nZou u hier open voor staan?\n\nMet vriendelijke groet,\nMartijn van de Ven\n\n📍 {{stad}}\n\nSoftora.nl",
  };
  const AUTHENTICATED_SENDER_EMAILS = Object.freeze(["serve@softora.nl", "martijn@softora.nl"]);

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(String(value || ""));
    } catch (_) {
      return fallback;
    }
  }

  function normalizeTone(value) {
    return String(value || "").trim() || DEFAULT_TONE;
  }

  function normalizeBodyTemplate(value) {
    if (global.SoftoraColdmailLocationVariable && typeof global.SoftoraColdmailLocationVariable.normalizeBodyTemplate === "function") {
      return global.SoftoraColdmailLocationVariable.normalizeBodyTemplate(value);
    }
    return String(value || "");
  }

  function normalizeProfile(value, fallback) {
    const raw = value && typeof value === "object" ? value : {};
    const base = fallback && typeof fallback === "object" ? fallback : {};
    return {
      subject: hasOwn(raw, "subject") ? String(raw.subject || "") : String(base.subject || DEFAULT_SUBJECT),
      body: normalizeBodyTemplate(hasOwn(raw, "body") ? raw.body : base.body || ""),
      aiInstructions: hasOwn(raw, "aiInstructions") ? String(raw.aiInstructions || "") : String(base.aiInstructions || DEFAULT_AI_INSTRUCTIONS),
      toneStyle: normalizeTone(hasOwn(raw, "toneStyle") ? raw.toneStyle : base.toneStyle),
    };
  }

  function normalizeSenderMap(value) {
    const raw = value && typeof value === "object" ? value : {};
    return Object.keys(raw).reduce((senders, email) => {
      const normalizedEmail = normalizeEmail(email);
      if (normalizedEmail) senders[normalizedEmail] = normalizeProfile(raw[email]);
      return senders;
    }, {});
  }

  function normalizeSettings(value, options) {
    const raw = value && typeof value === "object" ? value : {};
    const normalizeStack = options && typeof options.normalizeColdcallingStack === "function"
      ? options.normalizeColdcallingStack
      : (stack) => String(stack || "retell_ai").trim() || "retell_ai";
    const senders = normalizeSenderMap(raw.senders);
    const senderEmail = normalizeEmail(raw.senderEmail);
    const legacyProfile = normalizeProfile(raw);
    if (!Object.keys(senders).length && senderEmail && (raw.subject || raw.body || raw.aiInstructions || raw.toneStyle)) {
      senders[senderEmail] = legacyProfile;
    }
    return {
      version: 2,
      senderEmail,
      specialAction: String(raw.specialAction || "").trim().toLowerCase(),
      coldcallingStack: normalizeStack(raw.coldcallingStack || "retell_ai"),
      subject: legacyProfile.subject,
      body: legacyProfile.body,
      aiInstructions: legacyProfile.aiInstructions,
      toneStyle: legacyProfile.toneStyle,
      senders,
    };
  }

  function getUiField(id) {
    return global.document ? global.document.getElementById(id) : null;
  }

  function getSelectValue(id) {
    const field = getUiField(id);
    return field ? field.value : "";
  }

  function normalizeIdentityText(value) {
    return normalizeEmail(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9@.]+/g, " ");
  }

  function getAvailableSenderEmails() {
    const select = getUiField("campaignSenderEmail");
    const emails = Array.from(select?.options || [])
      .map((option) => normalizeEmail(option.value))
      .filter(Boolean);
    return emails.length ? emails : AUTHENTICATED_SENDER_EMAILS.slice();
  }

  function resolveAuthenticatedSenderEmail(session, availableEmails) {
    const allowed = new Set((Array.isArray(availableEmails) ? availableEmails : []).map(normalizeEmail).filter(Boolean));
    const email = normalizeEmail(session && session.email);
    if (allowed.has(email)) return email;
    const identityText = [
      session && session.email,
      session && session.displayName,
      session && session.firstName,
      session && session.lastName,
    ].map(normalizeIdentityText).filter(Boolean).join(" ");
    if (identityText.includes("martijn") && allowed.has("martijn@softora.nl")) return "martijn@softora.nl";
    if ((identityText.includes("serve") || identityText.includes("servec") || identityText.includes("creusen")) && allowed.has("serve@softora.nl")) return "serve@softora.nl";
    return "";
  }

  async function fetchAuthenticatedPreferredSenderEmail() {
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const session = await response.json().catch(() => null);
      return resolveAuthenticatedSenderEmail(session, getAvailableSenderEmails());
    } catch (_) {
      return "";
    }
  }

  function setSelectValue(select, value, syncCustomSelect) {
    if (!select || !value) return false;
    const safeValue = String(value || "").trim();
    if (!Array.from(select.options || []).some((option) => String(option.value) === safeValue)) return false;
    select.value = safeValue;
    if (typeof syncCustomSelect === "function") syncCustomSelect(select);
    return true;
  }

  function getSenderDefaultProfile(email, documentDefaults) {
    const normalizedEmail = normalizeEmail(email);
    return normalizeProfile({
      subject: documentDefaults && documentDefaults.subject ? documentDefaults.subject : DEFAULT_SUBJECT,
      body: DEFAULT_BODIES[normalizedEmail] || (documentDefaults && documentDefaults.body) || DEFAULT_BODIES["serve@softora.nl"],
      aiInstructions: documentDefaults && documentDefaults.aiInstructions ? documentDefaults.aiInstructions : DEFAULT_AI_INSTRUCTIONS,
      toneStyle: documentDefaults && documentDefaults.toneStyle ? documentDefaults.toneStyle : DEFAULT_TONE,
    });
  }

  function resolveSenderProfile(settings, senderEmail, documentDefaults) {
    const normalized = normalizeEmail(senderEmail) || normalizeEmail(settings && settings.senderEmail);
    const safeSettings = normalizeSettings(settings || {});
    const stored = normalized && safeSettings.senders ? safeSettings.senders[normalized] : null;
    return normalizeProfile(stored, getSenderDefaultProfile(normalized, documentDefaults));
  }

  function getReadUrls(scope) {
    const encodedScope = encodeURIComponent(String(scope || ""));
    return ["/api/ui-state-get?scope=" + encodedScope, "/api/ui-state/" + encodedScope];
  }

  function getWriteUrls(scope) {
    const encodedScope = encodeURIComponent(String(scope || ""));
    return ["/api/ui-state-set?scope=" + encodedScope, "/api/ui-state/" + encodedScope];
  }

  async function requestJson(urls, options, label) {
    let lastError = null;
    for (let index = 0; index < urls.length; index += 1) {
      try {
        const response = await fetch(urls[index], options);
        if (!response.ok) throw new Error(label + " mislukt (" + response.status + ")");
        return await response.json().catch(() => ({}));
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(label + " mislukt");
  }

  async function fetchUiState(scope) {
    if (global.SoftoraUiStateClient && typeof global.SoftoraUiStateClient.get === "function") {
      return await global.SoftoraUiStateClient.get(scope);
    }
    return await requestJson(getReadUrls(scope), { method: "GET", cache: "no-store" }, "UI-state GET");
  }

  async function saveUiState(scope, values) {
    const body = { values: values && typeof values === "object" ? values : {} };
    if (global.SoftoraUiStateClient && typeof global.SoftoraUiStateClient.set === "function") {
      return await global.SoftoraUiStateClient.set(scope, body);
    }
    return await requestJson(getWriteUrls(scope), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, "UI-state SET");
  }

  async function loadProfileForSender(email, options) {
    const scope = String(options && options.scope || DEFAULT_SCOPE);
    const key = String(options && options.key || DEFAULT_KEY);
    const data = await fetchUiState(scope);
    const values = data && data.values && typeof data.values === "object" ? data.values : {};
    const settings = normalizeSettings(safeJsonParse(values[key] || "{}", {}), options || {});
    return resolveSenderProfile(settings, email, options && options.defaults);
  }

  function createController(options) {
    const config = options && typeof options === "object" ? options : {};
    const state = {
      activeSenderEmail: "",
      applying: false,
      saveTimer: 0,
      loadedValues: {},
      settings: normalizeSettings({}),
      defaults: null,
      initialized: false,
      needsMigrationPersist: false,
      authenticatedPreferredSenderEmail: "",
    };

    function getScope() {
      return typeof config.getScope === "function" ? config.getScope() : DEFAULT_SCOPE;
    }

    function getKey() {
      return typeof config.getKey === "function" ? config.getKey() : DEFAULT_KEY;
    }

    function getPreferredSenderEmail() {
      return normalizeEmail(typeof config.getPreferredSenderEmail === "function" ? config.getPreferredSenderEmail() : "") || state.authenticatedPreferredSenderEmail;
    }

    function readDocumentDefaults() {
      if (state.defaults) return state.defaults;
      state.defaults = normalizeProfile({
        subject: getUiField("subj1")?.value || DEFAULT_SUBJECT,
        body: getUiField("body1")?.value || DEFAULT_BODIES["serve@softora.nl"],
        aiInstructions: getUiField("ai-instructies")?.value || DEFAULT_AI_INSTRUCTIONS,
        toneStyle: getUiField("ai-tone-style")?.value || DEFAULT_TONE,
      });
      return state.defaults;
    }

    function collectProfileFromFields() {
      return normalizeProfile({
        subject: getUiField("subj1")?.value || "",
        body: getUiField("body1")?.value || "",
        aiInstructions: getUiField("ai-instructies")?.value || "",
        toneStyle: getUiField("ai-tone-style")?.value || DEFAULT_TONE,
      }, readDocumentDefaults());
    }

    function getCurrentSenderEmail() {
      return normalizeEmail(getSelectValue("campaignSenderEmail") || state.activeSenderEmail || state.settings.senderEmail);
    }

    function buildSettingsSnapshot(senderForFields) {
      const currentSender = getCurrentSenderEmail();
      const profileSender = normalizeEmail(senderForFields || currentSender);
      const senders = Object.assign({}, state.settings.senders || {});
      if (profileSender) senders[profileSender] = collectProfileFromFields();
      const selectedProfile = resolveSenderProfile({ senders }, currentSender, readDocumentDefaults());
      return normalizeSettings({
        version: 2,
        senderEmail: currentSender,
        specialAction: getSelectValue("campaignSpecialAction"),
        coldcallingStack: getSelectValue("coldcallingStack"),
        subject: selectedProfile.subject,
        body: selectedProfile.body,
        aiInstructions: selectedProfile.aiInstructions,
        toneStyle: selectedProfile.toneStyle,
        senders,
      }, config);
    }

    function applyProfile(profile) {
      const normalized = normalizeProfile(profile, readDocumentDefaults());
      state.applying = true;
      const subjectInput = getUiField("subj1");
      const bodyInput = getUiField("body1");
      const aiInput = getUiField("ai-instructies");
      const toneSelect = getUiField("ai-tone-style");
      if (subjectInput) subjectInput.value = normalized.subject;
      if (bodyInput) bodyInput.value = normalized.body;
      if (aiInput) aiInput.value = normalized.aiInstructions;
      setSelectValue(toneSelect, normalized.toneStyle, global.syncCustomSelect);
      state.applying = false;
    }

    function applySettings(settings) {
      const rawSettings = settings && typeof settings === "object" ? settings : {};
      state.settings = normalizeSettings(settings || {}, config);
      const senderSelect = getUiField("campaignSenderEmail");
      const preferredSender = getPreferredSenderEmail() || state.settings.senderEmail || (senderSelect ? senderSelect.value : "");
      if (senderSelect && preferredSender) setSelectValue(senderSelect, preferredSender, global.syncCustomSelect);
      const activeSender = getCurrentSenderEmail();
      state.activeSenderEmail = activeSender;
      const rawSenderCount = rawSettings.senders && typeof rawSettings.senders === "object" ? Object.keys(rawSettings.senders).length : 0;
      if (!rawSenderCount && activeSender && (hasOwn(rawSettings, "subject") || hasOwn(rawSettings, "body") || hasOwn(rawSettings, "aiInstructions") || hasOwn(rawSettings, "toneStyle"))) {
        state.settings.senders[activeSender] = normalizeProfile(rawSettings, readDocumentDefaults());
        state.needsMigrationPersist = true;
      }
      setSelectValue(getUiField("coldcallingStack"), state.settings.coldcallingStack, global.syncCustomSelect);
      applyProfile(resolveSenderProfile(state.settings, activeSender, readDocumentDefaults()));
    }

    async function persistNow(senderForFields) {
      state.settings = buildSettingsSnapshot(senderForFields || state.activeSenderEmail || getCurrentSenderEmail());
      await saveUiState(getScope(), Object.assign({}, state.loadedValues, {
        [getKey()]: JSON.stringify(state.settings),
      }));
    }

    function persistSoon() {
      if (state.applying) return;
      if (state.saveTimer) global.clearTimeout(state.saveTimer);
      state.saveTimer = global.setTimeout(() => {
        void persistNow().catch(() => {
          /* Voorkeur bewaren is optioneel; verzenden blijft bruikbaar. */
        });
      }, 250);
    }

    async function switchSenderProfile() {
      if (state.applying) return;
      const previousSender = state.activeSenderEmail || getCurrentSenderEmail();
      const nextSender = getCurrentSenderEmail();
      if (previousSender && previousSender !== nextSender) {
        state.settings = buildSettingsSnapshot(previousSender);
      }
      state.activeSenderEmail = nextSender;
      applyProfile(resolveSenderProfile(state.settings, nextSender, readDocumentDefaults()));
      await persistNow(nextSender).catch(() => null);
    }

    async function hydrate() {
      readDocumentDefaults();
      const data = await fetchUiState(getScope());
      state.loadedValues = data && data.values && typeof data.values === "object" ? data.values : {};
      const rawSettings = safeJsonParse(state.loadedValues[getKey()] || "{}", {});
      state.authenticatedPreferredSenderEmail = await fetchAuthenticatedPreferredSenderEmail();
      applySettings(rawSettings);
      if (state.needsMigrationPersist) {
        state.needsMigrationPersist = false;
        await persistNow(state.activeSenderEmail || getCurrentSenderEmail()).catch(() => null);
      }
    }

    function bind() {
      ["campaignSpecialAction", "coldcallingStack"].forEach((id) => {
        const select = getUiField(id);
        if (!select || select.dataset.supabaseSettingsBound === "1") return;
        select.dataset.supabaseSettingsBound = "1";
        select.addEventListener("change", persistSoon);
      });

      const senderSelect = getUiField("campaignSenderEmail");
      if (senderSelect && senderSelect.dataset.supabaseSettingsBound !== "1") {
        senderSelect.dataset.supabaseSettingsBound = "1";
        senderSelect.addEventListener("change", () => { void switchSenderProfile(); });
      }

      ["subj1", "body1", "ai-instructies", "ai-tone-style"].forEach((id) => {
        const input = getUiField(id);
        if (!input || input.dataset.supabaseSettingsBound === "1") return;
        input.dataset.supabaseSettingsBound = "1";
        input.addEventListener("input", persistSoon);
        input.addEventListener("change", persistSoon);
      });
    }

    async function init() {
      if (state.initialized) return !state.hydrationFailed;
      state.initialized = true;
      let hydrated = false;
      await hydrate().then(() => {
        hydrated = true;
        state.hydrationFailed = false;
      }).catch(() => {
        state.hydrationFailed = true;
        state.activeSenderEmail = getCurrentSenderEmail();
      });
      bind();
      return hydrated;
    }

    return {
      normalizeSettings: (value) => normalizeSettings(value, config),
      collectSettings: () => buildSettingsSnapshot(state.activeSenderEmail || getCurrentSenderEmail()),
      applySettings,
      hydrate,
      bind,
      init,
      persistSoon,
      getCurrentSenderProfile: () => resolveSenderProfile(state.settings, getCurrentSenderEmail(), readDocumentDefaults()),
      switchSenderProfile,
    };
  }

  global.SoftoraCampaignSenderSettings = {
    createController,
    loadProfileForSender,
    normalizeEmail,
    normalizeSettings,
    normalizeSenderProfile: normalizeProfile,
    resolveSenderProfile,
  };
})(window);
