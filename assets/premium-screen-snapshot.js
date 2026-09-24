// Screen snapshots (docs/platform-performance.md): a page opens showing exactly
// what it last showed for the same view, while it verifies and loads current
// data in the background. The snapshot is display-only: its interactive parts
// are inert until the page's own render replaces it, so no action can ever run
// on snapshot data. Copies are scoped to the signed-in user and wiped on logout
// through SoftoraReadModelStore.
(function (global) {
    "use strict";

    const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const SNAPSHOT_FORMAT = 1;

    function identityOf() {
        const session = global.SoftoraPageBootstrapSession?.get?.();
        const value = session && session.authenticated ? (session.userId || session.email) : "";
        return String(value || "").trim().toLowerCase();
    }

    function whenIdle(callback) {
        if (typeof global.requestIdleCallback === "function") global.requestIdleCallback(callback, { timeout: 3000 });
        else setTimeout(callback, 500);
    }

    // elements: [{ id, html?, text?, hidden?, className?, disabled? }] — the
    // parts of the screen a render writes. inertIds: parts that can be clicked.
    function create(options) {
        const config = options || {};
        const key = "screen:" + String(config.key || "").trim();
        const elements = Array.isArray(config.elements) ? config.elements : [];
        const inertIds = Array.isArray(config.inertIds) ? config.inertIds : [];
        const maxAgeMs = Number(config.maxAgeMs) || DEFAULT_MAX_AGE_MS;
        const maxChars = Number(config.maxChars) || 0;
        const doc = config.document || global.document;
        const store = config.store || global.SoftoraReadModelStore;
        const now = config.now || Date.now;
        let showing = false;
        let captureScheduled = false;

        function byId(id) { return doc && typeof doc.getElementById === "function" ? doc.getElementById(id) : null; }

        function read(element, spec) {
            const part = { id: spec.id };
            if (spec.html) part.html = element.innerHTML;
            if (spec.text) part.text = element.textContent;
            if (spec.hidden) part.hidden = element.hidden === true;
            if (spec.className) part.className = element.className;
            if (spec.disabled) part.disabled = element.disabled === true;
            return part;
        }

        function apply(element, part, spec) {
            if (spec.html && typeof part.html === "string") element.innerHTML = part.html;
            if (spec.text && typeof part.text === "string") element.textContent = part.text;
            if (spec.hidden && typeof part.hidden === "boolean") element.hidden = part.hidden;
            if (spec.className && typeof part.className === "string") element.className = part.className;
            if (spec.disabled && typeof part.disabled === "boolean") element.disabled = part.disabled;
        }

        function restore(view) {
            if (showing || !store || typeof store.readSync !== "function") return false;
            const identity = identityOf();
            if (!identity) return false;
            let snapshot = null;
            try { snapshot = store.readSync(key, identity); } catch (_error) { snapshot = null; }
            if (!snapshot || snapshot.format !== SNAPSHOT_FORMAT || snapshot.view !== String(view || "") ||
                !Array.isArray(snapshot.parts) || !(now() - Number(snapshot.savedAt) < maxAgeMs)) return false;
            const partsById = new Map(snapshot.parts.map(function (part) { return [part && part.id, part]; }));
            const targets = elements.map(function (spec) { return { spec: spec, element: byId(spec.id), part: partsById.get(spec.id) }; });
            // All or nothing: a partial screen would be worse than the normal load.
            if (targets.some(function (target) { return !target.element || !target.part; })) return false;
            targets.forEach(function (target) { apply(target.element, target.part, target.spec); });
            inertIds.forEach(function (id) {
                const element = byId(id);
                if (element) { element.inert = true; element.setAttribute("data-softora-snapshot-inert", "true"); }
            });
            // Images from a snapshot may carry expired signed URLs; hide instead of a broken icon.
            targets.forEach(function (target) {
                if (!target.spec.html || typeof target.element.querySelectorAll !== "function") return;
                target.element.querySelectorAll("img").forEach(function (image) {
                    image.addEventListener("error", function () { image.style.visibility = "hidden"; }, { once: true });
                });
            });
            showing = true;
            if (doc.documentElement) doc.documentElement.setAttribute("data-softora-screen-snapshot", "showing");
            global.performance?.mark?.("softora:screen-snapshot-restored");
            return true;
        }

        function release() {
            if (!showing) return;
            showing = false;
            inertIds.forEach(function (id) {
                const element = byId(id);
                if (element && element.getAttribute("data-softora-snapshot-inert") === "true") {
                    element.inert = false;
                    element.removeAttribute("data-softora-snapshot-inert");
                }
            });
            if (doc.documentElement) doc.documentElement.removeAttribute("data-softora-screen-snapshot");
        }

        // Call after a render that shows complete, verified data. isValid is
        // checked again right before reading, so a screen that changed in the
        // meantime is never stored under this view.
        function capture(view, captureOptions) {
            const isValid = captureOptions && typeof captureOptions.isValid === "function" ? captureOptions.isValid : null;
            if (showing || captureScheduled || !store || typeof store.writeSync !== "function") return;
            captureScheduled = true;
            whenIdle(function () {
                captureScheduled = false;
                if (showing || (isValid && !isValid())) return;
                const identity = identityOf();
                if (!identity) return;
                const parts = [];
                for (const spec of elements) {
                    const element = byId(spec.id);
                    if (!element) return;
                    parts.push(read(element, spec));
                }
                if (maxChars && JSON.stringify(parts).length > maxChars) return;
                try {
                    store.writeSync(key, identity, { format: SNAPSHOT_FORMAT, view: String(view || ""), savedAt: now(), parts: parts });
                } catch (_error) { /* A full or blocked storage only costs the next instant open. */ }
            });
        }

        function discard() {
            release();
            try { store?.removeSync?.(key); } catch (_error) { /* ignore */ }
        }

        return Object.freeze({ restore: restore, release: release, capture: capture, discard: discard,
            isShowing: function () { return showing; } });
    }

    const api = Object.freeze({ create: create });
    global.SoftoraScreenSnapshot = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
