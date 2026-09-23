// Mailsysteem screen snapshot: the table area opens as it was last shown for
// the same filter, search and sort, instead of "Database laden...". The page's
// first complete render replaces it; until then rows and buttons are inert.
(function (global) {
    "use strict";

    const ELEMENTS = Object.freeze([
        { id: "tbody", html: true },
        { id: "databaseTable", className: true },
        { id: "statusHeader", hidden: true },
        { id: "outreachActionHeader", hidden: true, text: true },
        { id: "photoHeader", hidden: true },
        { id: "daysHeader", hidden: true },
        { id: "photoHeaderTitle", hidden: true },
        { id: "photoHeaderLabel", text: true },
        { id: "photoHeaderCount", text: true },
        { id: "generatePhotosButton", hidden: true },
        { id: "photoHeaderResultsLabel", text: true },
        { id: "loadMoreWrap", hidden: true },
        { id: "loadMoreSummary", text: true }
    ]);
    const INERT_IDS = Object.freeze(["tbody", "loadMoreWrap", "generatePhotosButton"]);

    function viewOf(state) {
        const current = state || {};
        return JSON.stringify([current.activeStatus || "", current.query || "", current.sortKey || "",
            current.sortAsc === true, Number(current.visibleLimit) || 0]);
    }

    let snapshot = null;
    function instance() {
        if (!snapshot && global.SoftoraScreenSnapshot) {
            snapshot = global.SoftoraScreenSnapshot.create({ key: "premium-database:v1", elements: ELEMENTS, inertIds: INERT_IDS });
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
    global.SoftoraDatabaseScreenSnapshot = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
