(function (root, createRefresh) {
    if (typeof module === 'object' && module.exports) module.exports = createRefresh;
    else root.SoftoraDashboardRefresh = createRefresh;
})(typeof window !== 'undefined' ? window : globalThis, function (deps) {
    'use strict';
    const { root, state, loadOrders, loadCustomers, render, renderPending, showUnavailable } = deps;
    const delays = [1500, 4000, 9000, 15000];
    let mounted = false;
    let disposed = false;
    let generation = 0;
    let attempts = 0;
    let recoveryTimer = null;
    let pollTimer = null;
    let pending = null;
    let lastRefreshAt = 0;
    let retryOrders = false;
    let retryCustomers = false;

    function clearRecovery() {
        if (recoveryTimer !== null) root.clearTimeout(recoveryTimer);
        recoveryTimer = null;
        attempts = 0;
    }

    function scheduleRecovery() {
        if (disposed || recoveryTimer !== null || attempts >= delays.length) return;
        recoveryTimer = root.setTimeout(() => {
            recoveryTimer = null;
            void refresh(true, true);
        }, delays[attempts++]);
    }

    function refresh(force = false, onlyMissing = false) {
        if (disposed) return Promise.resolve(false);
        if (pending) return pending;
        const now = (root.Date || Date).now();
        if (!force && lastRefreshAt && now - lastRefreshAt < 1200) return Promise.resolve(false);
        const run = generation;
        const current = () => !disposed && run === generation;
        const shouldLoadOrders = !onlyMissing || retryOrders || !state.ordersHydrated;
        const shouldLoadCustomers = !onlyMissing || retryCustomers || !state.customersHydrated;
        // Render whichever read finishes first, but complete only after BOTH reads settle.
        const ordersPromise = shouldLoadOrders ? Promise.resolve().then(() => loadOrders(current)) : Promise.resolve(true);
        const customersPromise = shouldLoadCustomers ? Promise.resolve().then(() => loadCustomers(current)) : Promise.resolve(true);
        const ordersResult = ordersPromise.then(loaded => {
            if (!current()) return false;
            if (loaded) {
                if (state.customersHydrated) render();
                else renderPending();
            }
            return Boolean(loaded);
        }).catch(() => false);
        const customersResult = customersPromise.then(loaded => {
            if (!current()) return false;
            if (loaded) render();
            else showUnavailable();
            return Boolean(loaded);
        }).catch(() => { if (current()) showUnavailable(); return false; });
        pending = Promise.all([ordersResult, customersResult]).then(results => {
            if (!current()) return false;
            retryOrders = !results[0];
            retryCustomers = !results[1];
            const complete = results.every(Boolean) && state.ordersHydrated && state.customersHydrated;
            if (complete) clearRecovery();
            else scheduleRecovery();
            lastRefreshAt = (root.Date || Date).now();
            return Boolean(complete);
        }).finally(() => { if (run === generation) pending = null; });
        return pending;
    }

    function refreshWhenVisible() {
        if (!root.document.hidden) void refresh();
    }

    function mount() {
        if (mounted) return;
        disposed = false;
        mounted = true;
        pollTimer = root.setInterval(refreshWhenVisible, 30000);
        root.addEventListener('focus', refreshWhenVisible);
        root.document.addEventListener('visibilitychange', refreshWhenVisible);
        root.addEventListener('pagehide', dispose, { once: true });
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        mounted = false;
        generation += 1;
        clearRecovery();
        if (pollTimer !== null) root.clearInterval(pollTimer);
        pollTimer = null;
        root.removeEventListener('focus', refreshWhenVisible);
        root.document.removeEventListener('visibilitychange', refreshWhenVisible);
        root.removeEventListener('pagehide', dispose);
        pending = null;
    }

    return Object.freeze({ refresh, mount, dispose });
});
