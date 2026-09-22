(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory;
    else root.SoftoraActiveOrdersReadiness = factory(root);
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    async function publish(options = {}) {
        const readiness = root.SoftoraScreenReadiness;
        if (!readiness) return false;
        if (options.dataComplete !== true) {
            readiness.markDegraded({ page: 'premium-actieve-opdrachten', reason: 'active-order-data-unavailable' });
            return false;
        }

        const doc = root.document;
        const contentRoot = doc.querySelector('.dashboard-layout main.main-content') || doc;
        const ready = await readiness.markReady({
            page: 'premium-actieve-opdrachten',
            requiredData: { activeOrders: true },
            requiredActions: ['#createOrderBtn', '#onlyMyAssignmentsToggle', '.orders-filter-bar', '#ordersGrid'],
            requiredImages: Array.from(contentRoot.querySelectorAll('img:not([loading="lazy"])')),
            actionsBound: true,
        });
        if (!ready) readiness.markDegraded({ page: 'premium-actieve-opdrachten', reason: 'screen-readiness-contract-incomplete' });
        return ready;
    }

    return Object.freeze({ publish });
});
