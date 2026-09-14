(function (global) {
  "use strict";

  const SAFE_UPLOAD_ENDPOINT = "/api/outreach/provider-upload";
  const DELIVERY_SYNC_ENDPOINT = "/api/outreach/provider-sync";
  const STATUS_ENDPOINT = "/api/outreach/provider-status";
  const MAX_LIMIT = 1000;

  function normalizeString(value) {
    return String(value || "").trim();
  }

  function showToast(message, duration) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = normalizeString(message);
    toast.classList.add("on");
    global.clearTimeout(showToast.timer);
    showToast.timer = global.setTimeout(function () { toast.classList.remove("on"); }, duration || 4200);
  }

  function setHint(message, failed) {
    const hint = document.getElementById("instantlyReplacementStatus");
    if (!hint) return;
    hint.textContent = normalizeString(message);
    hint.style.color = failed ? "#b42318" : "";
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = Boolean(busy);
    button.textContent = label || (busy ? "Bezig..." : "Vervang wachtlijst");
  }

  async function readJson(response) {
    return response.json().catch(function () { return {}; });
  }

  function getLimit() {
    const input = document.getElementById("instantlyReplacementCount");
    const value = Math.floor(Number(input && input.value));
    if (!Number.isFinite(value) || value < 1 || value > MAX_LIMIT) {
      throw new Error("Kies een aantal tussen 1 en " + MAX_LIMIT.toLocaleString("nl-NL") + ".");
    }
    return value;
  }

  async function loadStatus(button) {
    const response = await fetch(STATUS_ENDPOINT, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload = await readJson(response);
    if (!response.ok || payload.ok !== true) throw new Error(payload.message || "Instantly-status kon niet worden geladen.");
    if (!payload.replacementCampaignsConfigured) {
      button.disabled = true;
      setHint("De wachtlijsten van Servé en Martijn zijn nog niet gekoppeld.", true);
      return;
    }
    setHint("Alleen nog niet verstuurde leads worden vervangen; verstuurde leads blijven bewaard.", false);
  }

  async function refreshConfirmedDeliveries() {
    const response = await fetch(DELIVERY_SYNC_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ deliveryStatusOnly: true, actor: "Database verzendstatus" }),
    });
    const payload = await readJson(response);
    if (!response.ok || payload.ok !== true) return;
    if (Number(payload.updated || 0) > 0) global.location.reload();
  }

  async function replaceWaitingList(button) {
    let limit;
    try {
      limit = getLimit();
    } catch (error) {
      setHint(error.message, true);
      return;
    }
    setBusy(button, true, "Vervangen...");
    setHint("De nieuwe veilige wachtlijst wordt verdeeld over Servé en Martijn...", false);
    let reloadScheduled = false;
    try {
      const response = await fetch(SAFE_UPLOAD_ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "replace",
          limit: limit,
          actor: "Database Instantly-wachtlijst vervangen",
        }),
      });
      const payload = await readJson(response);
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message || "De Instantly-wachtlijst kon niet worden vervangen.");
      }
      if (payload.skipped) {
        const available = Number(payload.available || 0);
        const message = "Zet eerst genoeg mail-ready leads klaar. Gevraagd: " + limit.toLocaleString("nl-NL") + ", veilig klaar: " + available.toLocaleString("nl-NL") + ".";
        setHint(message, true);
        showToast(message, 6200);
        return;
      }
      const distribution = payload.distribution || {};
      const message = Number(payload.uploaded || 0).toLocaleString("nl-NL") + " leads staan klaar in Instantly: " + Number(distribution.serve || 0).toLocaleString("nl-NL") + " voor Servé en " + Number(distribution.martijn || 0).toLocaleString("nl-NL") + " voor Martijn.";
      setHint(message, false);
      showToast("✓ " + message, 6200);
      reloadScheduled = true;
      global.setTimeout(function () { global.location.reload(); }, 1100);
    } catch (error) {
      const message = normalizeString(error && error.message) || "De Instantly-wachtlijst kon niet worden vervangen.";
      setHint(message, true);
      showToast(message, 7000);
    } finally {
      if (!reloadScheduled) setBusy(button, false);
    }
  }

  function bind() {
    const button = document.getElementById("instantOutreachSyncButton");
    if (!button || button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      void replaceWaitingList(button);
    });
    loadStatus(button).catch(function (error) {
      button.disabled = true;
      setHint(normalizeString(error && error.message) || "Instantly-status is tijdelijk niet beschikbaar.", true);
    });
    void refreshConfirmedDeliveries();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
})(typeof window !== "undefined" ? window : globalThis);
