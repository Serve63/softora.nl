(function (global) {
    "use strict";

    const DEFAULT_TIMEOUT_MS = 4000;
    const unavailableMessage = "Supabase-data tijdelijk niet geladen. Je data is niet verwijderd; probeer zo opnieuw.";
    const staleRefreshMessage = "Supabase-data tijdelijk niet vernieuwd; bestaande data blijft staan.";

    function hasChunkedStateKey(values, baseKey) {
        const stateValues = values && typeof values === "object" ? values : {};
        const key = String(baseKey || "").trim();
        return Boolean(
            key &&
            (
                Object.prototype.hasOwnProperty.call(stateValues, key) ||
                Object.prototype.hasOwnProperty.call(stateValues, key + "_chunks_v1")
            )
        );
    }

    function withTimeout(task, timeoutMs, message) {
        const safeTimeoutMs = Math.max(1000, Math.min(30000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
        let timeoutId = null;
        return new Promise(function (resolve, reject) {
            timeoutId = global.setTimeout(function () {
                reject(new Error(message || "Supabase-data reageert niet op tijd."));
            }, safeTimeoutMs);
            Promise.resolve()
                .then(function () {
                    return typeof task === "function" ? task() : task;
                })
                .then(resolve, reject)
                .finally(function () {
                    if (timeoutId) global.clearTimeout(timeoutId);
                });
        });
    }

    function fetchJsonWithTimeout(url, options, timeoutMs) {
        const safeTimeoutMs = Math.max(1000, Math.min(30000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const requestOptions = { ...(options || {}) };
        let timeoutId = null;
        if (controller) {
            requestOptions.signal = controller.signal;
            timeoutId = global.setTimeout(function () {
                controller.abort();
            }, safeTimeoutMs);
        }
        return withTimeout(global.fetch(url, requestOptions).catch(function (error) {
            if (error && error.name === "AbortError") {
                throw new Error("Supabase-data reageert niet op tijd.");
            }
            throw error;
        }), safeTimeoutMs, "Supabase-data reageert niet op tijd.").finally(function () {
            if (timeoutId) global.clearTimeout(timeoutId);
        });
    }

    function shouldStopUiStateFallback(error) {
        var status = Number(error && error.status);
        if (status && (status === 401 || status === 403 || status === 429 || status >= 500)) return true;
        return /reageert niet op tijd|timeout|timed out|mislukt \((?:401|403|429|5\d\d)\)/i.test(String(error && error.message || error || ""));
    }

    global.SoftoraDatabaseResilience = Object.freeze({
        defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
        fetchJsonWithTimeout,
        hasChunkedStateKey,
        staleRefreshMessage,
        shouldStopUiStateFallback,
        unavailableMessage,
        withTimeout,
    });
})(window);
