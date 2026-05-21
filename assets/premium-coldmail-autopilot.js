(function (global) {
  "use strict";

  const STATUS_URL = "/api/coldmailing/autopilot/status";
  const SETTINGS_URL = "/api/coldmailing/autopilot/settings";
  const BATCH_SIZE = 3;
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

  function isLeadGenerator() {
    return /premium-ai-coldmailing/.test(String(location.pathname || "")) ||
      document.documentElement.getAttribute("data-softora-lead-generator-alias") === "1";
  }

  function buildAutopilotConfig() {
    const payload = typeof global.getColdmailCampaignPayload === "function"
      ? global.getColdmailCampaignPayload("")
      : {};
    return {
      count: BATCH_SIZE,
      senderEmail: normEmail(payload.senderEmail),
      senderEmails: getSenderEmails(),
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
      ".coldmail-autopilot-row{margin-top:12px;display:grid;gap:8px}",
      ".coldmail-autopilot-card{display:grid;grid-template-columns:1fr;gap:8px;align-items:stretch;border:1px solid rgba(155,35,85,.18);border-radius:8px;background:#fff;padding:8px;box-shadow:0 10px 26px rgba(26,26,46,.06);transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}",
      ".coldmail-autopilot-card.is-on{border-color:rgba(22,115,60,.34);background:rgba(22,115,60,.045);box-shadow:0 12px 30px rgba(22,115,60,.12)}",
      ".coldmail-autopilot-card.is-busy{opacity:.72}",
      ".coldmail-autopilot-toggle{min-height:46px;border:1px solid rgba(155,35,85,.26);border-radius:6px;background:#fff;color:var(--crimson,#9b2355);cursor:pointer;font-family:Oswald,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;padding:9px 12px;display:flex;align-items:center;justify-content:center;gap:9px;transition:background .16s ease,border-color .16s ease,color .16s ease,box-shadow .16s ease}",
      ".coldmail-autopilot-toggle:hover{border-color:rgba(155,35,85,.44);box-shadow:0 0 0 4px rgba(155,35,85,.08)}",
      ".coldmail-autopilot-toggle[aria-pressed=true]{background:var(--green,#16733c);border-color:var(--green,#16733c);color:#fff;box-shadow:0 10px 24px rgba(22,115,60,.18)}",
      ".coldmail-autopilot-toggle:disabled{opacity:.66;cursor:wait}",
      ".coldmail-autopilot-dot{width:9px;height:9px;border-radius:999px;background:var(--crimson,#9b2355);box-shadow:0 0 0 4px rgba(155,35,85,.12);flex:0 0 auto}",
      ".coldmail-autopilot-toggle[aria-pressed=true] .coldmail-autopilot-dot{background:#fff;box-shadow:0 0 0 4px rgba(255,255,255,.22)}",
      ".coldmail-autopilot-status{min-width:0;display:flex;flex-direction:column;justify-content:center;gap:3px;color:var(--mid,#555);font-size:11px;line-height:1.35;overflow-wrap:anywhere;padding:2px 4px}",
      ".coldmail-autopilot-status strong{font-family:Oswald,sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;line-height:1.1;text-transform:uppercase;color:var(--dark,#1a1a2e)}",
      ".coldmail-autopilot-card.is-on .coldmail-autopilot-status strong{color:var(--green,#16733c)}",
      ".coldmail-autopilot-freeze-note{display:none;align-items:center;gap:8px;border:1px solid rgba(22,115,60,.22);border-radius:6px;background:rgba(22,115,60,.07);color:var(--green,#16733c);font-size:11px;font-weight:700;line-height:1.35;padding:9px 11px}",
      "html[data-coldmail-autopilot-enabled=true] .coldmail-autopilot-freeze-note{display:flex}",
      "html[data-coldmail-autopilot-enabled=true] .coldmail-autopilot-freezable{position:relative}",
      "html[data-coldmail-autopilot-enabled=true] .coldmail-autopilot-freezable .mf-row,html[data-coldmail-autopilot-enabled=true] .coldmail-autopilot-freezable .field{opacity:.54;filter:grayscale(.18)}",
      "html[data-coldmail-autopilot-enabled=true] .coldmail-autopilot-freezable input:disabled,html[data-coldmail-autopilot-enabled=true] .coldmail-autopilot-freezable textarea:disabled,html[data-coldmail-autopilot-enabled=true] .coldmail-autopilot-freezable select:disabled,html[data-coldmail-autopilot-enabled=true] .coldmail-autopilot-freezable button:disabled{cursor:not-allowed!important}",
      "html[data-coldmail-autopilot-enabled=true] #start-campaign-btn{opacity:.48;filter:grayscale(.2);box-shadow:none}",
      "html[data-coldmail-autopilot-enabled=true] .site-select.is-disabled .site-select-trigger{cursor:not-allowed!important;opacity:.64}",
      "@media (max-width:760px){.coldmail-autopilot-card{grid-template-columns:1fr}.coldmail-autopilot-toggle{width:100%}}",
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
      '<button type="button" class="coldmail-autopilot-toggle" id="coldmailAutopilotToggle" aria-pressed="false" aria-describedby="coldmailAutopilotStatus">',
      '<span class="coldmail-autopilot-dot" aria-hidden="true"></span>',
      '<span id="coldmailAutopilotToggleLabel">Autopilot uit</span>',
      "</button>",
      '<div class="coldmail-autopilot-status" id="coldmailAutopilotStatus"><strong>Handmatige modus</strong><span>Status laden...</span></div>',
      "</div>",
      '<div class="coldmail-autopilot-freeze-note" id="coldmailAutopilotFreezeNote">Instellingen bevroren zolang autopilot aan staat.</div>',
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
    getFreezeElements().forEach((element) => {
      if (!previousDisabledState.has(element)) previousDisabledState.set(element, Boolean(element.disabled));
      element.disabled = active ? true : Boolean(previousDisabledState.get(element));
      element.setAttribute("aria-disabled", element.disabled ? "true" : "false");
      if (!active) previousDisabledState.delete(element);
      if (element.tagName === "SELECT") syncCustomSelect(element);
    });
  }

  function reasonLabel(reason) {
    const labels = {
      sent: "laatste check heeft verzonden",
      outside_safe_hours: "wacht op veilig tijdslot",
      outside_weekday_window: "wacht op werkdag",
      cooldown: "wacht op volgende check",
      coldmail_daily_limit_reached: "dagruimte op",
      no_sender_capacity: "dagruimte op",
      coldmail_safety_paused: "veiligheidspauze actief",
      empty_mail_content: "mist mailtekst",
      disabled: "staat gepauzeerd",
    };
    return labels[String(reason || "").toLowerCase()] || String(reason || "geen recente check");
  }

  function render(payload) {
    state = payload && payload.autopilot ? payload.autopilot : payload || state || {};
    const enabled = Boolean(state.enabled);
    const result = state.lastResult || {};
    const batch = (state.config && state.config.count) || BATCH_SIZE;
    const card = byId("coldmailAutopilotCard");
    const button = byId("coldmailAutopilotToggle");
    const label = byId("coldmailAutopilotToggleLabel");
    const status = byId("coldmailAutopilotStatus");

    if (card) {
      card.classList.toggle("is-on", enabled);
      card.classList.toggle("is-busy", busy);
    }
    if (button) {
      button.disabled = busy;
      button.setAttribute("aria-pressed", enabled ? "true" : "false");
      button.title = enabled
        ? "Autopilot uitschakelen en instellingen weer vrijgeven"
        : "Autopilot inschakelen met de huidige instellingen";
    }
    if (label) label.textContent = enabled ? "Autopilot aan" : "Autopilot uit";
    if (status) {
      const title = enabled ? "Automatisch actief" : "Handmatige modus";
      const copy = !enabled
        ? "Geen automatische verzending. Gebruik Mails Versturen voor handmatig sturen."
        : Number(result.sent || 0) > 0
          ? String(result.sent) + " verzonden bij laatste check. Batch " + batch + "."
          : reasonLabel(result.reason) + ". Batch " + batch + ".";
      status.innerHTML = "<strong>" + title + "</strong><span>" + copy + "</span>";
    }
    setAutopilotFreeze(enabled);
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
      render(await json(STATUS_URL));
    } catch (_) {
      const status = byId("coldmailAutopilotStatus");
      if (status) status.innerHTML = "<strong>Status onbekend</strong><span>Autopilotstatus kon niet worden geladen.</span>";
      if (!freezeActive) setAutopilotFreeze(false);
    }
  }

  async function toggle() {
    if (busy) return;
    busy = true;
    render(state);
    const enabled = !(state && state.enabled);
    try {
      render(await json(SETTINGS_URL, {
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
            startHour: 9,
            endHour: 17,
            minIntervalMinutes: 12,
          },
        }),
      }));
      if (typeof global.showToast === "function") {
        global.showToast(enabled ? "Autopilot staat aan. Instellingen zijn bevroren." : "Autopilot staat uit. Instellingen zijn vrijgegeven.");
      }
    } catch (error) {
      if (typeof global.showToast === "function") {
        global.showToast(String(error && error.message || "Autopilot kon niet worden opgeslagen."));
      }
    } finally {
      busy = false;
      render(state);
    }
  }

  function init() {
    if (isLeadGenerator() || !injectUi()) return;
    void refresh();
    global.setInterval(refresh, 60000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window);
