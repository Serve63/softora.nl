(function (global) {
    "use strict";

    const ENDPOINT = "/api/premium-database/customers";
    const ARCHIVE_ENDPOINT = ENDPOINT + "/archive";
    const PAGE_LIMIT = 1000;
    const PAGE_CONCURRENCY = 4;
    const MAX_CUSTOMERS = 25000;
    const REQUEST_TIMEOUT_MS = 12000;
    const TRANSIENT_RETRY_DELAY_MS = 250;
    const VALIDATOR_KEY = "premium-database-archive-validator:v1";
    const VALIDATOR_PATTERN = /^"softora-customers-v1-[a-f0-9]{32}"$/;
    const VALIDATOR_MAX_AGE_MS = 15 * 60 * 1000;

    function validatorCache(config) {
        const bootstrap = global.SoftoraPageBootstrapSession;
        const session = config.validatorSession || bootstrap?.get?.();
        const cache = config.validatorCache || bootstrap?.cache;
        const identity = String(session && (session.userId || session.email) || "").trim().toLowerCase();
        return session?.authenticated && identity && cache
            ? { cache: cache, key: VALIDATOR_KEY + ":" + identity } : null;
    }

    function readValidator(config) {
        try {
            const scope = validatorCache(config);
            const value = String(scope?.cache.read?.(scope.key, VALIDATOR_MAX_AGE_MS) || "");
            return VALIDATOR_PATTERN.test(value) ? value : "";
        } catch (_error) { return ""; }
    }

    function rememberValidator(config, response) {
        const value = String(response.headers?.get?.("ETag") || "");
        if (!VALIDATOR_PATTERN.test(value)) return;
        try {
            const scope = validatorCache(config);
            scope?.cache.write?.(scope.key, value);
        } catch (_error) { /* The shared session cache may be unavailable. */ }
    }

    function buildUrl(offset, limit, metaOnly) {
        if (metaOnly) return ENDPOINT + "?meta=1";
        return ENDPOINT + "?offset=" + encodeURIComponent(offset) + "&limit=" + encodeURIComponent(limit);
    }

    async function fetchPage(config, offset, limit, metaOnly) {
        const fetchJsonWithTimeout = config.fetchJsonWithTimeout;
        if (typeof fetchJsonWithTimeout !== "function") throw new Error("Database-ophaalroute ontbreekt.");
        while (true) {
            const response = await fetchJsonWithTimeout(buildUrl(offset, limit, metaOnly), {
                method: "GET",
                cache: "no-store",
                credentials: "same-origin"
            }, REQUEST_TIMEOUT_MS);
            const payload = await response.json().catch(function () { return {}; });
            if (!response.ok || !payload || payload.ok !== true) {
                if ([502, 503, 504].includes(Number(response.status)) && config.transientRetriesRemaining > 0) {
                    config.transientRetriesRemaining -= 1;
                    await new Promise(function (resolve) { setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS); });
                    continue;
                }
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

    async function fetchArchive(config) {
        const validator = readValidator(config);
        const requestOptions = { method: "GET", cache: "no-cache", credentials: "same-origin" };
        if (validator) requestOptions.headers = { "X-Softora-Archive-Validator": validator };
        let response = await config.fetchJsonWithTimeout(ARCHIVE_ENDPOINT, requestOptions, REQUEST_TIMEOUT_MS);
        if (response.status === 304) {
            response = await config.fetchJsonWithTimeout(ARCHIVE_ENDPOINT, {
                method: "GET", cache: "reload", credentials: "same-origin"
            }, REQUEST_TIMEOUT_MS);
        }
        const payload = await response.json().catch(function () { return {}; });
        const total = Number(payload.total);
        const customers = Array.isArray(payload.customers) ? payload.customers : [];
        const version = String(payload.snapshotVersion || "").trim();
        if (!response.ok || payload.ok !== true || payload.completeDataset !== true ||
            !Number.isInteger(total) || total < 0 || total > MAX_CUSTOMERS || !version ||
            customers.length !== total || dedupeCustomers(customers).length !== total) {
            throw new Error("Volledig klantdatabase-archief is niet beschikbaar.");
        }
        global.performance?.mark?.("softora:database:archive-validated");
        rememberValidator(config, response);
        return { changed: true, customers: customers, total: total, snapshotVersion: version };
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
        const options = { ...(config || {}), transientRetriesRemaining: 1 };
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
        try {
            return await fetchArchive(options);
        } catch (_archiveError) {
            return loadCompleteSnapshot(options, true);
        }
    }

    const api = {
        endpoint: ENDPOINT,
        archiveEndpoint: ARCHIVE_ENDPOINT,
        pageLimit: PAGE_LIMIT,
        maxCustomers: MAX_CUSTOMERS,
        dedupeCustomers: dedupeCustomers,
        load: load
    };
    global.SoftoraPremiumDatabaseCustomers = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
