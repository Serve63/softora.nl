(function (root, factory) {
    const api = factory(root);
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.SoftoraPremiumDashboardCore = api;
    }
})(typeof window !== "undefined" ? window : globalThis, function (root) {
    "use strict";

function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

function normalizeDashboardString(value) {
        return String(value || '').trim();
    }

function normalizeDashboardTime(value, fallback) {
        const raw = normalizeDashboardString(value);
        return /^\d{2}:\d{2}$/.test(raw) ? raw : fallback;
    }

function normalizeDashboardDate(value) {
        const raw = normalizeDashboardString(value);
        const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
        return match ? match[1] : '';
    }

function getExplicitRevenueDate(value) {
        const raw = normalizeDashboardString(value);
        if (!raw) return null;
        const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
            ? new Date(raw + 'T12:00:00')
            : new Date(raw);
        return Number.isNaN(date.getTime()) ? null : date;
    }

function getEffectiveRevenueDate(value, nowDate = new Date()) {
        const explicitDate = getExplicitRevenueDate(value);
        if (explicitDate) return explicitDate;
        const nowValue = nowDate instanceof Date && !Number.isNaN(nowDate.getTime()) ? nowDate : new Date();
        return new Date(nowValue.getFullYear(), nowValue.getMonth(), 1, 12, 0, 0);
    }

function normalizeDashboardIdentityValue(value) {
        return normalizeDashboardString(value)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

function getDashboardIdentityTokens(...values) {
        const tokens = new Set();
        values.forEach((value) => {
            const normalized = normalizeDashboardIdentityValue(value);
            if (!normalized || normalized === '-' || normalized === 'onbekend') return;
            if (normalized.length >= 3) tokens.add(normalized);
            normalized.split(/\s+/).forEach((part) => {
                if (part.length >= 4) tokens.add(part);
            });
        });
        return Array.from(tokens);
    }

function findPaidDashboardOrderForCustomer(customer, paidOrders) {
        const customerTokens = getDashboardIdentityTokens(customer?.naam, customer?.bedrijf, customer?.telefoon);
        if (!customerTokens.length) return null;

        return (Array.isArray(paidOrders) ? paidOrders : []).find((order) => {
            const orderTokens = getDashboardIdentityTokens(
                order?.clientName,
                order?.location,
                order?.companyName,
                order?.contactName,
                order?.contactPhone
            );
            if (!orderTokens.length) return false;
            return customerTokens.some((customerToken) =>
                orderTokens.some((orderToken) =>
                    customerToken === orderToken ||
                    customerToken.includes(orderToken) ||
                    orderToken.includes(customerToken)
                )
            );
        }) || null;
    }

function getCustomerRevenueDate(customer, paidOrders, nowDate = new Date()) {
        const explicitCustomerDate = getExplicitRevenueDate(customer?.datum);
        if (explicitCustomerDate) return explicitCustomerDate;

        const matchedPaidOrder = findPaidDashboardOrderForCustomer(customer, paidOrders);
        const matchedPaidDate = getExplicitRevenueDate(matchedPaidOrder?.ui?.paidAt || matchedPaidOrder?.paidAt);
        return matchedPaidDate || getEffectiveRevenueDate(customer?.datum, nowDate);
    }

function getPremiumDashboardChunkMetaKey(baseKey) {
        return `${normalizeDashboardString(baseKey)}_chunks_v1`;
    }

function getPremiumDashboardChunkPrefix(baseKey) {
        return `${normalizeDashboardString(baseKey)}_chunk_`;
    }

function readPremiumDashboardChunkedStateValue(values, baseKey) {
        const stateValues = values && typeof values === 'object' ? values : {};
        const normalizedKey = normalizeDashboardString(baseKey);
        const fallback = typeof stateValues[normalizedKey] === 'string' ? stateValues[normalizedKey] : '';
        const metaRaw = normalizeDashboardString(stateValues[getPremiumDashboardChunkMetaKey(normalizedKey)]);
        if (!metaRaw) return fallback;

        try {
            const meta = JSON.parse(metaRaw);
            const count = Math.max(0, Math.min(100, Number(meta && meta.count) || 0));
            if (!count) return fallback;

            const prefix = getPremiumDashboardChunkPrefix(normalizedKey);
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

function formatMoneyEUR(amount) {
        const value = Number(amount) || 0;
        return '€' + value.toLocaleString('nl-NL');
    }

	function formatProjectMeta(order) {
	        const parts = [];
	        if (order?.location) parts.push(order.location);
	        parts.push(formatMoneyEUR(order?.amount || 0));
	        if (order?.ui?.isBuilt && !order?.ui?.isPaid) parts.push('wacht op betaling');
	        return parts.join(' • ');
	    }

    const PREMIUM_DASHBOARD_UI_STATE_TIMEOUT_MS = 6000;
    const PREMIUM_DASHBOARD_BOOT_WATCHDOG_MS = 3500;
    let premiumDashboardBootWatchdog = null;
    let premiumDashboardBootReleased = false;
    let premiumDashboardBootFailSafeInstalled = false;

    function getDashboardTimerRoot() {
        return root && typeof root.setTimeout === 'function' && typeof root.clearTimeout === 'function'
            ? root
            : globalThis;
    }

    function forcePremiumDashboardBootShellVisible() {
        const doc = root && root.document ? root.document : null;
        const main = doc ? doc.querySelector('main.is-premium-boot-host') : null;
        const loader = main ? main.querySelector('.premium-boot-loader') : null;
        const shell = main ? main.querySelector('.premium-boot-shell') : null;
        if (loader) {
            loader.classList.add('is-hidden');
            loader.setAttribute('aria-hidden', 'true');
            loader.style.opacity = '0';
            loader.style.visibility = 'hidden';
        }
        if (shell) {
            shell.classList.remove('is-booting');
            shell.setAttribute('aria-busy', 'false');
            shell.style.opacity = '';
            shell.style.pointerEvents = '';
            shell.style.userSelect = '';
        }
    }

    function releasePremiumDashboardBootShell() {
        if (premiumDashboardBootReleased) {
            forcePremiumDashboardBootShellVisible();
            return;
        }
        premiumDashboardBootReleased = true;
        const timerRoot = getDashboardTimerRoot();
        if (premiumDashboardBootWatchdog && typeof timerRoot.clearTimeout === 'function') {
            timerRoot.clearTimeout(premiumDashboardBootWatchdog);
            premiumDashboardBootWatchdog = null;
        }
        try {
            if (root?.SoftoraPremiumBoot && typeof root.SoftoraPremiumBoot.setShellBooting === 'function') {
                root.SoftoraPremiumBoot.setShellBooting(false);
            }
        } catch (_) {
            /* The direct DOM fallback below still releases the dashboard. */
        }
        forcePremiumDashboardBootShellVisible();
    }

    function startPremiumDashboardBootWatchdog() {
        if (premiumDashboardBootWatchdog || premiumDashboardBootReleased) return;
        const timerRoot = getDashboardTimerRoot();
        if (typeof timerRoot.setTimeout !== 'function') return;
        premiumDashboardBootWatchdog = timerRoot.setTimeout(
            releasePremiumDashboardBootShell,
            PREMIUM_DASHBOARD_BOOT_WATCHDOG_MS
        );
    }

    function installPremiumDashboardBootFailSafe() {
        const doc = root && root.document ? root.document : null;
        if (!doc || premiumDashboardBootFailSafeInstalled) return;
        premiumDashboardBootFailSafeInstalled = true;
        const startWatchdog = () => startPremiumDashboardBootWatchdog();
        if (doc.readyState === 'loading') {
            doc.addEventListener('DOMContentLoaded', startWatchdog, { once: true });
        } else {
            startWatchdog();
        }
        if (typeof root.addEventListener === 'function') {
            root.addEventListener('load', startWatchdog, { once: true });
            root.addEventListener('error', releasePremiumDashboardBootShell);
            root.addEventListener('unhandledrejection', releasePremiumDashboardBootShell);
        }
    }

    function readDashboardCustomersBootstrapPayload(scriptId = 'softoraCustomersBootstrap') {
        const doc = root && root.document ? root.document : null;
        const element = doc ? doc.getElementById(scriptId) : null;
        if (!element) return { customers: [] };
        try {
            const parsed = JSON.parse(String(element.textContent || '{}'));
            return parsed && typeof parsed === 'object' ? parsed : { customers: [] };
        } catch (_) {
            return { customers: [] };
        }
    }

    function hydratePremiumDashboardCustomersFromBootstrap(state, parseCustomers, payload) {
        if (!state || typeof state !== 'object' || typeof parseCustomers !== 'function') return false;
        const rawCustomers = Array.isArray(payload && payload.customers) ? payload.customers : [];
        const customers = parseCustomers(rawCustomers);
        if (!customers.length) return false;
        state.customers = customers;
        state.customersHydrated = true;
        return true;
    }

    function hydratePremiumDashboardOrdersFromBootstrap(state, parseOrders, payload) {
        if (!state || typeof state !== 'object' || typeof parseOrders !== 'function') return false;
        const values = payload && payload.activeOrdersState && typeof payload.activeOrdersState.values === 'object'
            ? payload.activeOrdersState.values
            : {};
        const orders = parseOrders(values);
        if (!orders.length) return false;
        state.orders = orders;
        state.ordersHydrated = true;
        return true;
    }

    function releasePremiumDashboardBootShellAfterMinimum(startedAt, minimumMs = 650) {
        const timerRoot = getDashboardTimerRoot();
        const elapsed = Date.now() - (Number(startedAt) || Date.now());
        const remainingMs = Math.max(0, (Number(minimumMs) || 0) - elapsed);
        if (remainingMs > 0 && typeof timerRoot.setTimeout === 'function') {
            timerRoot.setTimeout(releasePremiumDashboardBootShell, remainingMs);
            return;
        }
        releasePremiumDashboardBootShell();
    }

    async function fetchPremiumDashboardJson(url, options = {}, timeoutMs = PREMIUM_DASHBOARD_UI_STATE_TIMEOUT_MS) {
        const safeTimeoutMs = Math.max(1000, Math.min(30000, Number(timeoutMs) || PREMIUM_DASHBOARD_UI_STATE_TIMEOUT_MS));
        const AbortCtor = root && typeof root.AbortController === 'function' ? root.AbortController : globalThis.AbortController;
        const controller = typeof AbortCtor === 'function' ? new AbortCtor() : null;
        const fetchOptions = { ...(options || {}) };
        const timerRoot = getDashboardTimerRoot();
        let timeout = null;
        if (controller) {
            fetchOptions.signal = controller.signal;
            timeout = timerRoot.setTimeout(() => controller.abort(), safeTimeoutMs);
        }
        try {
            const fetchImpl = root && typeof root.fetch === 'function' ? root.fetch.bind(root) : globalThis.fetch;
            return await fetchImpl(url, fetchOptions);
        } catch (error) {
            if (String(error?.name || '') === 'AbortError') {
                throw new Error(`Dashboard data timeout na ${Math.round(safeTimeoutMs / 1000)}s`);
            }
            throw error;
        } finally {
            if (timeout) timerRoot.clearTimeout(timeout);
        }
    }

    installPremiumDashboardBootFailSafe();

	    return Object.freeze({
	        escapeHtml,
        normalizeDashboardString,
        normalizeDashboardTime,
        normalizeDashboardDate,
        getExplicitRevenueDate,
        getEffectiveRevenueDate,
        normalizeDashboardIdentityValue,
        getDashboardIdentityTokens,
        findPaidDashboardOrderForCustomer,
        getCustomerRevenueDate,
        getPremiumDashboardChunkMetaKey,
        getPremiumDashboardChunkPrefix,
	        readPremiumDashboardChunkedStateValue,
	        formatMoneyEUR,
	        formatProjectMeta,
            fetchPremiumDashboardJson,
            forcePremiumDashboardBootShellVisible,
            releasePremiumDashboardBootShell,
            releasePremiumDashboardBootShellAfterMinimum,
            readDashboardCustomersBootstrapPayload,
            hydratePremiumDashboardCustomersFromBootstrap,
            hydratePremiumDashboardOrdersFromBootstrap,
            startPremiumDashboardBootWatchdog,
	    });
});
