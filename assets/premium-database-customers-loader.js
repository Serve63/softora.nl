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
    const DELTA_ENDPOINT = ARCHIVE_ENDPOINT + "/delta";
    const READ_MODEL_KEY = "premium-database-customers:v1";
    // The delta path is exact, but a full re-verification once a day bounds the
    // lifetime of any local copy even if a write ever bypassed updated_at.
    const FULL_VERIFY_INTERVAL_MS = 24 * 60 * 60 * 1000;

    function readModelScope(config) {
        const store = config.readModelStore === undefined ? global.SoftoraReadModelStore : config.readModelStore;
        const session = config.validatorSession || global.SoftoraPageBootstrapSession?.get?.();
        const identity = String(session && (session.userId || session.email) || "").trim().toLowerCase();
        return store && session?.authenticated && identity ? { store: store, identity: identity } : null;
    }

    function snapshotCursor(version) {
        const text = String(version || "");
        const separator = text.indexOf(":");
        const cursor = separator > 0 ? text.slice(separator + 1) : "";
        return cursor && Number.isFinite(Date.parse(cursor)) ? cursor : "";
    }

    async function readLocalCopy(scope) {
        try {
            const copy = await scope.store.read(READ_MODEL_KEY, scope.identity);
            const total = Number(copy && copy.total);
            if (!copy || !Array.isArray(copy.customers) || !Number.isInteger(total) || copy.customers.length !== total ||
                !snapshotCursor(copy.snapshotVersion) || !Number.isFinite(Number(copy.fullSyncedAt))) return null;
            return copy;
        } catch (_error) { return null; }
    }

    function whenIdle(callback) {
        if (typeof global.requestIdleCallback === "function") global.requestIdleCallback(callback, { timeout: 5000 });
        else setTimeout(callback, 3000);
    }

    // The page builds new objects from these rows and never mutates them, so the
    // copy can be written after the screen is ready instead of on its critical path.
    function persistLocalCopy(scope, result, fullSyncedAt) {
        if (!scope || !snapshotCursor(result.snapshotVersion)) return;
        whenIdle(function () {
            scope.store.write(READ_MODEL_KEY, scope.identity, { customers: result.customers, total: result.total,
                snapshotVersion: result.snapshotVersion, fullSyncedAt: fullSyncedAt }).catch(function () { return false; });
        });
    }

    async function fetchDelta(config, local) {
        const response = await config.fetchJsonWithTimeout(DELTA_ENDPOINT + "?since=" +
            encodeURIComponent(snapshotCursor(local.snapshotVersion)), {
            method: "GET", cache: "no-store", credentials: "same-origin"
        }, REQUEST_TIMEOUT_MS);
        const payload = await response.json().catch(function () { return {}; });
        if (!response.ok || payload.ok !== true) throw new Error("Klantdatabase-wijzigingen niet beschikbaar.");
        if (payload.resync === true) return null;
        const total = Number(payload.total);
        const version = String(payload.snapshotVersion || "").trim();
        const upserts = Array.isArray(payload.upserts) ? payload.upserts : null;
        const deletedIds = Array.isArray(payload.deletedIds) ? payload.deletedIds : null;
        if (payload.completeDelta !== true || !upserts || !deletedIds || !Number.isInteger(total) || total < 0 ||
            total > MAX_CUSTOMERS || !snapshotCursor(version)) throw new Error("Klantdatabase-delta is onvolledig.");
        const changedIds = new Set(upserts.map(function (customer) { return String(customer && customer.id || "").trim(); })
            .concat(deletedIds.map(function (id) { return String(id || "").trim(); })));
        // Changed rows carry the newest updated_at, so putting them first keeps
        // the archive's updated_at-descending order.
        const merged = upserts.concat(local.customers.filter(function (customer) {
            return !changedIds.has(String(customer && customer.id || "").trim());
        }));
        const customers = dedupeCustomers(merged);
        if (changedIds.has("") || customers.length !== merged.length || customers.length !== total) {
            throw new Error("Klantdatabase-delta sluit niet aan op de lokale kopie.");
        }
        global.performance?.mark?.("softora:database:delta-validated");
        return { changed: true, customers: customers, total: total, snapshotVersion: version,
            source: "delta", deltaSize: upserts.length + deletedIds.length };
    }

    function scheduleFullVerify(config, scope, delta, fullSyncedAt) {
        if (Date.now() - Number(fullSyncedAt) < FULL_VERIFY_INTERVAL_MS) return;
        whenIdle(function () {
            fetchArchive(config).then(function (archive) {
                if (archive.snapshotVersion === delta.snapshotVersion &&
                    JSON.stringify(archive.customers) !== JSON.stringify(delta.customers)) {
                    console.warn("[SoftoraReadModel] premium-database-customers: lokale kopie week af; vervangen door volledig archief.");
                    global.performance?.mark?.("softora:database:readmodel-drift");
                }
                persistLocalCopy(scope, archive, Date.now());
            }).catch(function () { /* Next opening retries; the delta result stays valid. */ });
        });
    }

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
        const scope = readModelScope(options);
        const local = scope ? await readLocalCopy(scope) : null;
        if (local) {
            try {
                const synced = await fetchDelta(options, local);
                if (synced) {
                    persistLocalCopy(scope, synced, local.fullSyncedAt);
                    scheduleFullVerify(options, scope, synced, local.fullSyncedAt);
                    return synced;
                }
            } catch (_deltaError) { /* A full verified archive replaces an unusable copy. */ }
        }
        let result;
        try {
            result = await fetchArchive(options);
        } catch (_archiveError) {
            result = await loadCompleteSnapshot(options, true);
        }
        persistLocalCopy(scope, result, Date.now());
        return result;
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
