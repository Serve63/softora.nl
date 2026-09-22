(function (root, createBoot) {
    if (typeof module === 'object' && module.exports) module.exports = createBoot;
    else createBoot(root);
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const ACTIVE_ORDERS_BOOTSTRAP_SCRIPT_ID = 'softoraActiveOrdersBootstrap';
    const ACTIVE_ORDERS_BOOT_MIN_MS = 0;
    const ACTIVE_ORDERS_BOOT_WATCHDOG_MS = 3500;

    function getStateChunkMetaKey(baseKey) {
        return `${String(baseKey || '').trim()}_chunks_v1`;
    }

    function getStateChunkPrefix(baseKey) {
        return `${String(baseKey || '').trim()}_chunk_`;
    }

    function readChunkedStateValue(values, baseKey) {
        const stateValues = values && typeof values === 'object' ? values : {};
        const normalizedKey = String(baseKey || '').trim();
        const fallback = typeof stateValues[normalizedKey] === 'string' ? stateValues[normalizedKey] : '';
        const metaRaw = String(stateValues[getStateChunkMetaKey(normalizedKey)] || '').trim();
        if (!metaRaw) return fallback;

        try {
            const meta = JSON.parse(metaRaw);
            const count = Math.max(0, Math.min(200, Number(meta && meta.count) || 0));
            if (!count) return fallback;

            const prefix = getStateChunkPrefix(normalizedKey);
            const chunks = [];
            for (let index = 0; index < count; index += 1) {
                const chunk = stateValues[prefix + index];
                if (typeof chunk !== 'string') return fallback;
                chunks.push(chunk);
            }

            return chunks.join('') || fallback;
        } catch (_) {
            return fallback;
        }
    }

    function readStateValue(values, key) {
        return String(readChunkedStateValue(values, key));
    }

    function buildStateWritePatch(key, value) {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey) return {};
        return {
            [normalizedKey]: String(value ?? ''),
            [getStateChunkMetaKey(normalizedKey)]: ''
        };
    }

    function readActiveOrdersBootstrapPayload(scriptId = ACTIVE_ORDERS_BOOTSTRAP_SCRIPT_ID) {
        const doc = root && root.document ? root.document : null;
        const element = doc ? doc.getElementById(scriptId) : null;
        if (!element) return null;
        try {
            const parsed = JSON.parse(String(element.textContent || '{}'));
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    function requireState(data) {
        if (!data || data.ok !== true || !data.values || typeof data.values !== 'object' || Array.isArray(data.values)) {
            throw new Error('Opdrachtgegevens niet geladen. Probeer opnieuw.');
        }
        return data;
    }

    function readCompleteJsonState(values, key) {
        const metaRaw = values[getStateChunkMetaKey(key)];
        if (metaRaw) {
            const count = JSON.parse(metaRaw).count;
            if (!Number.isInteger(count) || count < 1 || count > 200) throw new Error('Ongeldig aantal delen.');
            for (let i = 0; i < count; i += 1) {
                if (typeof values[getStateChunkPrefix(key) + i] !== 'string') throw new Error('Ontbrekend deel.');
            }
        }
        return JSON.parse(readChunkedStateValue(values, key));
    }

    function hasCompleteOrdersState(snapshot) {
        if (!snapshot || snapshot.ok === false || ['unavailable', 'bootstrap-timeout'].includes(String(snapshot.source || '').toLowerCase())) return false;
        const values = snapshot.values;
        if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
        try {
            // Never replace a missing chunk with an older unchunked copy.
            if (!Array.isArray(readCompleteJsonState(values, 'softora_custom_orders_premium_v1'))) return false;
            for (const key of ['softora_order_runtime_premium_v1', 'softora_order_state_premium_v1']) {
                if (!values[key] && !values[getStateChunkMetaKey(key)]) continue;
                const parsed = readCompleteJsonState(values, key);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
            }
            return true;
        } catch (_) { return false; }
    }

    async function getState(scope, options = {}) {
        const client = root.SoftoraUiStateClient;
        if (!client?.get) throw new Error('Gedeelde gegevensclient niet beschikbaar.');
        const cached = client.peek?.(scope);
        const unusable = cached && (cached.ok !== true || (scope === 'premium_active_orders' && !hasCompleteOrdersState(cached)));
        if (options.force || unusable) client.invalidate(scope);
        return requireState(await client.get(scope));
    }

    async function setState(scope, body) {
        const client = root.SoftoraUiStateClient;
        if (!client?.set) throw new Error('Gedeelde gegevensclient niet beschikbaar.');
        const data = await client.set(scope, body);
        if (data?.ok !== true) throw new Error('Opdrachtgegevens niet opgeslagen. Probeer opnieuw.');
        return data;
    }

    function hydrateRemoteUiStateFromBootstrap(currentCache, setCache) {
        const payload = readActiveOrdersBootstrapPayload();
        const values = payload?.activeOrdersState?.values;
        if (payload?.ok === false || !hasCompleteOrdersState(payload?.activeOrdersState)) return false;

        const nextValues = {};
        Object.entries(values).forEach(([key, value]) => {
            nextValues[String(key)] = String(value ?? '');
        });
        if (!Object.keys(nextValues).length) return false;

        if (typeof setCache === 'function') {
            setCache({
                ...(currentCache && typeof currentCache === 'object' ? currentCache : {}),
                ...nextValues
            });
        }
        return true;
    }

    function releaseBootShell() {
        if (root.SoftoraPremiumBoot && typeof root.SoftoraPremiumBoot.setShellBooting === 'function') {
            root.SoftoraPremiumBoot.setShellBooting(false);
        }
    }

    function releaseAfterMinimum(startedAt) {
        const dashboardCore = root.SoftoraPremiumDashboardCore;
        if (dashboardCore && typeof dashboardCore.releasePremiumDashboardBootShellAfterMinimum === 'function') {
            dashboardCore.releasePremiumDashboardBootShellAfterMinimum(startedAt, ACTIVE_ORDERS_BOOT_MIN_MS);
            return;
        }

        const elapsed = Date.now() - (Number(startedAt) || Date.now());
        const remainingMs = Math.max(0, ACTIVE_ORDERS_BOOT_MIN_MS - elapsed);
        root.setTimeout(releaseBootShell, remainingMs);
    }

    function startWatchdog() {
        const dashboardCore = root.SoftoraPremiumDashboardCore;
        if (dashboardCore && typeof dashboardCore.startPremiumDashboardBootWatchdog === 'function') {
            dashboardCore.startPremiumDashboardBootWatchdog();
            return;
        }
        root.setTimeout(releaseBootShell, ACTIVE_ORDERS_BOOT_WATCHDOG_MS);
    }

    root.SoftoraActiveOrdersBoot = Object.freeze({
        buildStateWritePatch,
        getState,
        setState,
        hasCompleteOrdersState,
        hydrateRemoteUiStateFromBootstrap,
        readActiveOrdersBootstrapPayload,
        readChunkedStateValue,
        readStateValue,
        releaseAfterMinimum,
        startWatchdog
    });
    return root.SoftoraActiveOrdersBoot;
});
