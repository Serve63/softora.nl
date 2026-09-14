(function (global) {
  "use strict";

  async function refreshConfirmedDeliveries() {
    try {
      const response = await fetch("/api/outreach/provider-sync", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryStatusOnly: true, actor: "Database verzendstatus" }),
      });
      const payload = await response.json().catch(function () { return {}; });
      if (response.ok && payload.ok === true && Number(payload.updated || 0) > 0) global.location.reload();
    } catch (error) {
      console.warn("Instantly-verzendstatus kon niet worden bijgewerkt:", error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refreshConfirmedDeliveries, { once: true });
  else void refreshConfirmedDeliveries();
})(typeof window !== "undefined" ? window : globalThis);
