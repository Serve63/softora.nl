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

        function withExpiry(customer, photoMap) {
            const media = photoMap[text(customer && customer.id)];
            return media ? Object.assign({}, customer, { signedUrlExpiresAt: text(media.signedUrlExpiresAt) }) : customer;
        }

        // Media for a handful of campaign customers used to re-merge all ~20k
        // customers (~0.5 s blocking after the screen was ready). Only customers
        // the full merge could change are merged now: those receiving media by id
        // or identity key, with every customer sharing their identity key as
        // fallback, in list order, exactly as the full merge would see them.
        function mergeReceivedMedia(current, photoMap) {
            const identityOf = options.buildCustomerIdentityKey;
            if (typeof identityOf !== "function") {
                return options.mergeCustomersWithPhotos(current, photoMap, current, true).map(function (customer) {
                    return withExpiry(customer, photoMap);
                });
            }
            const photoKeys = new Set(Object.keys(photoMap).map(function (id) { return text(photoMap[id] && photoMap[id].identityKey); }).filter(Boolean));
            const keys = current.map(function (customer) { return text(identityOf(customer)); });
            const touched = [];
            current.forEach(function (customer, index) {
                if (photoMap[text(customer && customer.id)] || (keys[index] && photoKeys.has(keys[index]))) touched.push(index);
            });
            if (!touched.length) return current;
            const touchedIds = new Set(touched.map(function (index) { return text(current[index] && current[index].id); }));
            const touchedKeys = new Set(touched.map(function (index) { return keys[index]; }).filter(Boolean));
            const fallback = current.filter(function (customer, index) {
                return touchedIds.has(text(customer && customer.id)) || (keys[index] && touchedKeys.has(keys[index]));
            });
            const merged = options.mergeCustomersWithPhotos(touched.map(function (index) { return current[index]; }), photoMap, fallback, true);
            if (!Array.isArray(merged) || merged.length !== touched.length) {
                return options.mergeCustomersWithPhotos(current, photoMap, current, true).map(function (customer) {
                    return withExpiry(customer, photoMap);
                });
            }
            const next = current.slice();
            touched.forEach(function (index, position) { next[index] = withExpiry(merged[position], photoMap); });
            return next;
        }

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
                options.applyCustomerList(mergeReceivedMedia(current, photoMap), false, false);
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
