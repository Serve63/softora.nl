(function (global) {
    "use strict";

    const ENDPOINT = "/api/premium-database/current-campaign-media";
    const BATCH_SIZE = 50;
    const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;

    function text(value) { return String(value || "").trim(); }
    function hasMedia(customer) { return Boolean(text(customer && customer.websitePhoto) && text(customer && customer.websiteMockup)); }
    function needsMedia(customer, nowMs) {
        const expiry = Date.parse(text(customer && customer.signedUrlExpiresAt));
        return !hasMedia(customer) || (Number.isFinite(expiry) && expiry <= nowMs + REFRESH_BEFORE_EXPIRY_MS);
    }

    function createController(options) {
        const state = options.state;
        let inFlight = null;

        async function refresh() {
            if (inFlight) return inFlight;
            const ids = Array.from(new Set((Array.isArray(state.klanten) ? state.klanten : [])
                .filter(options.isCurrentCampaignCustomer)
                .filter(function (customer) { return needsMedia(customer, Date.now()); })
                .map(function (customer) { return text(customer && customer.id); })
                .filter(function (id) { return id && id.length <= 128 && /^[a-zA-Z0-9._:-]+$/.test(id); })));
            if (!ids.length) return false;
            inFlight = (async function () {
                const photoMap = {};
                for (let index = 0; index < ids.length; index += BATCH_SIZE) {
                    const batch = ids.slice(index, index + BATCH_SIZE);
                    const response = await options.fetchJsonWithTimeout(ENDPOINT + "?ids=" + encodeURIComponent(batch.join(",")), { method: "GET", cache: "no-store" }, 20000);
                    if (!response.ok) throw new Error("Webdesigns laden mislukt (" + response.status + ")");
                    const payload = await response.json();
                    if (!payload || payload.ok !== true || !Array.isArray(payload.media)) throw new Error("Webdesignrespons was ongeldig.");
                    payload.media.forEach(function (item) {
                        const id = text(item && item.customerId);
                        if (!batch.includes(id) || (!text(item.websitePhoto) && !text(item.websiteMockup))) return;
                        photoMap[id] = item;
                    });
                }
                if (!Object.keys(photoMap).length) return false;
                const current = Array.isArray(state.klanten) ? state.klanten : [];
                const merged = options.mergeCustomersWithPhotos(current, photoMap, current, true).map(function (customer) {
                    const media = photoMap[text(customer && customer.id)];
                    return media ? Object.assign({}, customer, { signedUrlExpiresAt: text(media.signedUrlExpiresAt) }) : customer;
                });
                options.applyCustomerList(merged, false, false);
                return true;
            })().catch(function (error) {
                if (global.console && typeof global.console.warn === "function") global.console.warn("Campagnewebdesigns laden mislukt:", error);
                return false;
            }).finally(function () { inFlight = null; });
            return inFlight;
        }

        return { refresh: refresh };
    }

    const api = { createController: createController, needsMedia: needsMedia };
    global.SoftoraDatabaseCurrentCampaignMedia = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
