(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.SoftoraPremiumDashboardCore = api;
    }
})(typeof window !== "undefined" ? window : globalThis, function () {
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
        return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
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

    return Object.freeze({
        escapeHtml,
        normalizeDashboardString,
        normalizeDashboardTime,
        normalizeDashboardDate,
        getPremiumDashboardChunkMetaKey,
        getPremiumDashboardChunkPrefix,
        readPremiumDashboardChunkedStateValue,
        formatMoneyEUR,
        formatProjectMeta,
    });
});
