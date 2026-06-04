(function (global) {
    "use strict";

    const unavailableMessage = "Supabase-data tijdelijk niet geladen. Je data is niet verwijderd; probeer zo opnieuw.";

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

    function setKpisUnavailable() {
        ["kpiRevenueYear", "kpiRecurringRevenue", "kpiTotalClients"].forEach(function (id) {
            const element = document.getElementById(id);
            if (element) element.textContent = "--";
        });
        const activeOrdersEl = document.getElementById("kpiActiveOrders");
        if (!activeOrdersEl) return;
        activeOrdersEl.querySelectorAll("[data-kpi-active-website], [data-kpi-active-business], [data-kpi-active-voice], [data-kpi-active-chatbot]").forEach(function (element) {
            element.textContent = "--";
        });
        activeOrdersEl.setAttribute("aria-label", "Actieve opdrachten tijdelijk niet geladen");
    }

    global.SoftoraDashboardDataStatus = Object.freeze({
        clear() {
            setStatus("");
        },
        setKpisUnavailable,
        showUnavailable() {
            setStatus(unavailableMessage);
            setKpisUnavailable();
        },
        unavailableMessage,
    });
})(window);
