// Client side of the versioned read-model protocol (docs/platform-performance.md).
// It sends the version of the verified local copy; an "unchanged" answer is
// completed from that copy, a full answer replaces it. Pages never touch
// browser storage themselves: SoftoraReadModelStore owns the copies.
(function (global) {
    "use strict";

    const VERSION_HEADER = "X-Softora-Readmodel-Version";
    const VERSION_PATTERN = /^rm1-[a-f0-9]{40}$/;

    function identityOf(session) {
        const value = session && session.authenticated ? (session.userId || session.email) : "";
        return String(value || "").trim().toLowerCase();
    }

    function whenIdle(callback) {
        if (typeof global.requestIdleCallback === "function") global.requestIdleCallback(callback, { timeout: 5000 });
        else setTimeout(callback, 3000);
    }

    function pick(source, names) {
        const picked = {};
        names.forEach(function (name) {
            if (Object.prototype.hasOwnProperty.call(source, name)) picked[name] = source[name];
        });
        return picked;
    }

    async function readJson(response) {
        try { return await response.json(); } catch (_error) { return null; }
    }

    // options: { key, path, fetchImpl, store?, session? }. Resolves { response, payload }.
    async function fetchJson(url, init, options) {
        const config = options || {};
        const fetchImpl = config.fetchImpl || global.fetch;
        const store = config.store === undefined ? global.SoftoraReadModelStore : config.store;
        const identity = identityOf(config.session || global.SoftoraPageBootstrapSession?.get?.());
        const storeKey = "versioned:" + String(config.key || "").trim();
        const path = String(config.path || "").trim();
        const canCache = Boolean(store && identity && config.key && path);
        let local = null;
        if (canCache && config.skipLocal !== true) {
            try {
                local = await store.read(storeKey, identity);
                if (!local || !VERSION_PATTERN.test(String(local.version || "")) || !local.fields || typeof local.fields !== "object") local = null;
            } catch (_error) { local = null; }
        }
        const headers = Object.assign({}, init && init.headers);
        if (local) headers[VERSION_HEADER] = local.version;
        const response = await fetchImpl(url, Object.assign({}, init, { headers: headers }));
        const payload = await readJson(response);
        const part = payload && path ? payload[path] : null;
        const meta = part && part.readModel;
        if (!response.ok || !part || !meta) return { response: response, payload: payload };
        if (meta.unchanged === true) {
            if (local && local.version === meta.version) {
                payload[path] = Object.assign({}, part, local.fields);
                return { response: response, payload: payload };
            }
            // The copy vanished between read and answer: ask once for the full part.
            return fetchJson(url, init, Object.assign({}, config, { skipLocal: true }));
        }
        if (canCache && Array.isArray(meta.fields) && VERSION_PATTERN.test(String(meta.version || ""))) {
            const copy = { version: meta.version, fields: pick(part, meta.fields) };
            whenIdle(function () {
                Promise.resolve(store.write(storeKey, identity, copy)).catch(function () { return false; });
            });
        }
        return { response: response, payload: payload };
    }

    const api = Object.freeze({ fetchJson: fetchJson, versionHeader: VERSION_HEADER });
    global.SoftoraReadModelClient = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
