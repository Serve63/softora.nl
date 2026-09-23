(function (root, createClient) {
    if (typeof module === "object" && module.exports) module.exports = createClient;
    else createClient(root);
})(typeof window !== "undefined" ? window : null, function (global) {
    "use strict";

    var DEFAULT_TIMEOUT_MS = 5000;
    var GET_CACHE_TTL_MS = 15000;
    var readCache = Object.create(null);
    var pendingWrites = Object.create(null);
    var sessionGeneration = 0;
    var clock = global.Date || Date;

    function clearUiState() {
        sessionGeneration += 1;
        readCache = Object.create(null);
        pendingWrites = Object.create(null);
    }

    function getBootstrapDocument() {
        return global && global.document && typeof global.document.getElementById === "function"
            ? global.document
            : null;
    }

    function normalizeStateSnapshot(value) {
        var snapshot = value && typeof value === "object" ? value : {};
        var source = String(snapshot.source || "bootstrap");
        return {
            ok: snapshot.ok !== false && source.toLowerCase() === "supabase",
            values: snapshot.values && typeof snapshot.values === "object" ? snapshot.values : {},
            source: source,
            updatedAt: snapshot.updatedAt || null
        };
    }

    function readBootstrapText(element) {
        var raw = String(element && element.textContent || "");
        if (
            !element ||
            typeof element.getAttribute !== "function" ||
            element.getAttribute("data-softora-encoding") !== "base64"
        ) {
            return raw;
        }
        if (!global || typeof global.atob !== "function") return "";
        var binary = global.atob(raw.trim());
        var bytes = Uint8Array.from(binary, function (character) {
            return character.charCodeAt(0);
        });
        return typeof global.TextDecoder === "function"
            ? new global.TextDecoder("utf-8").decode(bytes)
            : decodeURIComponent(escape(binary));
    }

    function primeUiState(scope, value, options) {
        var cacheKey = String(scope || "");
        if (!cacheKey) return false;
        readCache[cacheKey] = {
            data: normalizeStateSnapshot(value),
            time: Math.max(0, Number(options && options.time) || clock.now()),
            bootstrap: Boolean(options && options.bootstrap)
        };
        return true;
    }

    function invalidateUiState(scope) {
        var cacheKey = String(scope || "");
        if (!cacheKey) return false;
        delete readCache[cacheKey];
        return true;
    }

    function isUsableBootstrapSnapshot(scope, value) {
        var snapshot = value && typeof value === "object" ? value : null;
        if (!snapshot) return false;
        // Live Momentum accepteert uitsluitend door Supabase bevestigde state.
        // Cache dus geen lege timeout-placeholder die de echte read blokkeert.
        if (
            String(scope || "") === "premium_live_momentum" &&
            String(snapshot.source || "").toLowerCase() !== "supabase"
        ) {
            return false;
        }
        return true;
    }

    function readPageStateBootstrap() {
        var doc = getBootstrapDocument();
        if (!doc) return 0;
        var primedScopes = Object.create(null);
        var ids = [
            "softoraPageStateBootstrap",
            "softoraCustomersBootstrap",
            "softoraActiveOrdersBootstrap",
            "softoraAgendaBootstrap",
            "softoraLeadsBootstrap",
            "softoraColdcallingDashboardBootstrap"
        ];
        return ids.reduce(function (total, id) {
            var element = doc.getElementById(id);
            if (!element) return total;
            try {
                var payload = JSON.parse(readBootstrapText(element) || "{}");
                var scopes = payload && payload.scopes && typeof payload.scopes === "object"
                    ? payload.scopes
                    : payload && payload.pageStateScopes && typeof payload.pageStateScopes === "object"
                        ? payload.pageStateScopes
                        : {};
                return total + Object.keys(scopes).reduce(function (count, scope) {
                    if (primedScopes[scope]) return count;
                    if (!isUsableBootstrapSnapshot(scope, scopes[scope])) return count;
                    var primed = primeUiState(scope, scopes[scope], {
                        bootstrap: true,
                        // De server heeft deze data al voor de huidige navigatie opgehaald.
                        // Start daarom een verse client-TTL, ongeacht de klok op de server.
                        time: clock.now()
                    });
                    if (primed) primedScopes[scope] = true;
                    return primed ? count + 1 : count;
                }, 0);
            } catch (_error) {
                return total;
            }
        }, 0);
    }

    function normalizeScope(scope) {
        return encodeURIComponent(String(scope || ""));
    }

    function getReadUrls(scope) {
        var encodedScope = normalizeScope(scope);
        return [
            "/api/ui-state-get?scope=" + encodedScope,
            "/api/ui-state/" + encodedScope
        ];
    }

    function getWriteUrls(scope) {
        var encodedScope = normalizeScope(scope);
        return [
            "/api/ui-state-set?scope=" + encodedScope,
            "/api/ui-state/" + encodedScope
        ];
    }

    async function parseJsonResponse(response) {
        return await response.json().catch(function () { return {}; });
    }

    function getSafeTimeoutMs(timeoutMs) {
        return Math.max(1000, Math.min(30000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
    }

    async function fetchWithTimeout(url, options, label, timeoutMs) {
        var safeTimeoutMs = getSafeTimeoutMs(timeoutMs);
        var AbortCtor = global && typeof global.AbortController === "function" ? global.AbortController : null;
        var controller = AbortCtor ? new AbortCtor() : null;
        var requestOptions = Object.assign({}, options || {});
        var timeout = null;

        if (controller) {
            requestOptions.signal = controller.signal;
            timeout = global.setTimeout(function () {
                controller.abort();
            }, safeTimeoutMs);
        }

        try {
            return await global.fetch(url, requestOptions);
        } catch (error) {
            if (error && error.name === "AbortError") {
                throw new Error(label + " reageert niet op tijd.");
            }
            throw error;
        } finally {
            if (timeout) global.clearTimeout(timeout);
        }
    }

    function shouldStopFallback(error) {
        var status = Number(error && error.status);
        if (status && (status === 401 || status === 403 || status === 429 || status >= 500)) return true;
        return /reageert niet op tijd|timeout|timed out|mislukt \((?:401|403|429|5\d\d)\)/i.test(String(error && error.message || error || ""));
    }

    async function requestWithFallback(urls, options, label, timeoutMs) {
        var lastError = null;

        for (var index = 0; index < urls.length; index += 1) {
            try {
                var readModelClient = options && options.readModelKey && global.SoftoraReadModelClient;
                var response = readModelClient
                    ? await readModelClient.fetchResponse(urls[index], { method: options.method, cache: options.cache }, {
                        key: options.readModelKey,
                        fetchImpl: function (url, init) { return fetchWithTimeout(url, init, label, timeoutMs); }
                    })
                    : await fetchWithTimeout(urls[index], options, label, timeoutMs);
                if (!response.ok) {
                    var statusError = new Error(label + " mislukt (" + response.status + ")");
                    statusError.status = response.status;
                    throw statusError;
                }
                return await parseJsonResponse(response);
            } catch (error) {
                lastError = error;
                if (shouldStopFallback(error)) break;
            }
        }

        throw lastError || new Error(label + " mislukt");
    }

    async function getUiState(scope) {
        var cacheKey = String(scope || "");
        var generation = sessionGeneration;
        // A read started during a write must observe the completed write, including failures.
        while (pendingWrites[cacheKey]) {
            await pendingWrites[cacheKey];
            if (generation !== sessionGeneration) throw new Error("UI-state sessie gewijzigd.");
        }
        var cached = readCache[cacheKey];
        var now = clock.now();
        if (cached && (cached.promise || now - cached.time < GET_CACHE_TTL_MS)) {
            return await (cached.promise || Promise.resolve(cached.data));
        }
        var promise = requestWithFallback(
            getReadUrls(scope),
            // Versioned scopes are completed from the verified local copy when unchanged.
            { method: "GET", cache: "no-store", readModelKey: "ui-state:" + cacheKey },
            "UI-state GET"
        ).then(async function (data) {
            if (generation !== sessionGeneration) throw new Error("UI-state sessie gewijzigd.");
            // An invalidation, prime or write supersedes this response; never return old truth.
            if (readCache[cacheKey] !== entry) return await getUiState(scope);
            readCache[cacheKey] = { data: data, time: clock.now() };
            return data;
        }).catch(function (error) {
            if (readCache[cacheKey] === entry) delete readCache[cacheKey];
            throw error;
        });
        readCache[cacheKey] = { promise: promise, time: now };
        var entry = readCache[cacheKey];
        return await promise;
    }

    async function setUiState(scope, body, options) {
        var cacheKey = String(scope || "");
        delete readCache[cacheKey];
        var requestOptions = {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {})
        };
        if (options && options.keepalive === true) requestOptions.keepalive = true;

        var generation = sessionGeneration;
        var previousWrite = pendingWrites[cacheKey] || Promise.resolve();
        var write = requestWithFallback(
            getWriteUrls(scope),
            requestOptions,
            "UI-state POST",
            options && options.timeoutMs
        );
        // Coordinate readers without serialising or replaying existing business writes.
        var settled = Promise.all([previousWrite, write.catch(function () {})]);
        pendingWrites[cacheKey] = settled;
        try {
            return await write;
        } finally {
            await settled;
            if (generation === sessionGeneration) {
                delete readCache[cacheKey];
                if (pendingWrites[cacheKey] === settled) delete pendingWrites[cacheKey];
            }
        }
    }

    function peekUiState(scope) {
        var cached = readCache[String(scope || "")];
        return cached && cached.data ? cached.data : null;
    }

    var bootstrappedScopeCount = readPageStateBootstrap();

    global.SoftoraUiStateClient = {
        get: getUiState,
        set: setUiState,
        peek: peekUiState,
        prime: primeUiState,
        invalidate: invalidateUiState,
        clear: clearUiState,
        bootstrappedScopeCount: bootstrappedScopeCount
    };
    if (typeof global.addEventListener === "function") global.addEventListener("pagehide", clearUiState);
    return global.SoftoraUiStateClient;
});
