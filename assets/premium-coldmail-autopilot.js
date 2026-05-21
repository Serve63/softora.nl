(function (global) {
  "use strict";
  const STATUS_URL = "/api/coldmailing/autopilot/status", SETTINGS_URL = "/api/coldmailing/autopilot/settings";
  const BATCH_SIZE = 3; let state = null, busy = false;
  function byId(id) { return document.getElementById(id); }
  function normEmail(value) { return String(value || "").trim().toLowerCase(); }
  function getSenderEmails() { const select = byId("campaignSenderEmail"), options = Array.from(select && select.options ? select.options : []); const emails = options.map((option) => normEmail(option.value)).filter(Boolean); return emails.length ? emails : [normEmail(select && select.value)].filter(Boolean); }
  function isLeadGenerator() { return /premium-ai-coldmailing/.test(String(location.pathname || "")) || document.documentElement.getAttribute("data-softora-lead-generator-alias") === "1"; }
  function buildAutopilotConfig() { const payload = typeof global.getColdmailCampaignPayload === "function" ? global.getColdmailCampaignPayload("") : {}; return { count: BATCH_SIZE, senderEmail: normEmail(payload.senderEmail), senderEmails: getSenderEmails(), subject: String(payload.subject || ""), body: String(payload.body || ""), aiInstructions: String(payload.aiInstructions || ""), toneStyle: String(payload.toneStyle || ""), branch: String(payload.branch || ""), service: String(payload.service || ""), database: String(payload.database || ""), specialAction: String(payload.specialAction || ""), durationDays: payload.durationDays, radiusKm: payload.radiusKm }; }
  function injectUi() { const startButton = byId("start-campaign-btn"); if (!startButton || byId("coldmailAutopilotToggle")) return Boolean(startButton);
    const style = document.createElement("style"); style.textContent = ".coldmail-autopilot-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:center;margin-top:10px}.coldmail-autopilot-toggle{min-height:36px;border:1px solid rgba(155,35,85,.22);border-radius:6px;background:#fff;color:var(--crimson);cursor:pointer;font-family:Oswald,sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:8px 11px}.coldmail-autopilot-toggle[aria-pressed=true]{background:var(--crimson);border-color:var(--crimson);color:#fff}.coldmail-autopilot-toggle:disabled{opacity:.62;cursor:wait}.coldmail-autopilot-status{min-width:0;color:var(--mid);font-size:11px;line-height:1.35;overflow-wrap:anywhere}"; document.head.appendChild(style);
    const row = document.createElement("div"); row.className = "coldmail-autopilot-row"; row.innerHTML = '<button type="button" class="coldmail-autopilot-toggle" id="coldmailAutopilotToggle" aria-pressed="false">Autopilot uit</button><div class="coldmail-autopilot-status" id="coldmailAutopilotStatus">Status laden...</div>'; startButton.parentNode.insertBefore(row, startButton); byId("coldmailAutopilotToggle").addEventListener("click", toggle); return true;
  }
  function reasonLabel(reason) { const labels = { sent: "laatste check heeft verzonden", outside_safe_hours: "wacht op veilig tijdslot", outside_weekday_window: "wacht op werkdag", cooldown: "wacht op volgende check", coldmail_daily_limit_reached: "dagruimte op", no_sender_capacity: "dagruimte op", coldmail_safety_paused: "veiligheidspauze actief", empty_mail_content: "mist mailtekst", disabled: "staat uit" }; return labels[String(reason || "").toLowerCase()] || String(reason || "geen recente check"); }
  function render(payload) { state = payload && payload.autopilot ? payload.autopilot : payload || state || {};
    const enabled = Boolean(state.enabled), result = state.lastResult || {}, batch = state.config && state.config.count || BATCH_SIZE, button = byId("coldmailAutopilotToggle"), status = byId("coldmailAutopilotStatus");
    if (button) { button.disabled = busy; button.setAttribute("aria-pressed", enabled ? "true" : "false"); button.textContent = enabled ? "Autopilot aan" : "Autopilot uit"; }
    if (status) status.textContent = !enabled ? "Uit" : Number(result.sent || 0) > 0 ? "Aan · " + result.sent + " verzonden · batch " + batch : "Aan · " + reasonLabel(result.reason) + " · batch " + batch;
  }
  async function json(url, options) { const response = await fetch(url, Object.assign({ credentials: "same-origin", headers: { Accept: "application/json" }, cache: "no-store" }, options || {})); const payload = await response.json().catch(() => null); if (!response.ok || !payload || payload.ok === false) throw new Error(payload && (payload.message || payload.error) || "Autopilot verzoek mislukt."); return payload; }
  async function refresh() { try { render(await json(STATUS_URL)); } catch (_) { if (byId("coldmailAutopilotStatus")) byId("coldmailAutopilotStatus").textContent = "Status niet beschikbaar"; } }
  async function toggle() { if (busy) return; busy = true; render(state);
    const enabled = !(state && state.enabled);
    try { render(await json(SETTINGS_URL, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ enabled, config: buildAutopilotConfig(), schedule: { timezone: "Europe/Amsterdam", weekdaysOnly: true, startHour: 9, endHour: 17, minIntervalMinutes: 12 } }) })); if (typeof global.showToast === "function") global.showToast(enabled ? "Autopilot staat aan." : "Autopilot staat uit."); }
    catch (error) { if (typeof global.showToast === "function") global.showToast(String(error && error.message || "Autopilot kon niet worden opgeslagen.")); }
    finally { busy = false; render(state); }
  }
  function init() { if (isLeadGenerator() || !injectUi()) return; void refresh(); global.setInterval(refresh, 60000); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window);
