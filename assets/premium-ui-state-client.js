(function (global) {
    "use strict";

    var DEFAULT_TIMEOUT_MS = 5000;
    var GET_CACHE_TTL_MS = 15000;
    var readCache = Object.create(null);

    function getBootstrapDocument() {
        return global && global.document && typeof global.document.getElementById === "function"
            ? global.document
            : null;
    }

    function normalizeStateSnapshot(value) {
        var snapshot = value && typeof value === "object" ? value : {};
        return {
            values: snapshot.values && typeof snapshot.values === "object" ? snapshot.values : {},
            source: String(snapshot.source || "bootstrap"),
            updatedAt: snapshot.updatedAt || null
        };
    }

    function primeUiState(scope, value, options) {
        var cacheKey = String(scope || "");
        if (!cacheKey) return false;
        readCache[cacheKey] = {
            data: normalizeStateSnapshot(value),
            time: Math.max(0, Number(options && options.time) || Date.now()),
            bootstrap: Boolean(options && options.bootstrap)
        };
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
                var payload = JSON.parse(String(element.textContent || "{}"));
                var scopes = payload && payload.scopes && typeof payload.scopes === "object"
                    ? payload.scopes
                    : payload && payload.pageStateScopes && typeof payload.pageStateScopes === "object"
                        ? payload.pageStateScopes
                        : {};
                return total + Object.keys(scopes).reduce(function (count, scope) {
                    if (primedScopes[scope]) return count;
                    var primed = primeUiState(scope, scopes[scope], {
                        bootstrap: true,
                        // De server heeft deze data al voor de huidige navigatie opgehaald.
                        // Start daarom een verse client-TTL, ongeacht de klok op de server.
                        time: Date.now()
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
                var response = await fetchWithTimeout(urls[index], options, label, timeoutMs);
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
        var cached = readCache[cacheKey];
        var now = Date.now();
        if (cached && now - cached.time < GET_CACHE_TTL_MS) {
            return await (cached.promise || Promise.resolve(cached.data));
        }
        var promise = requestWithFallback(
            getReadUrls(scope),
            { method: "GET", cache: "no-store" },
            "UI-state GET"
        );
        readCache[cacheKey] = { promise: promise, time: now };
        try {
            var data = await promise;
            readCache[cacheKey] = { data: data, time: Date.now() };
            return data;
        } catch (error) {
            delete readCache[cacheKey];
            throw error;
        }
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

        var data = await requestWithFallback(
            getWriteUrls(scope),
            requestOptions,
            "UI-state POST",
            options && options.timeoutMs
        );
        delete readCache[cacheKey];
        return data;
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
        bootstrappedScopeCount: bootstrappedScopeCount
    };
})(window);
