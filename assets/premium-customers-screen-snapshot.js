// Klanten screen snapshot: the customer table opens as it was last shown for the
// same search instead of "Klantgegevens laden…". The first real render replaces
// it; until then the rows are inert (docs/platform-performance.md).
(function (global) {
    "use strict";

    const ELEMENTS = Object.freeze([
        { id: "customersBody", html: true },
        { id: "emptyState", hidden: true },
        { id: "customerLoadingOverlay", hidden: true }
    ]);

    function viewOf(state) {
        return JSON.stringify([String(state && state.query || "")]);
    }

    let snapshot = null;
    function instance() {
        if (!snapshot && global.SoftoraScreenSnapshot) {
            snapshot = global.SoftoraScreenSnapshot.create({ key: "premium-klanten:v1", elements: ELEMENTS, inertIds: ["customersBody"] });
        }
        return snapshot;
    }

    const api = Object.freeze({
        viewOf: viewOf,
        restore: function (state) { const current = instance(); return current ? current.restore(viewOf(state)) : false; },
        isShowing: function () { return Boolean(snapshot && snapshot.isShowing()); },
        release: function () { if (snapshot) snapshot.release(); },
        capture: function (state) { const current = instance(); if (current) current.capture(viewOf(state)); }
    });
    global.SoftoraCustomersScreenSnapshot = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
