(function (global) {
    "use strict";

    const ENDPOINT = "/api/premium-database/mail-ready-snapshot";

    function isSnapshotMailReadyCustomer(customer) {
        return Boolean(customer && customer.mailReadySnapshot === true && customer.mailReady === true);
    }

    function normalizeSnapshotCustomer(raw, index, normalizeCustomer) {
        const normalized = typeof normalizeCustomer === "function" ? normalizeCustomer(raw, "mail-ready-snapshot-" + index) : Object.assign({}, raw || {});
        return Object.assign({}, normalized, {
            hasPhoto: raw && raw.hasPhoto === true,
            hasMockup: raw && raw.hasMockup === true,
            websitePhotoAssetReady: raw && (raw.websitePhotoAssetReady === true || raw.hasPhoto === true),
            websiteMockupAssetReady: raw && (raw.websiteMockupAssetReady === true || raw.hasMockup === true),
            mailReady: raw && raw.mailReady === true,
            mailReadySnapshot: true
        });
    }

    function normalizeMatchValue(value) {
        return String(value || "").trim().toLowerCase();
    }

    function getMatchKeys(customer) {
        const rawWebsite = normalizeMatchValue(customer && (customer.website || customer.dom)).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
        return [
            normalizeMatchValue(customer && customer.id),
            normalizeMatchValue(customer && customer.email),
            rawWebsite,
            normalizeMatchValue(customer && customer.bedrijf)
        ].filter(Boolean);
    }

    function buildSnapshotMap(snapshotCustomers) {
        const map = new Map();
        (Array.isArray(snapshotCustomers) ? snapshotCustomers : []).forEach(function (customer) {
            if (!isSnapshotMailReadyCustomer(customer)) return;
            getMatchKeys(customer).forEach(function (key) {
                if (!map.has(key)) map.set(key, customer);
            });
        });
        return map;
    }

    function mergeAssetFlags(customers, snapshotCustomers) {
        const snapshotMap = buildSnapshotMap(snapshotCustomers);
        if (!snapshotMap.size) return customers || [];
        return (customers || []).map(function (customer) {
            const match = getMatchKeys(customer).map(function (key) { return snapshotMap.get(key); }).find(Boolean);
            if (!match) return customer;
            return Object.assign({}, customer, {
                hasPhoto: true,
                hasMockup: true,
                websitePhotoAssetReady: true,
                websiteMockupAssetReady: true
            });
        });
    }

    function getDisplayCount(state, currentCount) {
        const count = Math.max(0, Number(currentCount) || 0);
        if (!state || !state.mailReadySnapshotLoaded || state.remoteCustomersLoaded || state.activeStatus !== "benaderbaar" || !Number.isFinite(Number(state.mailReadySnapshotTotal))) return count;
        return Math.max(count, Number(state.mailReadySnapshotTotal));
    }

    async function load(options) {
        const config = options || {}, state = config.state;
        if (config.databaseHadBootstrapCustomers || !state) return false;
        const fetchJsonWithTimeout = config.fetchJsonWithTimeout || (global.SoftoraDatabaseResilience && global.SoftoraDatabaseResilience.fetchJsonWithTimeout);
        if (typeof fetchJsonWithTimeout !== "function") return false;
        try {
            const response = await fetchJsonWithTimeout(ENDPOINT + "?limit=50&offset=0", { method: "GET", cache: "no-store" }, 2500);
            if (!response.ok) throw new Error("Mailklare snapshot laden mislukt (" + response.status + ")");
            const payload = await response.json().catch(function () { return {}; });
            const rows = Array.isArray(payload && payload.customers) ? payload.customers : [];
            if (!payload || payload.ok !== true || !rows.length) return false;
            const snapshotCustomers = rows.map(function (row, index) { return normalizeSnapshotCustomer(row, index, config.normalizeCustomer); }).filter(function (customer) { return customer && customer.id; });
            if (!snapshotCustomers.length) return false;
            state.mailReadySnapshotLoaded = true; state.mailReadySnapshotFailed = false; state.mailReadySnapshotTotal = Math.max(snapshotCustomers.length, Number(payload.total) || 0); state.dataUnavailable = false;
            state.mailReadySnapshotCustomers = snapshotCustomers;
            if (typeof config.applyCustomerList === "function") config.applyCustomerList(snapshotCustomers, true);
            return true;
        } catch (error) {
            state.mailReadySnapshotFailed = true;
            const logger = config.logger || global.console;
            if (logger && typeof logger.warn === "function") logger.warn("Mailklare snapshot tijdelijk overgeslagen:", error);
            return false;
        }
    }

    global.SoftoraDatabaseMailReadySnapshot = { endpoint: ENDPOINT, isSnapshotMailReadyCustomer: isSnapshotMailReadyCustomer, normalizeCustomer: normalizeSnapshotCustomer, mergeAssetFlags: mergeAssetFlags, getDisplayCount: getDisplayCount, load: load };
})(window);
