(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.SoftoraDatabaseInstantlyStatus = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    const CONFIRMED = new Set(["sent", "email_sent", "opened", "email_opened", "reply_received", "replied", "email_replied"]);
    const READY = new Set(["queued", "synced", "active", "paused", "completed", ""]);
    const BLOCKED = new Set(["bounced", "unsubscribed", "blocked", "interested", "provider_not_found"]);
    const FINISHED_DATABASE = new Set(["klant", "interesse", "afspraak", "afgehaakt", "geblokkeerd", "buiten"]);
    const CURRENT_CAMPAIGNS = new Map([
        ["6ba410c6-d97a-4186-a414-83ba95022b1a", "serve"],
        ["9a603e82-7a50-46e2-855a-5a2990a9304b", "martijn"]
    ]);

    function text(value) { return String(value || "").trim(); }
    function status(customer) { return text(customer && (customer.instantlyStatus || customer.lastColdmailProviderStatus)).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
    function hasSignal(customer) { return Boolean(customer) && Boolean(text(customer.instantlyLeadId || customer.instantlyCampaignId || customer.instantlyStatus || customer.instantlySyncedAt || customer.instantlyLastEventAt || customer.instantlyEmailSentAt || (text(customer.lastColdmailProvider).toLowerCase() === "instantly" ? "instantly" : ""))); }
    function isProviderPrepared(customer) { return Boolean(customer) && Boolean(text(customer.instantlyLeadId || customer.instantlyCampaignId || customer.instantlyManualUploadId || customer.instantlySyncedAt || customer.instantlyLastEventAt || customer.instantlyStatus)); }
    function isConfirmedSent(customer) { return Boolean(customer) && (Boolean(text(customer.instantlyEmailSentAt || customer.lastInstantlySentAt || customer.instantlySentAt)) || CONFIRMED.has(status(customer))); }
    function getCurrentCampaignOwner(customer) { return CURRENT_CAMPAIGNS.get(text(customer && customer.instantlyCampaignId)) || ""; }
    function isCurrentCampaignPrepared(customer, normalizeDatabaseStatus) {
        if (!customer || !text(customer.instantlyLeadId) || !getCurrentCampaignOwner(customer) || isConfirmedSent(customer)) return false;
        const databaseStatus = typeof normalizeDatabaseStatus === "function" ? normalizeDatabaseStatus(customer.status, customer) : text(customer.status).toLowerCase();
        return !FINISHED_DATABASE.has(databaseStatus) && !BLOCKED.has(status(customer)) && READY.has(status(customer));
    }
    function hasDesign(customer) { return Boolean(customer && (customer.websitePhotoAssetReady === true || customer.hasPhoto === true || text(customer.websitePhoto)) && (customer.websiteMockupAssetReady === true || customer.hasMockup === true || text(customer.websiteMockup))); }
    function isReady(customer, normalizeDatabaseStatus) {
        if ((!hasSignal(customer) && text(customer && customer.webdesignMailProvider).toLowerCase() !== "instantly") || !hasDesign(customer) || isConfirmedSent(customer)) return false;
        const databaseStatus = typeof normalizeDatabaseStatus === "function" ? normalizeDatabaseStatus(customer && customer.status, customer) : text(customer && customer.status).toLowerCase();
        const providerStatus = status(customer);
        return !FINISHED_DATABASE.has(databaseStatus) && !BLOCKED.has(providerStatus) && READY.has(providerStatus);
    }

    function isWaitingForDesign(customer, normalizeDatabaseStatus) {
        if (!hasSignal(customer) || hasDesign(customer) || isConfirmedSent(customer)) return false;
        const databaseStatus = typeof normalizeDatabaseStatus === "function" ? normalizeDatabaseStatus(customer && customer.status, customer) : text(customer && customer.status).toLowerCase();
        return !FINISHED_DATABASE.has(databaseStatus) && !BLOCKED.has(status(customer)) && READY.has(status(customer));
    }

    function isReadyForUpload(customer, normalizeDatabaseStatus) {
        return isReady(customer, normalizeDatabaseStatus) && !isProviderPrepared(customer);
    }

    return { getCurrentCampaignOwner, hasSignal, hasDesign, isConfirmedSent, isCurrentCampaignPrepared, isProviderPrepared, isReady, isReadyForUpload, isWaitingForDesign, status };
});
