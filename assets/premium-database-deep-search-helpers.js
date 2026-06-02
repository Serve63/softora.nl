(function (global) {
    "use strict";

    function normalizeString(value) {
        return String(value == null ? "" : value).trim();
    }

    function normalizeKey(value) {
        return normalizeString(value)
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "");
    }

    function normalizeExistingWebsiteDomain(value) {
        const raw = normalizeString(value)
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "")
            .replace(/\/.*$/, "")
            .trim();
        return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(raw) ? raw : "";
    }

    function collectCustomerMatchKeys(customer) {
        const keys = [];
        const email = normalizeString(customer && customer.email).toLowerCase();
        const domain = normalizeExistingWebsiteDomain(customer && (customer.website || customer.dom || customer.url || customer.site));
        const company = normalizeKey(customer && (customer.bedrijf || customer.bedrijfsnaam || customer.company || customer.companyName || customer.naam));
        const address = normalizeKey(customer && (customer.stad || customer.adres || customer.address || customer.location));
        if (email && email !== "—") keys.push("email:" + email);
        if (domain && domain !== "onbekend.nl") keys.push("domain:" + domain);
        if (company && address && address !== "onbekend") keys.push("company-address:" + company + "|" + address);
        return keys;
    }

    function collectNewCustomersAfterImport(beforeCustomers, afterCustomers, limit) {
        const beforeKeys = new Set();
        (Array.isArray(beforeCustomers) ? beforeCustomers : []).forEach(function (customer) {
            collectCustomerMatchKeys(customer).forEach(function (key) { beforeKeys.add(key); });
        });
        const maxItems = Math.max(0, Number(limit) || 0);
        if (maxItems <= 0) return [];
        const result = [];
        (Array.isArray(afterCustomers) ? afterCustomers : []).forEach(function (customer) {
            if (result.length >= maxItems) return;
            const keys = collectCustomerMatchKeys(customer);
            if (!keys.length || keys.some(function (key) { return beforeKeys.has(key); })) return;
            result.push(customer);
        });
        return result;
    }

    const manualCompletedTargetLabels = Object.freeze(["Nederland | Noord-Brabant | Vught | Helvoirt", "Nederland | Noord-Brabant | Boxtel | Boxtel", "Nederland | Noord-Brabant | Boxtel | Esch", "Nederland | Noord-Brabant | Boxtel | Liempde", "Nederland | Noord-Brabant | Hilvarenbeek | Biest-Houtakker", "Nederland | Noord-Brabant | Hilvarenbeek | Diessen", "Nederland | Noord-Brabant | Hilvarenbeek | Esbeek", "Nederland | Noord-Brabant | Hilvarenbeek | Haghorst"]);
    const HARVEST_PROGRESS_URL = "assets/premium-database-harvest-progress.json";
    const HARVEST_PROGRESS_POLL_MS = 15000;

    function applyManualCompletedTargets(targets, labels, completionReason) {
        const completedKeys = new Set((Array.isArray(labels) ? labels : manualCompletedTargetLabels).map(normalizeKey));
        const reason = normalizeString(completionReason) || "Handmatig afgerond in de verzamellijst.";
        if (!completedKeys.size) return targets || [];
        return (targets || []).map(function (target) {
            return target && completedKeys.has(normalizeKey(target.label)) ? { ...target, status: "done", placeComplete: true, completionReason: normalizeString(target.completionReason) || reason } : target;
        });
    }

    function uniqueLabels(values, maxItems) {
        const seen = new Set();
        const result = [];
        (values || []).forEach(function (value) {
            const label = normalizeString(value);
            const key = normalizeKey(label);
            if (!label || !key || seen.has(key)) return;
            seen.add(key);
            result.push(label);
        });
        return result.slice(0, maxItems || 2000);
    }

    function getCompletedLabelsFromHarvestProgress(payload) {
        const labels = [];
        (Array.isArray(payload && payload.completedTargetLabels) ? payload.completedTargetLabels : []).forEach(function (label) { labels.push(label); });
        (Array.isArray(payload && payload.targetProgress) ? payload.targetProgress : []).forEach(function (item) {
            const completed = Boolean(item && (item.completed || item.placeComplete || item.status === "done" || item.status === "afgerond"));
            const label = normalizeString(item && (item.label || item.target));
            if (completed && label) labels.push(label);
        });
        return uniqueLabels(labels, 3000);
    }

    function readHarvestProgress(globalObject) {
        const fetchImpl = globalObject && typeof globalObject.fetch === "function" ? globalObject.fetch.bind(globalObject) : null;
        if (!fetchImpl) return Promise.resolve(null);
        return fetchImpl(HARVEST_PROGRESS_URL + "?t=" + encodeURIComponent(String(Date.now())), {
            method: "GET",
            cache: "no-store",
            headers: { Accept: "application/json" }
        }).then(function (response) {
            if (!response || !response.ok) return null;
            return response.json().catch(function () { return null; });
        }).catch(function () { return null; });
    }

    function ensureActivePendingTarget(state) {
        if (!state || !Array.isArray(state.targets) || !state.targets.length) return state;
        const activeFromStatus = state.targets.findIndex(function (target) { return target.status === "active"; });
        if (activeFromStatus !== -1 && state.targets[activeFromStatus].status !== "done") state.activeIndex = activeFromStatus;
        const current = state.targets[state.activeIndex];
        if (!current || current.status === "done" || state.targets.every(function (target) { return target.status !== "active"; })) {
            const nextPending = state.targets.findIndex(function (target) { return target.status !== "done"; });
            state.activeIndex = nextPending === -1 ? Math.max(0, state.targets.length - 1) : nextPending;
        }
        state.targets.forEach(function (target, index) {
            if (target.status !== "done") target.status = index === state.activeIndex ? "active" : "pending";
        });
        return state;
    }

    function createHarvestProgressBridge(options) {
        const globalObject = options && options.globalObject;
        const readProgress = typeof options.readHarvestProgress === "function" ? options.readHarvestProgress : function () { return readHarvestProgress(globalObject); };
        const pollDisabled = globalObject && globalObject.__SOFTORA_DISABLE_HARVEST_PROGRESS_POLL;
        const pollMs = pollDisabled || options.pollMs === 0 ? 0 : Math.max(0, Number(options.pollMs) || HARVEST_PROGRESS_POLL_MS);
        let timer = null;
        let requestId = 0;
        function clear() {
            if (!timer) return;
            const clearTimeoutImpl = globalObject && typeof globalObject.clearTimeout === "function" ? globalObject.clearTimeout.bind(globalObject) : null;
            if (clearTimeoutImpl) clearTimeoutImpl(timer);
            timer = null;
        }
        function apply(payload) {
            const state = options.getState();
            const labels = getCompletedLabelsFromHarvestProgress(payload);
            if (!state || !Array.isArray(state.targets) || !labels.length) return false;
            const before = JSON.stringify(state.targets.map(function (target) { return [target.label, target.status, target.placeComplete, target.completionReason]; }));
            state.targets = applyManualCompletedTargets(state.targets, uniqueLabels((options.manualCompletedTargetLabels || []).concat(labels), 3000), "Afgerond in lokale harvest-verzamellijst.");
            ensureActivePendingTarget(state);
            return before !== JSON.stringify(state.targets.map(function (target) { return [target.label, target.status, target.placeComplete, target.completionReason]; }));
        }
        function refresh() {
            const currentRequestId = requestId + 1;
            requestId = currentRequestId;
            return Promise.resolve(readProgress()).then(function (payload) {
                if (requestId !== currentRequestId || !payload || !apply(payload)) return false;
                if (typeof options.render === "function") options.render();
                if (typeof options.persistState === "function") void options.persistState();
                return true;
            }).catch(function () { return false; });
        }
        function schedule() {
            clear();
            if (!pollMs || typeof options.isOpen !== "function" || !options.isOpen()) return;
            const setTimeoutImpl = globalObject && typeof globalObject.setTimeout === "function" ? globalObject.setTimeout.bind(globalObject) : null;
            if (!setTimeoutImpl) return;
            timer = setTimeoutImpl(function () { timer = null; refresh().finally(schedule); }, pollMs);
            if (timer && typeof timer.unref === "function") timer.unref();
        }
        return { clear: clear, refresh: refresh, schedule: schedule };
    }

    global.SoftoraDatabaseDeepSearchHelpers = {
        applyManualCompletedTargets: applyManualCompletedTargets,
        collectCustomerMatchKeys: collectCustomerMatchKeys,
        collectNewCustomersAfterImport: collectNewCustomersAfterImport,
        createHarvestProgressBridge: createHarvestProgressBridge,
        getCompletedLabelsFromHarvestProgress: getCompletedLabelsFromHarvestProgress,
        manualCompletedTargetLabels: manualCompletedTargetLabels,
        normalizeExistingWebsiteDomain: normalizeExistingWebsiteDomain
    };
})(window);
