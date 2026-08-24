(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.SoftoraPremiumCustomersStore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    function createCustomerPersistence(options) {
        const config = options && typeof options === "object" ? options : {};

        async function persistCustomerUpsert(customer) {
            const normalizedCustomer = config.normalizeCustomer(customer, "klant-upsert");
            try {
                await config.fetchUiStateSetWithFallback(config.scope, {
                    patch: {
                        [config.key]: JSON.stringify([normalizedCustomer])
                    },
                    mode: "upsert",
                    upsertOnly: true,
                    source: "premium-klanten",
                    actor: "Premium klanten database"
                });
                const customerId = config.normalizeString(normalizedCustomer.id);
                let replaced = false;
                const sharedRows = config.getSharedCustomerRows().map(function (row) {
                    if (!config.isCustomerLifecycleRecord(row) || config.normalizeString(row && row.id) !== customerId) return row;
                    replaced = true;
                    return normalizedCustomer;
                });
                if (!replaced) sharedRows.push(normalizedCustomer);
                config.setSharedCustomerRows(sharedRows);
                return { ok: true };
            } catch (error) {
                return { ok: false, error: error };
            }
        }

        return Object.freeze({ persistCustomerUpsert: persistCustomerUpsert });
    }

    return Object.freeze({ createCustomerPersistence: createCustomerPersistence });
});
