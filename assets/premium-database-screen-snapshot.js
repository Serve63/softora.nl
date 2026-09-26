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
        { id: "loadMoreSummary", text: true },
        { id: "mailReadySoftoraCount", text: true },
        { id: "mailReadyInstantlyCount", text: true }
    ]);
    const INERT_IDS = Object.freeze(["tbody", "loadMoreWrap", "generatePhotosButton"]);

    function viewOf(state) {
        const current = state || {};
        return JSON.stringify([current.activeStatus || "", current.query || "", current.sortKey || "",
            current.sortAsc === true, Number(current.visibleLimit) || 0]);
    }

    function isPreparing(state) {
        return !state.dataUnavailable && !state.photoRestoreFailed &&
            (state.dataLoading || !state.remoteCustomersLoaded || state.photoRestorePending);
    }

    // Keep the default table when another tab, search or expanded list is opened.
    // Only the fixed first-page views get their own slot; custom views share one
    // bounded slot. All copies retain the shared identity/age/logout protection.
    function createAdapter(options = {}) {
        const create = options.create || global.SoftoraScreenSnapshot?.create;
        const sentReady = options.sentReady || function () { return global.SoftoraDatabaseSentRegister?.isReady?.() === true; };
        const sentPending = options.sentPending || function () { return global.SoftoraDatabaseSentRegister?.isPending?.() === true; };
        const snapshots = new Map();
        const statuses = new Set(["beschikbaar", "benaderbaar", "instantly-ready", "instantly-queued", "instantly-wachtlijst", "benaderd", "instantly", "verstuurd"]);
        let active = null, activeView = "", legacy = null;
        function instance(state) {
            if (!create) return null;
            const standard = !state.query && state.sortKey === "distance" && state.sortAsc === true && state.visibleLimit === 25;
            const slot = standard && statuses.has(state.activeStatus) ? state.activeStatus : "custom";
            if (!snapshots.has(slot)) snapshots.set(slot, create({
                key: "premium-database:v2:" + slot, elements: ELEMENTS, inertIds: INERT_IDS, maxChars: 180000
            }));
            return snapshots.get(slot);
        }
        function release() { if (active) active.release(); active = null; activeView = ""; }
        function restore(state) {
            const view = viewOf(state);
            if (activeView === view && active?.isShowing()) return true;
            release();
            let current = instance(state);
            if (!current?.restore(view)) {
                if (!create) return false;
                legacy = legacy || create({ key: "premium-database:v1", elements: ELEMENTS.slice(0, -2), inertIds: INERT_IDS });
                if (!legacy.restore(view)) return false;
                current = legacy;
            }
            active = current; activeView = view;
            return true;
        }
        function complete(state) {
            return state.canonicalInventoryReady === true && state.remoteCustomersLoaded === true &&
                !state.dataLoading && !state.dataUnavailable && !state.photoRestorePending && !state.photoRestoreFailed &&
                (state.activeStatus !== "verstuurd" || sentReady());
        }
        return Object.freeze({
            viewOf, restore, release,
            isShowing: function () { return Boolean(active?.isShowing()); },
            hold: function (state) {
                if (state.dataUnavailable || state.photoRestoreFailed ||
                    (!isPreparing(state) && !(state.activeStatus === "verstuurd" && sentPending()))) return false;
                return restore(state);
            },
            capture: function (state) {
                if (!complete(state) || active?.isShowing()) return;
                // Commit before another click/navigation can change the DOM.
                instance(state)?.capture(viewOf(state), { immediate: true });
            }
        });
    }
    let adapter;
    function current() { return adapter || (adapter = createAdapter()); }
    const api = Object.freeze({ viewOf, createAdapter, isPreparing,
        restore: function (state) { return current().restore(state); },
        hold: function (state) { return current().hold(state); },
        isShowing: function () { return current().isShowing(); },
        release: function () { current().release(); },
        capture: function (state) { current().capture(state); }
    });
    global.SoftoraDatabaseScreenSnapshot = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
