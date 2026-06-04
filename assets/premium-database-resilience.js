(function (global) {
    "use strict";

    const DEFAULT_TIMEOUT_MS = 6500;
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
        return global.fetch(url, requestOptions).catch(function (error) {
            if (error && error.name === "AbortError") {
                throw new Error("Supabase-data reageert niet op tijd.");
            }
            throw error;
        }).finally(function () {
            if (timeoutId) global.clearTimeout(timeoutId);
        });
    }

    global.SoftoraDatabaseResilience = Object.freeze({
        defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
        fetchJsonWithTimeout,
        hasChunkedStateKey,
        staleRefreshMessage,
        unavailableMessage,
    });
})(window);
