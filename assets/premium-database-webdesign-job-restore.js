(function (global) {
    "use strict";

    const RETRY_DELAYS_MS = [2000, 6000, 15000, 30000];

    function createController(options) {
        const load = options && typeof options.load === "function" ? options.load : async function () {};
        let retryTimer = null;
        let retryAttempt = 0;
        let inFlightPromise = null;

        function clearRetry() {
            if (retryTimer && typeof global.clearTimeout === "function") global.clearTimeout(retryTimer);
            retryTimer = null;
            retryAttempt = 0;
        }

        function scheduleRetry() {
            if (retryTimer || typeof global.setTimeout !== "function") return;
            const delay = RETRY_DELAYS_MS[retryAttempt];
            if (!Number.isFinite(Number(delay))) return;
            retryAttempt += 1;
            retryTimer = global.setTimeout(function () {
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

    global.SoftoraDatabaseWebdesignJobRestore = { createController: createController };
})(typeof window !== "undefined" ? window : globalThis);
