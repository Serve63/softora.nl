(function (global) {
    "use strict";

    const RETRY_DELAYS_MS = [2000, 6000, 15000, 30000];

    function createController(options) {
        const load = options && typeof options.load === "function" ? options.load : async function () {};
        const setTimeoutImpl = options && typeof options.setTimeout === "function" ? options.setTimeout : global.setTimeout;
        const clearTimeoutImpl = options && typeof options.clearTimeout === "function" ? options.clearTimeout : global.clearTimeout;
        let retryTimer = null;
        let retryAttempt = 0;
        let inFlightPromise = null;

        function clearRetry() {
            if (retryTimer && typeof clearTimeoutImpl === "function") clearTimeoutImpl(retryTimer);
            retryTimer = null;
            retryAttempt = 0;
        }

        function scheduleRetry() {
            if (retryTimer || typeof setTimeoutImpl !== "function") return;
            const delay = RETRY_DELAYS_MS[retryAttempt];
            if (!Number.isFinite(Number(delay))) return;
            retryAttempt += 1;
            retryTimer = setTimeoutImpl(function () {
                retryTimer = null;
                void run();
            }, delay);
        }

        function run() {
            if (inFlightPromise) return inFlightPromise;
            inFlightPromise = Promise.resolve()
                .then(load)
                .then(function (result) {
                    clearRetry();
                    return result;
                })
                .catch(function () {
                    scheduleRetry();
                    return null;
                })
                .finally(function () {
                    inFlightPromise = null;
                });
            return inFlightPromise;
        }

        return { run: run };
    }

    const api = { createController: createController };
    global.SoftoraDatabaseWebdesignJobRestore = api;
    if (typeof module !== "undefined" && module && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
