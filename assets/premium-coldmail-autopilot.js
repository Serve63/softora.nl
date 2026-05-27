(function (global) {
  "use strict";

  const STATUS_URL = "/api/coldmailing/autopilot/status";
  const SETTINGS_URL = "/api/coldmailing/autopilot/settings";
  const BATCH_SIZE = 1;
  const AUTOPILOT_STATUS_EVENT = "softora:coldmail-autopilot-status";
  const FREEZE_IDS = [
    "subj1",
    "body1",
    "ai-tone-style",
    "ai-instructies",
    "campaignSpecialAction",
    "coldcallingStack",
    "mail-slider",
    "campaignSenderEmail",
    "campaignTestModeToggle",
    "campaignCompanyCount",
    "callDispatchMode",
    "km-slider",
    "service",
    "database",
    "start-campaign-btn",
  ];
  const previousDisabledState = new WeakMap();

  let state = null;
  let busy = false;
  let freezeActive = false;
  let statusLoaded = false;
  let statusUnavailable = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function normEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getSenderEmails() {
    const select = byId("campaignSenderEmail");
    const options = Array.from(select && select.options ? select.options : []);
    const emails = options.map((option) => normEmail(option.value)).filter(Boolean);
    return emails.length ? emails : [normEmail(select && select.value)].filter(Boolean);
  }

  function buildSenderProfileFromPayload(payload) {
    return {
      subject: String(payload && payload.subject || ""),
      body: String(payload && payload.body || ""),
      aiInstructions: String(payload && payload.aiInstructions || ""),
      toneStyle: String(payload && payload.toneStyle || ""),
    };
  }

  function hasLocationVariable(value) {
    return /📍/.test(String(value || "")) || /\{\{\s*(stad|plaats|locatie)\s*\}\}/i.test(String(value || ""));
  }

  function ensureLocationLine(value) {
    const body = String(value || "").replace(/\s+$/g, "");
    if (!body || hasLocationVariable(body)) return body;
    return body + "\n\n📍 {{stad}}";
  }

  function normalizeAutopilotProfile(profile) {
    const raw = profile && typeof profile === "object" ? profile : {};
    const normalized = buildSenderProfileFromPayload(raw);
    normalized.body = ensureLocationLine(normalized.body);
    return normalized;
  }

  function hasProfileContent(profile) {
    return Boolean(profile && String(profile.subject || "").trim() && String(profile.body || "").trim());
  }

  function getStoredSenderProfiles() {
    try {
      const controller = typeof global.getColdmailingSettingsController === "function"
        ? global.getColdmailingSettingsController()
        : null;
      const settings = controller && typeof controller.collectSettings === "function"
        ? controller.collectSettings()
        : null;
      return settings && settings.senders && typeof settings.senders === "object" ? settings.senders : {};
    } catch (_) {
      return {};
    }
  }

  function buildSenderProfiles(payload, senderEmails) {
    const emails = Array.isArray(senderEmails) ? senderEmails.map(normEmail).filter(Boolean) : [];
    const profiles = {};
    const storedProfiles = getStoredSenderProfiles();
    const standardProfile = normalizeAutopilotProfile(payload);
    emails.forEach((email) => {
      const storedProfile = storedProfiles[email];
      const selectedProfile = hasProfileContent(storedProfile) ? storedProfile : standardProfile;
      if (hasProfileContent(selectedProfile)) profiles[email] = normalizeAutopilotProfile(selectedProfile);
    });
    const currentSenderEmail = normEmail(payload && payload.senderEmail);
    if (currentSenderEmail && emails.includes(currentSenderEmail)) {
      profiles[currentSenderEmail] = normalizeAutopilotProfile(payload);
    }
    return profiles;
  }

  function isLeadGenerator() {
    return /premium-ai-coldmailing/.test(String(location.pathname || "")) ||
      document.documentElement.getAttribute("data-softora-lead-generator-alias") === "1";
  }

  function buildAutopilotConfig() {
    const payload = typeof global.getColdmailCampaignPayload === "function"
      ? global.getColdmailCampaignPayload("")
      : {};
    const senderEmails = getSenderEmails();
    return {
      count: BATCH_SIZE,
      senderEmail: normEmail(payload.senderEmail),
      senderEmails,
      senderProfiles: buildSenderProfiles(payload, senderEmails),
      subject: String(payload.subject || ""),
      body: String(payload.body || ""),
      aiInstructions: String(payload.aiInstructions || ""),
      toneStyle: String(payload.toneStyle || ""),
      branch: String(payload.branch || ""),
      service: String(payload.service || ""),
      database: String(payload.database || ""),
      specialAction: String(payload.specialAction || ""),
      durationDays: payload.durationDays,
      radiusKm: payload.radiusKm,
    };
  }

  function injectStyles() {
    if (byId("coldmailAutopilotStyles")) return;
    const style = document.createElement("style");
    style.id = "coldmailAutopilotStyles";
    style.textContent = [
      ".coldmail-autopilot-row{margin-top:12px;display:grid}",
      ".coldmail-autopilot-card{display:grid;align-items:stretch}",
      ".coldmail-autopilot-card.is-busy{opacity:.72}",
      ".coldmail-autopilot-toggle{min-height:58px;width:100%;border:1px solid rgba(155,35,85,.26);border-radius:8px;background:#fff;color:var(--crimson,#9b2355);cursor:pointer;font-family:Oswald,sans-serif;font-size:14px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;padding:11px 14px;display:flex;align-items:center;justify-content:center;gap:10px;transition:background .16s ease,border-color .16s ease,color .16s ease,box-shadow .16s ease}",
      ".coldmail-autopilot-toggle:hover{border-color:rgba(155,35,85,.44);box-shadow:0 0 0 4px rgba(155,35,85,.08)}",
      ".coldmail-autopilot-toggle[aria-pressed=true]{background:var(--green,#16733c);border-color:var(--green,#16733c);color:#fff;box-shadow:0 10px 24px rgba(22,115,60,.18)}",
      ".coldmail-autopilot-toggle:disabled{opacity:.66;cursor:wait}",
      ".coldmail-autopilot-toggle.is-loading,.coldmail-autopilot-toggle.is-unavailable{background:rgba(155,35,85,.06);border-color:rgba(155,35,85,.18);color:var(--mid,#8d8d9a);box-shadow:none}",
      ".coldmail-autopilot-dot{width:9px;height:9px;border-radius:999px;background:var(--crimson,#9b2355);box-shadow:0 0 0 4px rgba(155,35,85,.12);flex:0 0 auto}",
      ".coldmail-autopilot-toggle[aria-pressed=true] .coldmail-autopilot-dot{background:#fff;box-shadow:0 0 0 4px rgba(255,255,255,.22)}",
      ".coldmail-autopilot-toggle.is-loading .coldmail-autopilot-dot{background:var(--mid,#8d8d9a);box-shadow:0 0 0 4px rgba(141,141,154,.14)}",
      "html[data-coldmail-autopilot-enabled=true] .coldmail-autopilot-freezable{position:relative}",
      "html[data-coldmail-autopilot-enabled=true] .coldmail-autopilot-freezable .mf-row,html[data-coldmail-autopilot-enabled=true] .coldmail-autopilot-freezable .field{opacity:.54;filter:grayscale(.18)}",
      "html[data-coldmail-autopilot-enabled=true] .coldmail-autopilot-freezable input:disabled,html[data-coldmail-autopilot-enabled=true] .coldmail-autopilot-freezable textarea:disabled,html[data-coldmail-autopilot-enabled=true] .coldmail-autopilot-freezable select:disabled,html[data-coldmail-autopilot-enabled=true] .coldmail-autopilot-freezable button:disabled{cursor:not-allowed!important}",
      "html[data-coldmail-autopilot-enabled=true] #start-campaign-btn{opacity:.48;filter:grayscale(.2);box-shadow:none}",
      "html[data-coldmail-autopilot-enabled=true] .site-select.is-disabled .site-select-trigger{cursor:not-allowed!important;opacity:.64}",
      "@media (max-width:760px){.coldmail-autopilot-toggle{width:100%}}",
    ].join("");
    document.head.appendChild(style);
  }

  function injectUi() {
    const startButton = byId("start-campaign-btn");
    if (!startButton || byId("coldmailAutopilotToggle")) return Boolean(startButton);
    injectStyles();
    markFreezeTargets();

    const row = document.createElement("div");
    row.className = "coldmail-autopilot-row";
    row.innerHTML = [
      '<div class="coldmail-autopilot-card" id="coldmailAutopilotCard">',
      '<button type="button" class="coldmail-autopilot-toggle is-loading" id="coldmailAutopilotToggle" aria-pressed="false" aria-busy="true" data-autopilot-scope="team" disabled>',
      '<span class="coldmail-autopilot-dot" aria-hidden="true"></span>',
      '<span id="coldmailAutopilotToggleLabel">Team autopilot controleren</span>',
      "</button>",
      "</div>",
    ].join("");
    startButton.insertAdjacentElement("afterend", row);
    byId("coldmailAutopilotToggle").addEventListener("click", toggle);
    return true;
  }

  function markFreezeTargets() {
    const mailCard = byId("subj1")?.closest(".card");
    const campaignCard = byId("start-campaign-btn")?.closest(".campagne-card");
    [mailCard, campaignCard].forEach((target) => {
      if (target) target.classList.add("coldmail-autopilot-freezable");
    });
  }

  function getFreezeElements() {
    return FREEZE_IDS.map(byId).filter(Boolean);
  }

  function syncCustomSelect(select) {
    if (!select) return;
    if (typeof select.__softoraRefreshCustomFormSelect === "function") {
      select.__softoraRefreshCustomFormSelect();
      return;
    }
    if (typeof select.__softoraSyncCustomFormSelect === "function") {
      select.__softoraSyncCustomFormSelect();
    }
  }

  function setAutopilotFreeze(enabled) {
    const active = Boolean(enabled);
    freezeActive = active;
    document.documentElement.setAttribute("data-coldmail-autopilot-enabled", active ? "true" : "false");
    document.documentElement.setAttribute("data-coldmail-autopilot-scope", "team");
    getFreezeElements().forEach((element) => {
      if (!previousDisabledState.has(element)) previousDisabledState.set(element, Boolean(element.disabled));
      element.disabled = active ? true : Boolean(previousDisabledState.get(element));
      element.setAttribute("aria-disabled", element.disabled ? "true" : "false");
      if (!active) previousDisabledState.delete(element);
      if (element.tagName === "SELECT") syncCustomSelect(element);
    });
  }

  function notifyAutopilotStatus(autopilot) {
    if (typeof global.dispatchEvent !== "function") return;
    try {
      global.dispatchEvent(new CustomEvent(AUTOPILOT_STATUS_EVENT, {
        detail: { autopilot: autopilot && typeof autopilot === "object" ? autopilot : {} },
      }));
    } catch (_) {
      /* ignore older browser event issues */
    }
  }

  function applyStatusPayload(payload) {
    state = payload && payload.autopilot ? payload.autopilot : payload || {};
    statusLoaded = true;
    statusUnavailable = false;
    render();
  }

  function render() {
    const loading = !statusLoaded && !statusUnavailable;
    const unavailable = statusUnavailable && !statusLoaded;
    const enabled = statusLoaded && Boolean(state && state.enabled);
    const card = byId("coldmailAutopilotCard");
    const button = byId("coldmailAutopilotToggle");
    const label = byId("coldmailAutopilotToggleLabel");

    if (card) {
      card.classList.toggle("is-on", enabled);
      card.classList.toggle("is-busy", busy);
    }
    if (button) {
      const buttonTitle = loading
        ? "Team-autopilotstatus wordt geladen"
        : unavailable
          ? "Team-autopilotstatus kon niet worden geladen"
          : enabled
            ? "Team-autopilot uitschakelen voor iedereen van Softora"
            : "Team-autopilot inschakelen voor iedereen van Softora";
      button.disabled = busy || loading || unavailable;
      button.classList.toggle("is-loading", loading);
      button.classList.toggle("is-unavailable", unavailable);
      button.setAttribute("aria-pressed", enabled ? "true" : "false");
      button.setAttribute("aria-busy", loading ? "true" : "false");
      button.title = buttonTitle;
    }
    if (label) {
      label.textContent = loading
        ? "Team autopilot controleren"
        : unavailable
          ? "Team autopilot status onbekend"
          : enabled
            ? "Team autopilot aan"
            : "Team autopilot uit";
    }
    setAutopilotFreeze(enabled);
    if (statusLoaded) notifyAutopilotStatus(state);
  }

  async function json(url, options) {
    const response = await fetch(url, Object.assign({
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }, options || {}));
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.ok === false) {
      throw new Error(payload && (payload.message || payload.error) || "Autopilot verzoek mislukt.");
    }
    return payload;
  }

  async function refresh() {
    try {
      applyStatusPayload(await json(STATUS_URL));
    } catch (_) {
      statusUnavailable = !statusLoaded;
      render();
      const status = byId("coldmailAutopilotStatus");
      if (status) status.innerHTML = "<strong>Status onbekend</strong><span>Autopilotstatus kon niet worden geladen.</span>";
      if (!freezeActive) setAutopilotFreeze(false);
    }
  }

  async function toggle() {
    if (busy || !statusLoaded || statusUnavailable) return;
    busy = true;
    render();
    const enabled = !(state && state.enabled);
    try {
      applyStatusPayload(await json(SETTINGS_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled,
          config: buildAutopilotConfig(),
          schedule: {
            timezone: "Europe/Amsterdam",
            weekdaysOnly: true,
            startHour: 8,
            endHour: 17,
            minIntervalMinutes: 5,
            senderMinIntervalMinutes: 14,
            senderMaxIntervalMinutes: 18,
            sendJitterMinSeconds: 5,
            sendJitterMaxSeconds: 45,
          },
        }),
      }));
      if (typeof global.showToast === "function") {
        global.showToast(enabled ? "Team-autopilot staat aan voor iedereen van Softora. Instellingen zijn bevroren." : "Team-autopilot staat uit. Instellingen zijn vrijgegeven.");
      }
    } catch (error) {
      if (typeof global.showToast === "function") {
        global.showToast(String(error && error.message || "Autopilot kon niet worden opgeslagen."));
      }
    } finally {
      busy = false;
      render();
    }
  }

  function init() {
    if (isLeadGenerator() || !injectUi()) return;
    render();
    void refresh();
    global.setInterval(refresh, 60000);
    global.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) void refresh();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window);
