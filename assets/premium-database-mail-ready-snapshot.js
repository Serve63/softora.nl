(function (global) {
    "use strict";

    const ENDPOINT = "/api/premium-database/mail-ready-snapshot";
    const PAGE_LIMIT = 3000;
    const BOOTSTRAP_ROW_LIMIT = 100;
    const MAX_SNAPSHOT_ROWS = 25000;
    const FIRST_PAGE_TIMEOUT_MS = 90000;
    const NEXT_PAGE_TIMEOUT_MS = 90000;
    const PAGE_CONCURRENCY = 3;
    const RESTORE_RETRY_DELAYS_MS = [2000, 6000, 15000, 30000];

    function isSnapshotMailReadyCustomer(customer) {
        return Boolean(customer && customer.mailReadySnapshot === true && customer.mailReady === true);
    }

    function isSnapshotAvailableCustomer(customer) {
        return Boolean(customer && customer.availableSnapshot === true && customer.mailReady !== true);
    }

    function normalizeFoundCustomerIds(value) {
        return Array.from(new Set((Array.isArray(value) ? value : []).map(function (id) {
            return String(id == null ? "" : id).trim();
        }).filter(Boolean)));
    }

    function isFoundSnapshotCategoryCoherent(totalRaw, customerIdsRaw) {
        const customerIds = normalizeFoundCustomerIds(customerIdsRaw);
        const total = Math.max(0, Number(totalRaw) || 0);
        return total === customerIds.length;
    }

    function isSnapshotFoundCustomer(customer, customerIdSet) {
        return Boolean(customer && customerIdSet instanceof Set && customerIdSet.has(String(customer.id || "").trim()));
    }

    function isSnapshotCategoryCoherent(totalRaw, rowsRaw) {
        const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
        const total = Math.max(0, Number(totalRaw) || 0);
        return total === rows.length;
    }

    function isSnapshotPageCategoryValid(totalRaw, rowsRaw, offsetRaw) {
        const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
        const total = Math.max(0, Number(totalRaw) || 0);
        const offset = Math.max(0, Number(offsetRaw) || 0);
        if (offset >= total) return rows.length === 0;
        return rows.length === Math.min(PAGE_LIMIT, total - offset);
    }

    function isSnapshotPayloadCoherent(payload) {
        if (!payload || typeof payload !== "object") return false;
        return isSnapshotCategoryCoherent(payload.total, payload.customers) &&
            isSnapshotCategoryCoherent(payload.availableTotal, payload.availableCustomers);
    }

    function isBootstrapSnapshotPayloadCoherent(payload) {
        if (!payload || typeof payload !== "object") return false;
        const rows = Array.isArray(payload.customers) ? payload.customers : [];
        const hasFoundSnapshot = Object.prototype.hasOwnProperty.call(payload, "foundTotal") && Array.isArray(payload.foundCustomerIds);
        return hasFoundSnapshot &&
            isFoundSnapshotCategoryCoherent(payload.foundTotal, payload.foundCustomerIds) &&
            isSnapshotCategoryCoherent(payload.mailReadySnapshotTotal, rows.filter(isSnapshotMailReadyCustomer)) &&
            isSnapshotCategoryCoherent(payload.availableSnapshotTotal, rows.filter(isSnapshotAvailableCustomer));
    }

    function isBootstrapSnapshotCountPayloadCoherent(payload) {
        if (!payload || typeof payload !== "object") return false;
        const rows = Array.isArray(payload.customers) ? payload.customers : [];
        const mailReadyRows = rows.filter(isSnapshotMailReadyCustomer);
        const availableRows = rows.filter(isSnapshotAvailableCustomer);
        const mailReadyTotal = Math.max(0, Number(payload.mailReadySnapshotTotal) || 0);
        const availableTotal = Math.max(0, Number(payload.availableSnapshotTotal) || 0);
        return Boolean(String(payload.generatedAt || "").trim()) &&
            mailReadyRows.length === Math.min(mailReadyTotal, BOOTSTRAP_ROW_LIMIT) &&
            availableRows.length === Math.min(availableTotal, BOOTSTRAP_ROW_LIMIT) &&
            isFoundSnapshotCategoryCoherent(payload.foundTotal, payload.foundCustomerIds);
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
        if (state.canonicalCountReady === true && state.activeStatus === "benaderbaar" && Number.isFinite(Number(state.mailReadySnapshotTotal))) return Math.max(0, Number(state.mailReadySnapshotTotal));
        if (state.canonicalCountReady === true && state.activeStatus === "beschikbaar" && Number.isFinite(Number(state.availableSnapshotTotal))) return Math.max(0, Number(state.availableSnapshotTotal));
        return count;
    }

    function getCanonicalInventoryStatus(state) {
        if (state && state.canonicalInventoryReady === true) return "ready";
        if (state && state.dataUnavailable === true) return "unavailable";
        return "loading";
    }

    function getCanonicalResultCountText(state, currentCount) {
        const canUseExactSnapshotCount = state && state.canonicalCountReady === true && !String(state.query || "").trim() && ["benaderbaar", "beschikbaar"].includes(state.activeStatus);
        if (getCanonicalInventoryStatus(state) !== "ready" && !canUseExactSnapshotCount) return "-- resultaten";
        return getDisplayCount(state, currentCount).toLocaleString("nl-NL") + " resultaten";
    }

    function markCanonicalInventoryReady(state) {
        if (!state || !Array.isArray(state.klanten) || !state.klanten.length) return false;
        if (state.remoteCustomersLoaded !== true && state.canonicalSnapshotApplied !== true) return false;
        if (state.mailReadySnapshotLoaded !== true || state.availableSnapshotLoaded !== true || state.foundSnapshotLoaded !== true) return false;
        if (state.mailReadySnapshotPending === true) return false;
        if (!Number.isFinite(Number(state.mailReadySnapshotTotal)) || !Array.isArray(state.mailReadySnapshotCustomers)) return false;
        if (!Number.isFinite(Number(state.availableSnapshotTotal)) || !Array.isArray(state.availableSnapshotCustomers)) return false;
        if (!Number.isFinite(Number(state.foundSnapshotTotal)) || !state.foundSnapshotCustomerIdSet || typeof state.foundSnapshotCustomerIdSet.has !== "function") return false;
        if (!isSnapshotCategoryCoherent(state.mailReadySnapshotTotal, state.mailReadySnapshotCustomers)) return false;
        if (!isSnapshotCategoryCoherent(state.availableSnapshotTotal, state.availableSnapshotCustomers)) return false;
        if (!isFoundSnapshotCategoryCoherent(state.foundSnapshotTotal, Array.from(state.foundSnapshotCustomerIdSet || []))) return false;
        state.canonicalInventoryReady = true;
        state.canonicalCountReady = true;
        state.dataLoading = false;
        state.dataUnavailable = false;
        return true;
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
        const availableRows = Array.isArray(payload.availableCustomers) ? payload.availableCustomers : [];
        const total = Math.max(rows.length, Number(payload.total) || 0);
        const availableTotal = Math.max(availableRows.length, Number(payload.availableTotal) || 0);
        if (!isSnapshotPageCategoryValid(total, rows, offset) || !isSnapshotPageCategoryValid(availableTotal, availableRows, offset)) throw new Error("Mailklare snapshot was onvolledig; laatste geldige tabel blijft actief.");
        return { payload: payload, rows: rows, availableRows: availableRows, total: total, availableTotal: availableTotal, generatedAt: String(payload.generatedAt || "").trim(), snapshotVersion: String(payload.snapshotVersion || "").trim() };
    }

    function normalizeSnapshotRows(rows, offset, normalizeCustomer) {
        return dedupeCustomers((Array.isArray(rows) ? rows : []).map(function (row, index) {
            return normalizeSnapshotCustomer(row, offset + index, normalizeCustomer);
        }).filter(function (customer) { return customer && customer.id; }));
    }

    function publishSnapshot(config, snapshotCustomers, total, availableCustomers, availableTotal, foundCustomerIds, foundTotal, generatedAt, pending) {
        const state = config.state;
        if (!isSnapshotCategoryCoherent(total, snapshotCustomers) || !isSnapshotCategoryCoherent(availableTotal, availableCustomers)) return false;
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
        const coherentFoundSnapshot = isFoundSnapshotCategoryCoherent(foundTotal, foundCustomerIds);
        if (coherentFoundSnapshot) {
            const normalizedFoundCustomerIds = normalizeFoundCustomerIds(foundCustomerIds);
            state.foundSnapshotLoaded = true;
            state.foundSnapshotTotal = normalizedFoundCustomerIds.length;
            state.foundSnapshotCustomerIdSet = new Set(normalizedFoundCustomerIds);
        } else if (state.foundSnapshotLoaded !== true) {
            state.foundSnapshotLoaded = false;
            state.foundSnapshotTotal = null;
            state.foundSnapshotCustomerIdSet = new Set();
        }
        state.dataUnavailable = false;
        clearRetry(state);
        if (typeof config.applyCustomerList === "function") {
            const currentCustomers = Array.isArray(state.klanten) ? state.klanten : [];
            const currentIsSnapshotOnly = currentCustomers.length && currentCustomers.every(function (customer) { return isSnapshotMailReadyCustomer(customer) || isSnapshotAvailableCustomer(customer); });
            const combinedSnapshotCustomers = dedupeCustomers(snapshotCustomers.concat(availableCustomers));
            config.applyCustomerList(currentCustomers.length && !currentIsSnapshotOnly ? mergeWithCanonicalSnapshots(currentCustomers, snapshotCustomers, availableCustomers) : combinedSnapshotCustomers, false);
            state.canonicalSnapshotApplied = true;
            state.canonicalCountReady = true;
        }
        return true;
    }

    async function fetchRemainingPages(config, firstPage) {
        const maxRows = Math.max(Math.max(0, Number(firstPage.total) || 0), Math.max(0, Number(firstPage.availableTotal) || 0));
        if (maxRows > MAX_SNAPSHOT_ROWS) throw new Error("Mailklare snapshot overschrijdt de veilige pagineringslimiet.");
        if (maxRows > PAGE_LIMIT && !firstPage.snapshotVersion) throw new Error("Mailklare snapshot mist een stabiele inhoudsversie; er wordt opnieuw geladen.");
        const offsets = [];
        for (let offset = PAGE_LIMIT; offset < maxRows; offset += PAGE_LIMIT) offsets.push(offset);
        const pages = [];
        let cursor = 0;
        async function worker() {
            while (cursor < offsets.length) {
                const offset = offsets[cursor];
                cursor += 1;
                const page = await fetchSnapshotPage(config, PAGE_LIMIT, offset, NEXT_PAGE_TIMEOUT_MS);
                if (page.total !== firstPage.total || page.availableTotal !== firstPage.availableTotal || page.snapshotVersion !== firstPage.snapshotVersion) {
                    throw new Error("Mailklare snapshot veranderde tijdens paginering; er wordt opnieuw geladen.");
                }
                pages.push({ offset: offset, rows: page.rows, availableRows: page.availableRows });
            }
        }
        await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, offsets.length) }, worker));
        const sortedPages = pages.sort(function (left, right) { return left.offset - right.offset; });
        return {
            rows: firstPage.rows.concat(sortedPages.flatMap(function (page) { return page.rows; })),
            availableRows: firstPage.availableRows.concat(sortedPages.flatMap(function (page) { return page.availableRows; }))
        };
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
            let availableCustomers = normalizeAvailableSnapshotRows(firstPage.availableRows, 0, config.normalizeCustomer);
            const hasRemainingPages = firstPage.total > firstPage.rows.length || firstPage.availableTotal > firstPage.availableRows.length;
            if (hasRemainingPages) {
                const allRows = await fetchRemainingPages(config, firstPage);
                snapshotCustomers = normalizeSnapshotRows(allRows.rows, 0, config.normalizeCustomer);
                availableCustomers = normalizeAvailableSnapshotRows(allRows.availableRows, 0, config.normalizeCustomer);
            }
            const incomingGeneratedAtMs = Date.parse(String(firstPage.generatedAt || "").trim()) || 0;
            const currentGeneratedAtMs = Math.max(0, Number(state.mailReadySnapshotGeneratedAtMs) || 0);
            if (incomingGeneratedAtMs && currentGeneratedAtMs && incomingGeneratedAtMs < currentGeneratedAtMs) {
                state.mailReadySnapshotPending = false;
                return false;
            }
            const published = publishSnapshot(config, snapshotCustomers, firstPage.total, availableCustomers, firstPage.availableTotal, firstPage.payload.foundCustomerIds, firstPage.payload.foundTotal, firstPage.generatedAt, false);
            if (!published) throw new Error("Mailklare snapshot was niet volledig; laatste geldige tabel blijft actief.");
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

    global.SoftoraDatabaseMailReadySnapshot = { endpoint: ENDPOINT, isSnapshotMailReadyCustomer: isSnapshotMailReadyCustomer, isSnapshotAvailableCustomer: isSnapshotAvailableCustomer, isSnapshotFoundCustomer: isSnapshotFoundCustomer, isFoundSnapshotCategoryCoherent: isFoundSnapshotCategoryCoherent, isSnapshotPayloadCoherent: isSnapshotPayloadCoherent, isBootstrapSnapshotPayloadCoherent: isBootstrapSnapshotPayloadCoherent, isBootstrapSnapshotCountPayloadCoherent: isBootstrapSnapshotCountPayloadCoherent, normalizeCustomer: normalizeSnapshotCustomer, normalizeAvailableCustomer: normalizeAvailableSnapshotCustomer, dedupeCustomers: dedupeCustomers, mergeAssetFlags: mergeAssetFlags, moveCustomerToAvailable: moveCustomerToAvailable, mergeWithCanonicalSnapshots: mergeWithCanonicalSnapshots, getDisplayCount: getDisplayCount, getCanonicalInventoryStatus: getCanonicalInventoryStatus, getCanonicalResultCountText: getCanonicalResultCountText, markCanonicalInventoryReady: markCanonicalInventoryReady, load: load };
})(window);
