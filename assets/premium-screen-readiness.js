(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root && root.document && !root.SoftoraScreenReadiness) {
        root.SoftoraScreenReadiness = api.createPremiumScreenReadiness({
            window: root,
            document: root.document,
        });
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const IMAGE_TIMEOUT_MS = 10000;
    const SHELL_TIMEOUT_MS = 10000;

    function allRequiredDataReady(data) {
        const entries = Object.entries(data && typeof data === 'object' ? data : {});
        return entries.length > 0 && entries.every(([, ready]) => ready === true);
    }

    function waitForDocumentLoad(win, doc) {
        if (!win || !doc || doc.readyState === 'complete') return Promise.resolve();
        return new Promise((resolve) => {
            win.addEventListener('load', resolve, { once: true });
        });
    }

    function waitForPersonnelShell(win, doc) {
        const element = doc && doc.documentElement;
        const isLoading = () => Boolean(element?.hasAttribute?.('data-personnel-loading'));
        if (!isLoading()) return Promise.resolve();

        return new Promise((resolve, reject) => {
            const Observer = win && win.MutationObserver;
            if (typeof Observer !== 'function') {
                reject(new Error('De gedeelde zijbalk kan niet op gereedheid worden gecontroleerd.'));
                return;
            }
            let settled = false;
            let timer;
            const observer = new Observer(() => { if (!isLoading()) finish(); });
            const finish = (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                observer.disconnect();
                if (error) reject(error);
                else resolve();
            };
            timer = setTimeout(() => finish(new Error('De gedeelde zijbalk reageert niet op tijd.')), SHELL_TIMEOUT_MS);
            try {
                observer.observe(element, { attributes: true, attributeFilter: ['data-personnel-loading'] });
                if (!isLoading()) finish();
            } catch (error) { finish(error); }
        });
    }

    function waitForImage(image, timeoutMs) {
        const src = String(image && (image.currentSrc || image.src) || '').trim();
        if (!src) return Promise.reject(new Error('Een vereiste pagina-afbeelding heeft geen bron.'));

        const verify = async () => {
            if (!image.complete || !(Number(image.naturalWidth) > 0)) {
                throw new Error('Een vereiste pagina-afbeelding is niet volledig geladen.');
            }
            if (typeof image.decode === 'function') await image.decode();
        };
        if (image.complete) return verify();

        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => finish(new Error('Een vereiste pagina-afbeelding reageert niet op tijd.')), timeoutMs);
            const cleanup = () => {
                clearTimeout(timer);
                image.removeEventListener('load', onLoad);
                image.removeEventListener('error', onError);
            };
            const finish = (error) => {
                if (settled) return;
                settled = true;
                cleanup();
                if (error) reject(error);
                else resolve();
            };
            const onLoad = () => { void verify().then(() => finish(), finish); };
            const onError = () => finish(new Error('Een vereiste pagina-afbeelding kon niet worden geladen.'));
            image.addEventListener('load', onLoad, { once: true });
            image.addEventListener('error', onError, { once: true });
            if (image.complete) onLoad();
        });
    }

    function createPremiumScreenReadiness(options) {
        const config = options || {};
        const win = config.window || (typeof window !== 'undefined' ? window : null);
        const doc = config.document || (win && win.document) || null;
        const performanceApi = config.performance || (win && win.performance) || null;
        const startedAt = Number.isFinite(Number(config.startedAt))
            ? Number(config.startedAt)
            : 0;
        let status = 'loading';
        let page = '';
        let readyTask = null;
        let lastError = '';

        function elapsedMs() {
            const now = performanceApi && typeof performanceApi.now === 'function'
                ? performanceApi.now()
                : Date.now();
            return Math.max(0, Math.round(now - startedAt));
        }

        function emit(name, detail) {
            if (!doc || typeof doc.dispatchEvent !== 'function' || !win || typeof win.CustomEvent !== 'function') return;
            try { doc.dispatchEvent(new win.CustomEvent(name, { detail })); } catch (_) { /* telemetry mag de pagina niet breken */ }
        }

        function markDegraded(input) {
            const reason = String(input && input.reason || 'page-not-ready').slice(0, 120);
            page = String(input && input.page || page).trim();
            status = 'degraded';
            lastError = reason;
            if (doc && doc.documentElement) {
                doc.documentElement.dataset.softoraScreenState = status;
                doc.documentElement.dataset.softoraScreenIssue = reason;
            }
            emit('softora:screen-degraded', { page, reason, elapsedMs: elapsedMs() });
            return false;
        }

        async function waitForFonts() {
            const fontSet = doc && doc.fonts;
            if (fontSet && fontSet.ready) await fontSet.ready;
        }

        async function waitForImages(images) {
            const list = Array.from(images || []).filter(Boolean);
            await Promise.all(list.map((image) => waitForImage(image, IMAGE_TIMEOUT_MS)));
        }

        function markReady(input) {
            const request = input || {};
            page = String(request.page || page).trim();
            const actionsPresent = Array.from(request.requiredActions || []).every((selector) =>
                Boolean(doc && typeof doc.querySelector === 'function' && doc.querySelector(String(selector)))
            );
            if (status === 'ready') return Promise.resolve(true);
            const canCheckActionBindings = request.actionsBound === true || typeof request.actionsBound === 'function';
            if (!allRequiredDataReady(request.requiredData) || !canCheckActionBindings || !actionsPresent) {
                return Promise.resolve(false);
            }
            if (readyTask) return readyTask;

            readyTask = (async () => {
                await waitForDocumentLoad(win, doc);
                await Promise.all([
                    waitForPersonnelShell(win, doc),
                    waitForFonts(),
                    waitForImages(request.requiredImages || []),
                ]);
                const actionsStillPresent = Array.from(request.requiredActions || []).every((selector) =>
                    Boolean(doc && typeof doc.querySelector === 'function' && doc.querySelector(String(selector)))
                );
                const actionsBound = typeof request.actionsBound === 'function'
                    ? request.actionsBound() === true
                    : request.actionsBound === true;
                if (!allRequiredDataReady(request.requiredData) || !actionsBound || !actionsStillPresent) return false;

                status = 'ready';
                lastError = '';
                const duration = elapsedMs();
                const detail = Object.freeze({ page, status, elapsedMs: duration });
                if (doc && doc.documentElement) {
                    doc.documentElement.dataset.softoraScreenState = status;
                    doc.documentElement.dataset.softoraScreenReadyMs = String(duration);
                    delete doc.documentElement.dataset.softoraScreenIssue;
                }
                if (performanceApi && typeof performanceApi.mark === 'function') {
                    try { performanceApi.mark('softora:screen-ready'); } catch (_) { /* browser timing is optional */ }
                }
                emit('softora:screen-ready', detail);
                return true;
            })().catch((error) => markDegraded({ page, reason: error && error.message || 'page-readiness-failed' }))
                .finally(() => { readyTask = null; });
            return readyTask;
        }

        if (doc && doc.documentElement && !doc.documentElement.dataset.softoraScreenState) {
            doc.documentElement.dataset.softoraScreenState = 'loading';
        }

        return Object.freeze({
            markReady,
            markDegraded,
            getState: () => Object.freeze({ status, page, elapsedMs: elapsedMs(), issue: lastError }),
        });
    }

    return Object.freeze({ createPremiumScreenReadiness });
});
