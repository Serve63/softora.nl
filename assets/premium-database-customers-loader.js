(function (global) {
    "use strict";

    const ENDPOINT = "/api/premium-database/customers";
    const PAGE_LIMIT = 750;
    const PAGE_CONCURRENCY = 4;
    const MAX_CUSTOMERS = 25000;
    const REQUEST_TIMEOUT_MS = 12000;

    function buildUrl(offset, limit, metaOnly) {
        if (metaOnly) return ENDPOINT + "?meta=1";
        return ENDPOINT + "?offset=" + encodeURIComponent(offset) + "&limit=" + encodeURIComponent(limit);
    }

    async function fetchPage(config, offset, limit, metaOnly) {
        const fetchJsonWithTimeout = config.fetchJsonWithTimeout;
        if (typeof fetchJsonWithTimeout !== "function") throw new Error("Database-ophaalroute ontbreekt.");
        const response = await fetchJsonWithTimeout(buildUrl(offset, limit, metaOnly), {
            method: "GET",
            cache: "no-store",
            credentials: "same-origin"
        }, REQUEST_TIMEOUT_MS);
        const payload = await response.json().catch(function () { return {}; });
        if (!response.ok || !payload || payload.ok !== true) {
            throw new Error(String(payload && payload.error || "Klantdatabase laden mislukt (" + response.status + ")"));
        }
        const total = Math.max(0, Number(payload.total) || 0);
        if (total > MAX_CUSTOMERS) throw new Error("Klantdatabase is groter dan de veilige paginagrens.");
        return {
            customers: Array.isArray(payload.customers) ? payload.customers : [],
            total: total,
            snapshotVersion: String(payload.snapshotVersion || "").trim()
        };
    }

    function dedupeCustomers(customers) {
        const seen = new Set();
        return (Array.isArray(customers) ? customers : []).filter(function (customer) {
            const id = String(customer && customer.id || "").trim();
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
        });
    }

    async function fetchRemainingPages(config, total) {
        const offsets = [];
        for (let offset = PAGE_LIMIT; offset < total; offset += PAGE_LIMIT) offsets.push(offset);
        const pages = [];
        let cursor = 0;
        async function worker() {
            while (cursor < offsets.length) {
                const offset = offsets[cursor];
                cursor += 1;
                const page = await fetchPage(config, offset, PAGE_LIMIT, false);
                pages.push({ offset: offset, customers: page.customers });
            }
        }
        await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, offsets.length) }, worker));
        return pages.sort(function (left, right) { return left.offset - right.offset; }).flatMap(function (page) {
            return page.customers;
        });
    }

    async function loadCompleteSnapshot(config, retryOnChange) {
        const firstPage = await fetchPage(config, 0, PAGE_LIMIT, false);
        const remaining = await fetchRemainingPages(config, firstPage.total);
        const customers = dedupeCustomers(firstPage.customers.concat(remaining));
        const finalMeta = await fetchPage(config, 0, 1, true);
        if (firstPage.snapshotVersion && finalMeta.snapshotVersion && firstPage.snapshotVersion !== finalMeta.snapshotVersion) {
            if (retryOnChange) return loadCompleteSnapshot(config, false);
            throw new Error("Klantdatabase wijzigde tijdens het laden; probeer opnieuw.");
        }
        if (customers.length !== firstPage.total) {
            throw new Error("Klantdatabase is onvolledig geladen (" + customers.length + " van " + firstPage.total + ").");
        }
        return {
            changed: true,
            customers: customers,
            total: firstPage.total,
            snapshotVersion: finalMeta.snapshotVersion || firstPage.snapshotVersion
        };
    }

    async function load(config) {
        const options = config || {};
        const previousSnapshotVersion = String(options.previousSnapshotVersion || "").trim();
        if (previousSnapshotVersion) {
            const meta = await fetchPage(options, 0, 1, true);
            if (meta.snapshotVersion && meta.snapshotVersion === previousSnapshotVersion) {
                return {
                    changed: false,
                    customers: [],
                    total: meta.total,
                    snapshotVersion: meta.snapshotVersion
                };
            }
        }
        return loadCompleteSnapshot(options, true);
    }

    global.SoftoraPremiumDatabaseCustomers = {
        endpoint: ENDPOINT,
        pageLimit: PAGE_LIMIT,
        maxCustomers: MAX_CUSTOMERS,
        dedupeCustomers: dedupeCustomers,
        load: load
    };
})(window);
