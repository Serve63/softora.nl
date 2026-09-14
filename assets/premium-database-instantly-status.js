(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.SoftoraDatabaseInstantlyStatus = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    const CONFIRMED = new Set(["sent", "email_sent", "opened", "email_opened", "reply_received", "replied", "email_replied"]);
    const READY = new Set(["queued", "synced", "active", "paused", "completed", ""]);
    const BLOCKED = new Set(["bounced", "unsubscribed", "blocked", "interested"]);
    const FINISHED_DATABASE = new Set(["klant", "interesse", "afspraak", "afgehaakt", "geblokkeerd", "buiten"]);

    function text(value) { return String(value || "").trim(); }
    function status(customer) { return text(customer && (customer.instantlyStatus || customer.lastColdmailProviderStatus)).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
    function hasSignal(customer) { return Boolean(customer) && Boolean(text(customer.instantlyLeadId || customer.instantlyCampaignId || customer.instantlyStatus || customer.instantlySyncedAt || customer.instantlyLastEventAt || customer.instantlyEmailSentAt || (text(customer.lastColdmailProvider).toLowerCase() === "instantly" ? "instantly" : ""))); }
    function isConfirmedSent(customer) { return Boolean(customer) && (Boolean(text(customer.instantlyEmailSentAt || customer.lastInstantlySentAt || customer.instantlySentAt)) || CONFIRMED.has(status(customer))); }
    function isReady(customer, normalizeDatabaseStatus) {
        if (!hasSignal(customer) || isConfirmedSent(customer)) return false;
        const databaseStatus = typeof normalizeDatabaseStatus === "function" ? normalizeDatabaseStatus(customer && customer.status, customer) : text(customer && customer.status).toLowerCase();
        const providerStatus = status(customer);
        return !FINISHED_DATABASE.has(databaseStatus) && !BLOCKED.has(providerStatus) && READY.has(providerStatus);
    }

    return { hasSignal, isConfirmedSent, isReady, status };
});
