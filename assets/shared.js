/**
 * shared.js — Gedeelde utility functies voor alle Softora pagina's.
 * Laad dit bestand vóór pagina-specifieke scripts.
 */

/**
 * Escape HTML-tekens om XSS te voorkomen bij directe DOM-injectie.
 * @param {*} str
 * @returns {string}
 */
function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Geeft de huidige tijd als HH:MM:SS string (nl-NL formaat).
 * @returns {string}
 */
function getTime() {
    return new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Parseer JSON veilig met een fallback waarde bij een fout.
 * @param {*} value
 * @param {*} fallback
 * @returns {*}
 */
function safeJsonParse(value, fallback) {
    try { return JSON.parse(value); } catch { return fallback; }
}

/**
 * Converteer een string naar een URL-vriendelijke slug.
 * @param {string} input
 * @returns {string}
 */
function slugify(input) {
    return String(input || '')
        .toLowerCase()
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Haal UI-state op via de API met fallback naar alternatief endpoint.
 * @param {string} scope
 * @returns {Promise<object>}
 */
async function fetchUiStateGetWithFallback(scope) {
    const encodedScope = encodeURIComponent(String(scope || ''));
    const urls = [
        `/api/ui-state-get?scope=${encodedScope}`,
        `/api/ui-state/${encodedScope}`
    ];
    let lastError = null;
    for (const url of urls) {
        try {
            const res = await fetch(url, { method: 'GET', cache: 'no-store' });
            if (!res.ok) throw new Error(`UI-state GET mislukt (${res.status})`);
            return await res.json().catch(() => ({}));
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('UI-state GET mislukt');
}

/**
 * Sla UI-state op via de API met fallback naar alternatief endpoint.
 * @param {string} scope
 * @param {object} body
 * @returns {Promise<object>}
 */
async function fetchUiStateSetWithFallback(scope, body) {
    const encodedScope = encodeURIComponent(String(scope || ''));
    const urls = [
        `/api/ui-state-set?scope=${encodedScope}`,
        `/api/ui-state/${encodedScope}`
    ];
    let lastError = null;
    for (const url of urls) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body || {})
            });
            if (!res.ok) throw new Error(`UI-state POST mislukt (${res.status})`);
            return await res.json().catch(() => ({}));
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('UI-state POST mislukt');
}
