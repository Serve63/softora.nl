(function (global) {
    "use strict";

    const DEFAULT_USD_TO_EUR_RATE = 0.93;

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function parseEvents(raw) {
        try {
            const parsed = JSON.parse(String(raw || "[]"));
            return Array.isArray(parsed) ? parsed.filter(function (item) {
                return item && typeof item === "object";
            }) : [];
        } catch (error) {
            return [];
        }
    }

    function createLedger(options) {
        const getUiState = options.getUiState;
        const setUiState = options.setUiState;
        const scope = normalizeString(options.scope);
        const key = normalizeString(options.key);
        const usdToEurRate = Math.max(0, Number(options.usdToEurRate) || DEFAULT_USD_TO_EUR_RATE);
        const maxEvents = Math.max(50, Math.min(5000, Number(options.maxEvents) || 1000));

        function normalizeEvent(event) {
            const amountUsd = Math.max(0, Number(event && event.amountUsd) || 0);
            const amountEur = Math.max(0, Number(event && event.amountEur) || amountUsd * usdToEurRate);
            if (amountEur <= 0 && amountUsd <= 0) return null;
            return {
                id: "api-cost-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
                occurredAt: new Date().toISOString(),
                source: normalizeString(event && event.source) || "softora-api",
                label: normalizeString(event && event.label) || "API-verbruik",
                model: normalizeString(event && event.model),
                amountUsd: Math.round(amountUsd * 1000000) / 1000000,
                amountEur: Math.round(amountEur * 100) / 100,
                meta: event && event.meta && typeof event.meta === "object" ? event.meta : {}
            };
        }

        function record(event) {
            const safeEvent = normalizeEvent(event);
            if (!safeEvent || !getUiState || !setUiState || !scope || !key) {
                return Promise.resolve({ ok: true, skipped: true });
            }
            return getUiState(scope).then(function (state) {
                const values = state && state.values && typeof state.values === "object" ? state.values : {};
                const events = parseEvents(values[key]).concat([safeEvent]).slice(-maxEvents);
                return setUiState(scope, {
                    patch: { [key]: JSON.stringify(events) },
                    source: "softora-api-cost-ledger",
                    actor: "Softora API-kosten"
                });
            }).then(function () {
                return { ok: true };
            }).catch(function (error) {
                console.error("API-kosten opslaan mislukt:", error);
                return { ok: false, error: error };
            });
        }

        return {
            parseEvents: parseEvents,
            record: record
        };
    }

    global.SoftoraApiCostLedger = {
        createLedger: createLedger,
        parseEvents: parseEvents
    };
})(window);
