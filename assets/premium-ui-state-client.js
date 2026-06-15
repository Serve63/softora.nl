(function (global) {
    "use strict";

    var DEFAULT_TIMEOUT_MS = 5000;
    var GET_CACHE_TTL_MS = 15000;
    var readCache = Object.create(null);

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

    global.SoftoraUiStateClient = {
        get: getUiState,
        set: setUiState
    };
})(window);
