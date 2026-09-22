(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = factory;
    else root.SoftoraDatabaseReadiness = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const METRIC_IDS = [
        'systemMailSentTodayCount', 'systemMailBouncesTodayCount', 'systemMailSentCount',
        'mailRoiAppointmentsCount', 'mailRoiDealsCount',
    ];

    function visibleImages(doc) {
        const viewportHeight = Number(root.innerHeight) || doc.documentElement?.clientHeight || 0;
        return Array.from(doc.querySelectorAll('#tbody img.photo-drop-image')).filter((image) => {
            const bounds = image.getBoundingClientRect?.();
            return bounds && bounds.bottom > 0 && bounds.top < viewportHeight;
        });
    }

    async function publish(options = {}) {
        const readiness = root.SoftoraScreenReadiness;
        if (!readiness) return false;
        const doc = root.document;
        const state = options.state || {};
        const metrics = root.SoftoraDatabaseSystemMailCount;
        await Promise.allSettled([
            metrics?.refreshTodaySentCount?.(),
            metrics?.loadPersistedDealCount?.(),
        ]);
        const metricsReady = METRIC_IDS.every((id) => {
            const value = doc.getElementById(id)?.textContent?.trim();
            return value && value !== '--';
        });
        const complete = state.canonicalInventoryReady === true &&
            state.photoRestorePending === false && state.photoRestoreFailed !== true && state.dataLoading === false;
        if (!complete || !metricsReady) {
            readiness.markDegraded({ page: 'premium-database', reason: complete ? 'mail-metrics-unavailable' : 'database-inventory-incomplete' });
            return false;
        }

        const ready = await readiness.markReady({
            page: 'premium-database',
            requiredData: { inventory: complete, metrics: metricsReady },
            requiredActions: ['#q', '#databaseTable', '#loadMoreButton', '.sf-btn[data-s]'],
            requiredImages: visibleImages(doc),
            actionsBound: () => doc.documentElement?.dataset.softoraDatabaseActionsBound === 'true',
        });
        if (!ready) readiness.markDegraded({ page: 'premium-database', reason: 'screen-readiness-contract-incomplete' });
        return ready;
    }

    return Object.freeze({ publish });
});
