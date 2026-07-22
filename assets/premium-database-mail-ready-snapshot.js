(function (global) {
    "use strict";

    const ENDPOINT = "/api/premium-database/mail-ready-snapshot";
    const PAGE_LIMIT = 3000;
    const MAX_SNAPSHOT_ROWS = 3000;
    const FIRST_PAGE_TIMEOUT_MS = 6000;
    const NEXT_PAGE_TIMEOUT_MS = 4500;
    const PAGE_CONCURRENCY = 3;
    const RESTORE_RETRY_DELAYS_MS = [2000, 6000, 15000, 30000];

    function isSnapshotMailReadyCustomer(customer) {
        return Boolean(customer && customer.mailReadySnapshot === true && customer.mailReady === true);
    }

    function isSnapshotAvailableCustomer(customer) {
        return Boolean(customer && customer.availableSnapshot === true && customer.mailReady !== true);
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

    function normalizeAvailableSnapshotCustomer(raw, index, normalizeCustomer) {
        const normalized = typeof normalizeCustomer === "function" ? normalizeCustomer(raw, "available-snapshot-" + index) : Object.assign({}, raw || {});
        return Object.assign({}, normalized, {
            hasPhoto: raw && raw.hasPhoto === true,
            hasMockup: raw && raw.hasMockup === true,
            websitePhotoAssetReady: raw && raw.hasPhoto === true,
            websiteMockupAssetReady: raw && raw.hasMockup === true,
            mailReady: false,
            mailReadySnapshot: false,
            availableSnapshot: true
        });
    }

    function normalizeMatchValue(value) {
        return String(value || "").trim().toLowerCase();
    }

    function dedupeCustomers(customers) {
        const seenIds = new Set();
        return (Array.isArray(customers) ? customers : []).filter(function (customer) {
            const id = normalizeMatchValue(customer && customer.id);
            if (!id || seenIds.has(id)) return false;
            seenIds.add(id);
            return true;
        });
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

    function buildSnapshotMap(snapshotCustomers, predicate) {
        const map = new Map();
        (Array.isArray(snapshotCustomers) ? snapshotCustomers : []).forEach(function (customer) {
            if (typeof predicate === "function" && !predicate(customer)) return;
            getMatchKeys(customer).forEach(function (key) {
                if (!map.has(key)) map.set(key, customer);
            });
        });
        return map;
    }

    function findSnapshotMatch(snapshotMap, customer) {
        return getMatchKeys(customer).map(function (key) { return snapshotMap.get(key); }).find(Boolean);
    }

    function mergeSnapshotMedia(customer, snapshotMatch, isMailReady) {
        const match = snapshotMatch || {};
        const hasPhoto = isMailReady ? true : match.hasPhoto === true;
        const hasMockup = isMailReady ? true : match.hasMockup === true;
        return Object.assign({}, customer, {
            websitePhoto: hasPhoto ? String(match.websitePhoto || customer.websitePhoto || "").trim() : "",
            websitePhotoName: String(match.websitePhotoName || customer.websitePhotoName || "").trim(),
            websiteMockup: hasMockup ? String(match.websiteMockup || customer.websiteMockup || "").trim() : "",
            websiteMockupName: String(match.websiteMockupName || customer.websiteMockupName || "").trim(),
            signedUrlExpiresAt: String(match.signedUrlExpiresAt || customer.signedUrlExpiresAt || "").trim(),
            hasPhoto: hasPhoto,
            hasMockup: hasMockup,
            websitePhotoAssetReady: hasPhoto,
            websiteMockupAssetReady: hasMockup,
            mailReady: Boolean(isMailReady),
            mailReadySnapshot: Boolean(isMailReady),
            availableSnapshot: !isMailReady
        });
    }

    function mergeAssetFlags(customers, snapshotCustomers, availableSnapshotCustomers) {
        const snapshotMap = buildSnapshotMap(snapshotCustomers, isSnapshotMailReadyCustomer);
        const availableMap = buildSnapshotMap(availableSnapshotCustomers, isSnapshotAvailableCustomer);
        if (!snapshotMap.size && !availableMap.size) return dedupeCustomers(customers);
        return dedupeCustomers(customers).map(function (customer) {
            const mailReadyMatch = findSnapshotMatch(snapshotMap, customer);
            const availableMatch = findSnapshotMatch(availableMap, customer);
            if (mailReadyMatch) return mergeSnapshotMedia(customer, mailReadyMatch, true);
            if (availableMatch) return mergeSnapshotMedia(customer, availableMatch, false);
            if (customer && (customer.mailReadySnapshot === true || customer.availableSnapshot === true)) return Object.assign({}, customer, { mailReady: false, mailReadySnapshot: false, availableSnapshot: false });
            return customer;
        });
    }

    function moveCustomerToAvailable(state, customer) {
        const id = normalizeMatchValue(customer && customer.id);
        if (!state || !id) return customer;
        const readyCustomers = dedupeCustomers(state.mailReadySnapshotCustomers);
        const availableCustomers = dedupeCustomers(state.availableSnapshotCustomers);
        const wasReady = readyCustomers.some(function (item) { return normalizeMatchValue(item && item.id) === id; });
        const wasAvailable = availableCustomers.some(function (item) { return normalizeMatchValue(item && item.id) === id; });
        const availableCustomer = Object.assign({}, customer, {
            websitePhoto: "",
            websitePhotoName: "",
            websiteMockup: "",
            websiteMockupName: "",
            mockupRenderer: "",
            mockupOrientation: "",
            mockupQualityStatus: "",
            mockupQualityCheckedAt: "",
            signedUrlExpiresAt: "",
            hasPhoto: false,
            hasMockup: false,
            websitePhotoAssetReady: false,
            websiteMockupAssetReady: false,
            mailReady: false,
            mailReadySnapshot: false,
            availableSnapshot: true
        });
        state.mailReadySnapshotCustomers = readyCustomers.filter(function (item) { return normalizeMatchValue(item && item.id) !== id; });
        state.availableSnapshotCustomers = dedupeCustomers([availableCustomer].concat(availableCustomers.filter(function (item) { return normalizeMatchValue(item && item.id) !== id; })));
        if (state.mailReadySnapshotLoaded && wasReady) state.mailReadySnapshotTotal = Math.max(0, Number(state.mailReadySnapshotTotal) - 1 || 0);
        if (state.availableSnapshotLoaded && !wasAvailable) state.availableSnapshotTotal = Math.max(0, Number(state.availableSnapshotTotal) || 0) + 1;
        return availableCustomer;
    }

    function mergeWithCanonicalSnapshots(customers, snapshotCustomers, availableSnapshotCustomers) {
        const remoteCustomers = dedupeCustomers(customers);
        const snapshotRows = dedupeCustomers(snapshotCustomers).filter(isSnapshotMailReadyCustomer);
        const availableRows = dedupeCustomers(availableSnapshotCustomers).filter(isSnapshotAvailableCustomer);
        if (!snapshotRows.length && !availableRows.length) return remoteCustomers;
        const remoteMap = buildSnapshotMap(remoteCustomers);
        const consumed = new Set();
        const canonical = snapshotRows.map(function (snapshotCustomer) {
            const remoteMatch = findSnapshotMatch(remoteMap, snapshotCustomer);
            if (remoteMatch) consumed.add(remoteMatch);
            return mergeSnapshotMedia(Object.assign({}, snapshotCustomer, remoteMatch || {}), snapshotCustomer, true);
        }).concat(availableRows.map(function (snapshotCustomer) {
            const remoteMatch = findSnapshotMatch(remoteMap, snapshotCustomer);
            if (remoteMatch) consumed.add(remoteMatch);
            return mergeSnapshotMedia(Object.assign({}, snapshotCustomer, remoteMatch || {}), snapshotCustomer, false);
        }));
        return canonical.concat(remoteCustomers.filter(function (customer) { return !consumed.has(customer); }));
    }

    function getDisplayCount(state, currentCount) {
        const count = Math.max(0, Number(currentCount) || 0);
        if (state && String(state.query || "").trim()) return count;
        if (!state) return count;
        if (state.activeStatus === "benaderbaar" && state.mailReadySnapshotLoaded && Number.isFinite(Number(state.mailReadySnapshotTotal))) return Math.max(0, Number(state.mailReadySnapshotTotal));
        if (state.activeStatus === "beschikbaar" && state.availableSnapshotLoaded && Number.isFinite(Number(state.availableSnapshotTotal))) return Math.max(0, Number(state.availableSnapshotTotal));
        return count;
    }

    function clearRetry(state) {
        if (!state) return;
        if (state.mailReadySnapshotRetryTimer && typeof global.clearTimeout === "function") {
            global.clearTimeout(state.mailReadySnapshotRetryTimer);
        }
        state.mailReadySnapshotRetryTimer = null;
        state.mailReadySnapshotRetryAttempt = 0;
    }

    function scheduleRetry(config) {
        const state = config && config.state;
        if (!state || state.mailReadySnapshotRetryTimer || typeof global.setTimeout !== "function") return;
        const attempt = Math.max(0, Number(state.mailReadySnapshotRetryAttempt) || 0);
        const delay = RESTORE_RETRY_DELAYS_MS[attempt];
        if (!Number.isFinite(Number(delay))) return;
        state.mailReadySnapshotPending = true;
        state.mailReadySnapshotRetryAttempt = attempt + 1;
        state.mailReadySnapshotRetryTimer = global.setTimeout(function () {
            state.mailReadySnapshotRetryTimer = null;
            void load(Object.assign({}, config, { retry: true }));
        }, delay);
    }

    function buildEndpoint(limit, offset) {
        return ENDPOINT + "?limit=" + encodeURIComponent(limit) + "&offset=" + encodeURIComponent(offset);
    }

    async function fetchSnapshotPage(config, limit, offset, timeoutMs) {
        const response = await config.fetchJsonWithTimeout(buildEndpoint(limit, offset), { method: "GET", cache: "no-store" }, timeoutMs);
        if (!response.ok) throw new Error("Mailklare snapshot laden mislukt (" + response.status + ")");
        const payload = await response.json().catch(function () { return {}; });
        if (!payload || payload.ok !== true) throw new Error(String(payload && (payload.detail || payload.error) || "Mailklare snapshot gaf geen geldige data terug."));
        const rows = Array.isArray(payload.customers) ? payload.customers : [];
        const total = Math.max(rows.length + offset, Number(payload.total) || 0);
        return { payload: payload, rows: rows, total: total, generatedAt: String(payload.generatedAt || "").trim() };
    }

    function normalizeSnapshotRows(rows, offset, normalizeCustomer) {
        return dedupeCustomers((Array.isArray(rows) ? rows : []).map(function (row, index) {
            return normalizeSnapshotCustomer(row, offset + index, normalizeCustomer);
        }).filter(function (customer) { return customer && customer.id; }));
    }

    function publishSnapshot(config, snapshotCustomers, total, availableCustomers, availableTotal, generatedAt, pending) {
        const state = config.state;
        const incomingGeneratedAtMs = Date.parse(String(generatedAt || "").trim()) || 0;
        const currentGeneratedAtMs = Math.max(0, Number(state.mailReadySnapshotGeneratedAtMs) || 0);
        if (incomingGeneratedAtMs && currentGeneratedAtMs && incomingGeneratedAtMs < currentGeneratedAtMs) return false;
        state.mailReadySnapshotLoaded = true;
        state.mailReadySnapshotStale = false;
        state.mailReadySnapshotFailed = false;
        state.mailReadySnapshotPending = Boolean(pending);
        if (incomingGeneratedAtMs) state.mailReadySnapshotGeneratedAtMs = incomingGeneratedAtMs;
        state.mailReadySnapshotTotal = pending ? Math.max(snapshotCustomers.length, Number(total) || 0) : snapshotCustomers.length;
        state.mailReadySnapshotCustomers = snapshotCustomers;
        state.availableSnapshotLoaded = true;
        state.availableSnapshotTotal = availableCustomers.length;
        state.availableSnapshotCustomers = availableCustomers;
        state.dataUnavailable = false;
        clearRetry(state);
        if (typeof config.applyCustomerList === "function") {
            const currentCustomers = Array.isArray(state.klanten) ? state.klanten : [];
            const currentIsSnapshotOnly = currentCustomers.length && currentCustomers.every(function (customer) { return isSnapshotMailReadyCustomer(customer) || isSnapshotAvailableCustomer(customer); });
            const combinedSnapshotCustomers = dedupeCustomers(snapshotCustomers.concat(availableCustomers));
            config.applyCustomerList(currentCustomers.length && !currentIsSnapshotOnly ? mergeWithCanonicalSnapshots(currentCustomers, snapshotCustomers, availableCustomers) : combinedSnapshotCustomers, false);
        }
        return true;
    }

    async function fetchRemainingPages(config, total, firstRows) {
        const maxRows = Math.min(MAX_SNAPSHOT_ROWS, Math.max(0, Number(total) || 0));
        const offsets = [];
        for (let offset = PAGE_LIMIT; offset < maxRows; offset += PAGE_LIMIT) offsets.push(offset);
        const pages = [];
        let cursor = 0;
        async function worker() {
            while (cursor < offsets.length) {
                const offset = offsets[cursor];
                cursor += 1;
                const page = await fetchSnapshotPage(config, PAGE_LIMIT, offset, NEXT_PAGE_TIMEOUT_MS);
                pages.push({ offset: offset, rows: page.rows });
            }
        }
        await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, offsets.length) }, worker));
        return firstRows.concat(pages.sort(function (left, right) { return left.offset - right.offset; }).flatMap(function (page) { return page.rows; }));
    }

    async function load(options) {
        const config = options || {}, state = config.state;
        if (!state) return false;
        const fetchJsonWithTimeout = config.fetchJsonWithTimeout || (global.SoftoraDatabaseResilience && global.SoftoraDatabaseResilience.fetchJsonWithTimeout);
        if (typeof fetchJsonWithTimeout !== "function") return false;
        config.fetchJsonWithTimeout = fetchJsonWithTimeout;
        state.mailReadySnapshotPending = true;
        try {
            const firstPage = await fetchSnapshotPage(config, PAGE_LIMIT, 0, FIRST_PAGE_TIMEOUT_MS);
            let snapshotCustomers = normalizeSnapshotRows(firstPage.rows, 0, config.normalizeCustomer);
            let availableCustomers = normalizeAvailableSnapshotRows(firstPage.payload.availableCustomers, 0, config.normalizeCustomer);
            const hasRemainingPages = firstPage.total > firstPage.rows.length;
            const published = publishSnapshot(config, snapshotCustomers, firstPage.total, availableCustomers, firstPage.payload.availableTotal, firstPage.generatedAt, hasRemainingPages);
            if (!published) { state.mailReadySnapshotPending = false; return false; }
            if (hasRemainingPages && firstPage.rows.length < MAX_SNAPSHOT_ROWS) {
                try {
                    const allRows = await fetchRemainingPages(config, firstPage.total, firstPage.rows);
                    snapshotCustomers = normalizeSnapshotRows(allRows, 0, config.normalizeCustomer);
                    publishSnapshot(config, snapshotCustomers, firstPage.total, availableCustomers, firstPage.payload.availableTotal, firstPage.generatedAt, false);
                } catch (error) {
                    state.mailReadySnapshotFailed = true;
                    state.mailReadySnapshotPending = true;
                    scheduleRetry(config);
                    const logger = config.logger || global.console;
                    if (logger && typeof logger.warn === "function") logger.warn("Mailklare snapshot vervolgpaginering tijdelijk overgeslagen:", error);
                }
            } else {
                state.mailReadySnapshotPending = false;
            }
            return true;
        } catch (error) {
            state.mailReadySnapshotFailed = true;
            scheduleRetry(config);
            const logger = config.logger || global.console;
            if (logger && typeof logger.warn === "function") logger.warn("Mailklare snapshot tijdelijk overgeslagen:", error);
            return false;
        }
    }

    function normalizeAvailableSnapshotRows(rows, offset, normalizeCustomer) {
        return dedupeCustomers((Array.isArray(rows) ? rows : []).map(function (row, index) {
            return normalizeAvailableSnapshotCustomer(row, offset + index, normalizeCustomer);
        }).filter(function (customer) { return customer && customer.id; }));
    }

    global.SoftoraDatabaseMailReadySnapshot = { endpoint: ENDPOINT, isSnapshotMailReadyCustomer: isSnapshotMailReadyCustomer, isSnapshotAvailableCustomer: isSnapshotAvailableCustomer, normalizeCustomer: normalizeSnapshotCustomer, normalizeAvailableCustomer: normalizeAvailableSnapshotCustomer, dedupeCustomers: dedupeCustomers, mergeAssetFlags: mergeAssetFlags, moveCustomerToAvailable: moveCustomerToAvailable, mergeWithCanonicalSnapshots: mergeWithCanonicalSnapshots, getDisplayCount: getDisplayCount, load: load };
})(window);
