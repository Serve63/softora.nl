(function (global) {
    "use strict";
    const formatter = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    function timestamp(customer) {
        const value = String(customer && customer.websitePhotoCreatedAt || "");
        return /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) || 0 : 0;
    }
    function parts(customer) {
        const ms = timestamp(customer);
        if (!ms) return null;
        const fields = Object.fromEntries(formatter.formatToParts(ms).map(function (part) { return [part.type, part.value]; }));
        return { day: fields.year + "-" + fields.month + "-" + fields.day, label: fields.day + "-" + fields.month + "-" + fields.year + " · " + fields.hour + ":" + fields.minute };
    }
    function matches(customer, day) { return !day || parts(customer)?.day === day; }
    function sort(rows, direction) {
        if (!direction) return rows;
        return rows.slice().sort(function (a, b) {
            const left = timestamp(a), right = timestamp(b);
            if (!left || !right) return left ? -1 : right ? 1 : 0;
            return direction === "oldest" ? left - right : right - left;
        });
    }
    function render(customer) {
        const date = parts(customer);
        return date ? '<button type="button" class="design-date-stamp" data-design-day="' + date.day + '" title="Toon designs gemaakt op deze datum (Nederlandse tijd)">' + date.label + '</button>' : '<span class="design-date-unknown">Aanmaakdatum onbekend</span>';
    }
    function createController(options) {
        const doc = options.document, state = options.state;
        const root = doc.getElementById("designDateFilter"), input = doc.getElementById("designDateInput"), order = doc.getElementById("designDateOrder"), clear = doc.getElementById("designDateClear");
        function change() { options.resetVisibleLimit(); options.renderPage(); }
        input.addEventListener("change", function () { state.designDate = input.value; change(); });
        order.addEventListener("change", function () { state.designDateOrder = order.value; change(); });
        clear.addEventListener("click", function () { state.designDate = ""; state.designDateOrder = ""; input.value = ""; order.value = ""; change(); });
        options.tbody.addEventListener("click", function (event) {
            const button = event.target.closest("[data-design-day]");
            if (!button) return;
            event.preventDefault(); event.stopPropagation();
            state.designDate = button.dataset.designDay; input.value = state.designDate;
            state.designDateOrder = "newest"; order.value = "newest"; change();
        });
        function sync() {
            root.hidden = !["beschikbaar", "benaderbaar", "instantly-ready"].includes(state.activeStatus);
            clear.hidden = !state.designDate && !state.designDateOrder;
        }
        return { sync, matches: function (customer) { return root.hidden || matches(customer, state.designDate); }, sort: function (rows) { return root.hidden ? rows : sort(rows, state.designDateOrder); } };
    }
    const api = { timestamp, parts, matches, sort, render, createController };
    global.SoftoraDatabaseDesignDate = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
