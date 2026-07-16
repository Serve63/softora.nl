(function (global) {
    "use strict";

    const STATUS_URL = "/api/coldmailing/autopilot/status";
    const SETTINGS_URL = "/api/coldmailing/autopilot/settings";
    const STATUS_EVENT = "softora:coldmail-autopilot-status";
    const REFRESH_MS = 60000;

    let state = null;
    let busy = false;
    let statusLoaded = false;
    let statusUnavailable = false;
    let refreshPromise = null;

    function getDocument() {
        return global.document || (typeof document === "undefined" ? null : document);
    }

    function byId(id) {
        const rootDocument = getDocument();
        return rootDocument ? rootDocument.getElementById(id) : null;
    }

    function getFetch() {
        if (typeof global.fetch === "function") return global.fetch.bind(global);
        if (typeof fetch === "function") return fetch;
        return null;
    }

    function getSetInterval() {
        if (typeof global.setInterval === "function") return global.setInterval.bind(global);
        if (typeof setInterval === "function") return setInterval;
        return null;
    }

    function showToast(message) {
        const toast = byId("toast");
        if (!toast) return;
        toast.textContent = String(message || "");
        toast.classList.add("on");
        global.clearTimeout && global.clearTimeout(showToast.timer);
        showToast.timer = global.setTimeout ? global.setTimeout(function () {
            toast.classList.remove("on");
        }, 2600) : 0;
    }

    function notifyStatus() {
        if (!statusLoaded || typeof global.dispatchEvent !== "function") return;
        try {
            global.dispatchEvent(new CustomEvent(STATUS_EVENT, {
                detail: { autopilot: state && typeof state === "object" ? state : {} },
            }));
        } catch (_error) {
            /* Older browser or test context without CustomEvent support. */
        }
    }

    function applyStatusPayload(payload) {
        state = payload && payload.autopilot ? payload.autopilot : payload || {};
        statusLoaded = true;
        statusUnavailable = false;
        render();
        notifyStatus();
    }

    function applyBootstrapStatus() {
        const rootDocument = getDocument();
        const element = rootDocument && rootDocument.getElementById("softoraCustomersBootstrap");
        if (!element) return false;
        try {
            const payload = JSON.parse(String(element.textContent || "{}"));
            const autopilot = payload && payload.autopilot && typeof payload.autopilot === "object" ? payload.autopilot : null;
            if (!autopilot || autopilot.loaded !== true) return false;
            state = { enabled: autopilot.enabled === true };
            statusLoaded = true;
            statusUnavailable = false;
            return true;
        } catch (_error) {
            return false;
        }
    }

    function render() {
        const loading = !statusLoaded && !statusUnavailable;
        const unavailable = statusUnavailable && !statusLoaded;
        const enabled = statusLoaded && Boolean(state && state.enabled);
        const card = byId("databaseAutopilotCard");
        const button = byId("databaseAutopilotToggle");
        const label = byId("databaseAutopilotToggleLabel");

        if (card) {
            card.setAttribute("data-autopilot-state", loading ? "loading" : unavailable ? "error" : enabled ? "on" : "off");
        }
        if (button) {
            button.disabled = busy || loading || unavailable;
            button.setAttribute("aria-pressed", enabled ? "true" : "false");
            button.setAttribute("aria-busy", busy || loading ? "true" : "false");
            button.title = loading
                ? "Autopilotstatus wordt geladen"
                : unavailable
                    ? "Autopilotstatus kon niet worden geladen"
                    : enabled
                        ? "Mailcampagne-autopilot uitschakelen"
                        : "Mailcampagne-autopilot inschakelen";
        }
        if (label) {
            label.textContent = busy
                ? "Opslaan"
                : loading
                    ? "Laden"
                    : unavailable
                        ? "Onbekend"
                        : enabled
                            ? "Aan"
                            : "Uit";
        }
    }

    async function requestJson(url, options) {
        const fetchImpl = getFetch();
        if (!fetchImpl) throw new Error("Autopilotverzoek kan niet worden uitgevoerd.");
        const requestOptions = Object.assign({
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            cache: "no-store",
        }, options || {});
        const response = await fetchImpl(url, requestOptions);
        const payload = await response.json().catch(function () { return null; });
        if (!response.ok || !payload || payload.ok === false) {
            throw new Error(payload && (payload.message || payload.error) || "Autopilotverzoek mislukt.");
        }
        return payload;
    }

    function refresh() {
        const rootDocument = getDocument();
        if (rootDocument && rootDocument.hidden) return Promise.resolve(state);
        if (refreshPromise) return refreshPromise;
        refreshPromise = requestJson(STATUS_URL)
            .then(applyStatusPayload)
            .catch(function (error) {
                statusUnavailable = !statusLoaded;
                render();
                if (typeof console !== "undefined" && typeof console.warn === "function") {
                    console.warn("Autopilotstatus laden mislukt:", error && error.message ? error.message : error);
                }
                return state;
            })
            .finally(function () {
                refreshPromise = null;
            });
        return refreshPromise;
    }

    async function toggle() {
        if (busy || !statusLoaded || statusUnavailable) return;
        const nextEnabled = !Boolean(state && state.enabled);
        busy = true;
        render();
        try {
            const payload = await requestJson(SETTINGS_URL, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ enabled: nextEnabled }),
            });
            if (payload.persistenceConfirmed !== true || !payload.autopilot || payload.autopilot.enabled !== nextEnabled) {
                throw new Error("Autopilotstand is niet duurzaam bevestigd. De vorige stand blijft zichtbaar.");
            }
            applyStatusPayload(payload);
            showToast(nextEnabled ? "Autopilot staat aan." : "Autopilot staat uit.");
        } catch (error) {
            showToast(error && error.message ? error.message : "Autopilot kon niet worden opgeslagen.");
        } finally {
            busy = false;
            render();
        }
    }

    function bindRefreshEvents() {
        const interval = getSetInterval();
        if (interval) interval(function () {
            const rootDocument = getDocument();
            if (!rootDocument || !rootDocument.hidden) void refresh();
        }, REFRESH_MS);
        if (typeof global.addEventListener === "function") {
            global.addEventListener("focus", refresh);
            global.addEventListener("pageshow", refresh);
        }
        const rootDocument = getDocument();
        if (rootDocument && typeof rootDocument.addEventListener === "function") {
            rootDocument.addEventListener("visibilitychange", function () {
                if (!rootDocument.hidden) void refresh();
            });
        }
    }

    function init() {
        const button = byId("databaseAutopilotToggle");
        if (!button) return;
        button.addEventListener("click", function (event) {
            event.preventDefault();
            void toggle();
        });
        applyBootstrapStatus();
        render();
        void refresh();
        bindRefreshEvents();
    }

    global.SoftoraDatabaseAutopilotToggle = {
        refresh,
        toggle,
        getState: function () {
            return state;
        },
    };

    const rootDocument = getDocument();
    if (rootDocument && rootDocument.readyState === "loading") rootDocument.addEventListener("DOMContentLoaded", init);
    else init();
})(typeof window !== "undefined" ? window : globalThis);
