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

    function isRenderedContentReady() {
        const doc = root.document;
        const requiredKpis = ['kpiRevenueYear', 'kpiRecurringRevenue', 'kpiTotalClients'];
        if (!requiredKpis.every(id => {
            const value = doc.getElementById(id)?.innerText?.trim();
            return value && value !== '--';
        })) return false;
        const active = doc.getElementById('kpiActiveOrders');
        return Boolean(active && ['website', 'business', 'voice', 'chatbot'].every(type =>
            /^\d+$/.test(active.querySelector(`[data-kpi-active-${type}]`)?.textContent?.trim() || '')));
    }

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
        const hadCompleteSnapshot = state.ordersHydrated && state.customersHydrated;
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
            else if (!hadCompleteSnapshot) showUnavailable();
            return Boolean(loaded);
        }).catch(() => { if (current() && !hadCompleteSnapshot) showUnavailable(); return false; });
        pending = Promise.all([ordersResult, customersResult]).then(results => {
            if (!current()) return false;
            retryOrders = !results[0];
            retryCustomers = !results[1];
            const complete = results.every(Boolean) && state.ordersHydrated && state.customersHydrated;
            if (complete) clearRecovery();
            else {
                if (hadCompleteSnapshot) root.SoftoraDashboardDataStatus?.showStale();
                else if (!results[0] && results[1]) showUnavailable();
                scheduleRecovery();
            }
            lastRefreshAt = (root.Date || Date).now();
            void publishScreenReadiness(complete);
            return Boolean(complete);
        }).finally(() => { if (run === generation) pending = null; });
        return pending;
    }

    function refreshWhenVisible() {
        if (!root.document.hidden) void refresh();
    }

    async function publishScreenReadiness(complete) {
        const readiness = root.SoftoraScreenReadiness;
        const dashboardCore = root.SoftoraPremiumDashboardCore;
        if (!readiness) return false;
        if (!complete) {
            // Keep the boot shell up while recovery reads are still running.
            return false;
        }

        const doc = root.document;
        const main = doc?.querySelector?.('.dashboard-layout main.main');
        const ready = await readiness.markReady({
            page: 'premium-personeel-dashboard',
            requiredData: {
                customers: state.customersHydrated,
                activeOrders: state.ordersHydrated,
            },
            requiredActions: ['#dashboardAiChatToggle', '#aiManagementConfigSave'],
            requiredImages: Array.from((main || doc).querySelectorAll('img:not([loading="lazy"])')),
            contentReady: isRenderedContentReady,
            actionsBound: () => {
                const chat = doc.getElementById('dashboardAiChatToggle');
                const save = doc.getElementById('aiManagementConfigSave');
                return chat?.dataset.softoraActionBound === 'true' && save?.dataset.softoraActionBound === 'true';
            },
        });
        if (ready) dashboardCore?.releasePremiumDashboardBootShell?.();
        else {
            readiness.markDegraded({ page: 'premium-personeel-dashboard', reason: 'screen-readiness-contract-incomplete' });
            showUnavailable();
            dashboardCore?.releasePremiumDashboardBootShell?.();
        }
        return ready;
    }

    function mount() {
        if (mounted) return;
        disposed = false;
        mounted = true;
        if (state.ordersHydrated && state.customersHydrated) void publishScreenReadiness(true);
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
