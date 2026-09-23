(function (global) {
  "use strict";

  async function refreshConfirmedDeliveries() {
    const controller = typeof global.AbortController === "function" ? new global.AbortController() : null;
    const timeout = controller ? global.setTimeout(function () { controller.abort(); }, 12000) : null;
    try {
      const response = await fetch("/api/outreach/provider-sync", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryStatusOnly: true, actor: "Database verzendstatus" }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      const payload = await response.json().catch(function () { return {}; });
      if (!response.ok || payload.ok !== true) return { ok: false, reason: "provider-sync-unavailable" };
      if (Number(payload.updated || 0) > 0) {
        global.location.reload();
        return { ok: false, reason: "provider-sync-reloading" };
      }
      return { ok: true };
    } catch (error) {
      console.warn("Instantly-verzendstatus kon niet worden bijgewerkt:", error);
      return { ok: false, reason: "provider-sync-failed" };
    } finally {
      if (timeout !== null) global.clearTimeout(timeout);
    }
  }

  const ready = new Promise(function (resolve) {
    const start = function () { void refreshConfirmedDeliveries().then(resolve); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  });
  global.SoftoraDatabaseInstantlySync = Object.freeze({ ready });
})(typeof window !== "undefined" ? window : globalThis);
