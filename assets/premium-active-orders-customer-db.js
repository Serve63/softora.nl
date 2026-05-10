(function (root) {
    'use strict';

    function readRemoteStateValue(values, key) {
        return String(
            root.SoftoraActiveOrdersBoot?.readChunkedStateValue?.(values, key) ??
            values?.[key] ??
            ''
        );
    }

    function buildStatePatch(key, value) {
        return root.SoftoraActiveOrdersBoot?.buildStateWritePatch?.(key, value) || {
            [String(key || '').trim()]: String(value ?? '')
        };
    }

    function createCustomerDbHelpers(deps = {}) {
        const {
            customerDbScope = 'premium_customers_database',
            customerDbKey = 'softora_customers_premium_v1',
            fetchUiStateGetWithFallback = async () => ({}),
            fetchUiStateSetWithFallback = async () => ({}),
            parseCustomerDatabase = () => [],
            getOrderCustomerMatchKey = () => '',
            getCustomOrders = () => [],
        } = deps;

        async function readCustomerDatabase() {
            try {
                const remoteState = await fetchUiStateGetWithFallback(customerDbScope);
                const rawCustomers = readRemoteStateValue(remoteState?.values, customerDbKey);
                const remoteCustomers = parseCustomerDatabase(rawCustomers);
                if (remoteCustomers.length) return remoteCustomers;
            } catch (_) {
                return [];
            }
            return [];
        }

        async function persistCustomerDatabase(customers) {
            const serialized = JSON.stringify(Array.isArray(customers) ? customers : []);
            await fetchUiStateSetWithFallback(customerDbScope, {
                patch: buildStatePatch(customerDbKey, serialized),
                source: 'premium-actieve-opdrachten',
                actor: 'browser'
            });
        }

        async function syncCustomerDatabaseAfterOrderRemoval(record) {
            const customerKey = getOrderCustomerMatchKey(record);
            if (!customerKey) return;

            const currentOrders = Array.isArray(getCustomOrders()) ? getCustomOrders() : [];
            const hasRemainingOrder = currentOrders.some((item) => {
                return Number(item?.id) !== Number(record?.id) && getOrderCustomerMatchKey(item) === customerKey;
            });
            if (hasRemainingOrder) return;

            const customers = await readCustomerDatabase();
            if (!customers.length) return;

            const nextCustomers = customers.filter((customer) => {
                return getOrderCustomerMatchKey(customer) !== customerKey;
            });

            if (nextCustomers.length === customers.length) return;
            await persistCustomerDatabase(nextCustomers);
        }

        return Object.freeze({
            readCustomerDatabase,
            persistCustomerDatabase,
            syncCustomerDatabaseAfterOrderRemoval,
        });
    }

    root.SoftoraActiveOrdersCustomerDb = Object.freeze({
        createCustomerDbHelpers,
    });
})(typeof window !== 'undefined' ? window : globalThis);
