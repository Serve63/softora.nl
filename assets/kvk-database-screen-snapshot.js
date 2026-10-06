// Bedrijvendatabase screen snapshot (docs/platform-performance.md): the page
// reopens with the counters, planning and "Recent onderzocht" it last showed,
// instead of zeros and empty panels that jump a second later. The live
// snapshot replaces every part; until the screen is complete again the planning
// and the table are inert. Copies are per user and wiped on logout.
(function (global) {
    "use strict";

    const PLANNING_PREVIEW_ITEMS = 40;
    const CAPTURE_INTERVAL_MS = 30000;
    const COMPLETE_POLL_MS = 250;
    const COUNTERS = ["companies-usable", "companies-with-website", "companies-without-website", "companies-total",
        "companies-treated", "companies-successful-found", "companies-control-room", "companies-declared-unusable"];
    const DELTAS = ["companies-usable-last60", "companies-with-website-last60", "companies-without-website-last60",
        "companies-treated-last60", "companies-successful-found-last60", "companies-control-room-last60",
        "companies-declared-unusable-last60"];
    const ELEMENTS = Object.freeze([
        ...COUNTERS.map(function (id) { return { id: id, text: true }; }),
        ...DELTAS.map(function (id) { return { id: id, html: true, className: true }; }),
        { id: "location-summary", text: true },
        { id: "location-list", html: true },
        { id: "latest-luna-errors-table-head", html: true },
        { id: "latest-luna-errors-table-body", html: true },
        { id: "latest-robot-location", text: true, hidden: true },
        { id: "latest-codex-usage", text: true, hidden: true }
    ]);
    const INERT_IDS = Object.freeze(["location-list", "latest-luna-errors-table-frame"]);

    // The full planning holds thousands of locations; only the visible top is kept.
    function planningPreview(list) {
        return {
            get innerHTML() {
                return Array.prototype.slice.call(list.children, 0, PLANNING_PREVIEW_ITEMS)
                    .map(function (item) { return item.outerHTML; }).join("");
            },
            set innerHTML(value) { list.innerHTML = value; },
            set inert(value) { list.inert = value; },
            querySelectorAll: function (selector) { return list.querySelectorAll(selector); },
            setAttribute: function (name, value) { list.setAttribute(name, value); },
            getAttribute: function (name) { return list.getAttribute(name); },
            removeAttribute: function (name) { list.removeAttribute(name); }
        };
    }

    function snapshotDocument(doc) {
        return {
            documentElement: doc.documentElement,
            getElementById: function (id) {
                const element = doc.getElementById(id);
                return id === "location-list" && element ? planningPreview(element) : element;
            }
        };
    }

    function viewOf(doc) {
        const role = doc.getElementById("latest-role-select");
        return JSON.stringify([role ? role.value : ""]);
    }

    // Complete = every part shows live data: verified directory counts, the
    // planning rows and the recent-research table.
    function isComplete(doc, metrics) {
        if (!metrics || typeof metrics.hasLiveCanonicalCounts !== "function" || !metrics.hasLiveCanonicalCounts()) return false;
        const total = doc.getElementById("companies-total");
        const list = doc.getElementById("location-list");
        const head = doc.getElementById("latest-luna-errors-table-head");
        return Boolean(total && total.textContent.trim() !== "0" &&
            list && list.querySelector(".location-item:not(.location-empty)") &&
            head && head.innerHTML.trim());
    }

    function start(options) {
        const config = options || {};
        const doc = config.document || global.document;
        const create = config.create || global.SoftoraScreenSnapshot?.create;
        const metrics = config.metrics || function () { return global.SoftoraKvkMetrics; };
        const schedule = config.setInterval || global.setInterval.bind(global);
        if (!doc || typeof create !== "function") return null;
        const snapshot = create({ key: "kvk-database:v1", elements: ELEMENTS, inertIds: INERT_IDS,
            maxChars: 200000, document: snapshotDocument(doc) });
        const view = viewOf(doc);
        snapshot.restore(view);
        let complete = false;
        function check() {
            if (!complete) {
                if (!isComplete(doc, metrics())) return;
                complete = true;
                snapshot.release();
            }
            if (!doc.hidden && viewOf(doc) === view) {
                snapshot.capture(view, { isValid: function () { return viewOf(doc) === view && isComplete(doc, metrics()); } });
            }
        }
        const poll = schedule(function () { if (!complete) check(); }, COMPLETE_POLL_MS);
        schedule(function () { if (complete) check(); }, CAPTURE_INTERVAL_MS);
        return { snapshot: snapshot, check: check, isComplete: function () { return complete; }, poll: poll };
    }

    const api = Object.freeze({ ELEMENTS: ELEMENTS, INERT_IDS: INERT_IDS, PLANNING_PREVIEW_ITEMS: PLANNING_PREVIEW_ITEMS,
        isComplete: isComplete, planningPreview: planningPreview, start: start });
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else global.SoftoraKvkScreenSnapshot = start();
})(typeof window !== "undefined" ? window : globalThis);
