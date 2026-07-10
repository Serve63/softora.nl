(function (global) {
    "use strict";

    const unavailableMessage = "Supabase-data tijdelijk niet geladen. Je data is niet verwijderd; probeer zo opnieuw.";
    let hasClearedUnavailable = false;

    function ensureStyle() {
        if (document.getElementById("dashboardDataStatusStyle")) return;
        const style = document.createElement("style");
        style.id = "dashboardDataStatusStyle";
        style.textContent = ".dashboard-data-status{display:none;border:1px solid rgba(235,87,87,.28);background:rgba(235,87,87,.08);color:#c83f35;padding:.9rem 1rem;margin-bottom:1.5rem;font-size:.86rem;font-weight:700}.dashboard-data-status.is-visible{display:block}";
        document.head.appendChild(style);
    }

    function ensureStatusElement() {
        ensureStyle();
        let element = document.getElementById("dashboardDataStatus");
        if (element) return element;
        const grid = document.querySelector(".kpi-grid");
        if (!grid || !grid.parentNode) return null;
        element = document.createElement("div");
        element.id = "dashboardDataStatus";
        element.className = "dashboard-data-status";
        element.setAttribute("role", "status");
        element.setAttribute("aria-live", "polite");
        element.hidden = true;
        grid.parentNode.insertBefore(element, grid);
        return element;
    }

    function setStatus(message) {
        const element = ensureStatusElement();
        if (!element) return;
        const text = String(message || "").trim();
        element.textContent = text;
        element.hidden = !text;
        element.classList.toggle("is-visible", Boolean(text));
    }

    function setKpisUnavailable(options = {}) {
        ["kpiRevenueYear", "kpiRecurringRevenue", "kpiTotalClients"].forEach(function (id) {
            const element = document.getElementById(id);
            if (element) element.textContent = "--";
        });
        if (options.preserveActiveOrders === true) return;
        const activeOrdersEl = document.getElementById("kpiActiveOrders");
        if (!activeOrdersEl) return;
        activeOrdersEl.querySelectorAll("[data-kpi-active-website], [data-kpi-active-business], [data-kpi-active-voice], [data-kpi-active-chatbot]").forEach(function (element) {
            element.textContent = "--";
        });
        activeOrdersEl.setAttribute("aria-label", "Actieve opdrachten tijdelijk niet geladen");
    }

    const api = Object.freeze({
        clear() {
            hasClearedUnavailable = true;
            setStatus("");
        },
        setKpisUnavailable,
        showUnavailable(options = {}) {
            setStatus(unavailableMessage);
            setKpisUnavailable(options);
        },
        unavailableMessage,
    });
    if (global && global.document) global.SoftoraDashboardDataStatus = api;

    function readCustomersBootstrapPayload() {
        const element = document.getElementById("softoraCustomersBootstrap");
        if (!element) return null;
        try {
            return JSON.parse(String(element.textContent || "{}"));
        } catch (_) {
            return null;
        }
    }

    function shouldShowUnavailableForEmptyBootstrap(payload) {
        const values = payload && payload.activeOrdersState && payload.activeOrdersState.values && typeof payload.activeOrdersState.values === "object" ? payload.activeOrdersState.values : {};
        if (payload && (payload.ok === false || payload.source === "unavailable")) return true;
        return payload && payload.ok === true && payload.source === "empty" && Array.isArray(payload.customers) && payload.customers.length === 0 && Object.keys(values).length === 0;
    }

    function hasLoadedActiveOrdersBootstrap(payload) {
        const state = payload && payload.activeOrdersState && typeof payload.activeOrdersState === "object" ? payload.activeOrdersState : null;
        const source = String(state && state.source || "").trim().toLowerCase();
        const values = state && state.values && typeof state.values === "object" && !Array.isArray(state.values) ? state.values : null;
        const orderKey = "softora_custom_orders_premium_v1";
        const hasOrderList = Boolean(values && (
            Object.prototype.hasOwnProperty.call(values, orderKey) ||
            Object.prototype.hasOwnProperty.call(values, `${orderKey}_chunks_v1`)
        ));
        return Boolean(hasOrderList && source && source !== "unavailable" && source !== "bootstrap-timeout");
    }

    function showUnavailableForEmptyBootstrap() {
        if (hasClearedUnavailable) return;
        const payload = readCustomersBootstrapPayload();
        if (shouldShowUnavailableForEmptyBootstrap(payload)) {
            api.showUnavailable({ preserveActiveOrders: hasLoadedActiveOrdersBootstrap(payload) });
        }
    }

    function scheduleUnavailableForEmptyBootstrap() {
        global.setTimeout(showUnavailableForEmptyBootstrap, 3200);
    }

    if (typeof module === "object" && module.exports) {
        module.exports = Object.freeze({ ...api, hasLoadedActiveOrdersBootstrap, shouldShowUnavailableForEmptyBootstrap });
    }

    if (typeof document !== "undefined") {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", scheduleUnavailableForEmptyBootstrap, { once: true });
        } else {
            scheduleUnavailableForEmptyBootstrap();
        }
    }
})(typeof window !== "undefined" ? window : globalThis);
