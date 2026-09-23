// Shared browser copy of verified read models (docs/platform-performance.md).
// A page shows its last verified copy only after the server confirmed or
// updated it; the copy is scoped to the signed-in user and wiped on logout.
(function (global) {
    "use strict";

    const DB_NAME = "softora-readmodels";
    const DB_VERSION = 1;
    const STORE = "models";
    const OPEN_TIMEOUT_MS = 1500;

    function indexedDbFactory(target) {
        try { return target && target.indexedDB ? target.indexedDB : null; } catch (_error) { return null; }
    }

    function normalizeIdentity(value) {
        return String(value || "").trim().toLowerCase();
    }

    function requestResult(request) {
        return new Promise(function (resolve, reject) {
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error || new Error("IndexedDB-verzoek mislukt.")); };
        });
    }

    function createReadModelStore(target, options) {
        const config = options || {};
        const openTimeoutMs = Number(config.openTimeoutMs) || OPEN_TIMEOUT_MS;
        let dbPromise = null;

        function open() {
            const factory = indexedDbFactory(target);
            if (!factory) return Promise.resolve(null);
            if (dbPromise) return dbPromise;
            dbPromise = new Promise(function (resolve) {
                let settled = false;
                const finish = function (db) {
                    if (settled) { if (db) db.close(); return; }
                    settled = true;
                    resolve(db);
                };
                // A blocked or broken IndexedDB must never delay a screen.
                const timer = setTimeout(function () { finish(null); }, openTimeoutMs);
                try {
                    const request = factory.open(DB_NAME, DB_VERSION);
                    request.onupgradeneeded = function () {
                        if (!request.result.objectStoreNames.contains(STORE)) {
                            request.result.createObjectStore(STORE, { keyPath: "model" });
                        }
                    };
                    request.onsuccess = function () {
                        clearTimeout(timer);
                        request.result.onversionchange = function () { request.result.close(); dbPromise = null; };
                        finish(request.result);
                    };
                    request.onerror = function () { clearTimeout(timer); finish(null); };
                    request.onblocked = function () { clearTimeout(timer); finish(null); };
                } catch (_error) {
                    clearTimeout(timer);
                    finish(null);
                }
            });
            return dbPromise.then(function (db) {
                if (!db) dbPromise = null;
                return db;
            });
        }

        async function withStore(mode, action) {
            const db = await open();
            if (!db) return null;
            try {
                const transaction = db.transaction(STORE, mode);
                const done = new Promise(function (resolve, reject) {
                    transaction.oncomplete = resolve;
                    transaction.onabort = function () { reject(transaction.error || new Error("IndexedDB afgebroken.")); };
                    transaction.onerror = function () { reject(transaction.error || new Error("IndexedDB mislukt.")); };
                });
                const result = await action(transaction.objectStore(STORE));
                await done;
                return result;
            } catch (_error) {
                return null;
            }
        }

        async function read(model, identity) {
            const key = String(model || "").trim();
            const owner = normalizeIdentity(identity);
            if (!key || !owner) return null;
            const record = await withStore("readonly", function (store) { return requestResult(store.get(key)); });
            if (!record) return null;
            if (record.identity !== owner) {
                // Another user's copy is never shown; remove it immediately.
                await clearAll();
                return null;
            }
            return record.value === undefined ? null : record.value;
        }

        async function write(model, identity, value) {
            const key = String(model || "").trim();
            const owner = normalizeIdentity(identity);
            if (!key || !owner || value === undefined) return false;
            const saved = await withStore("readwrite", function (store) {
                return requestResult(store.put({ model: key, identity: owner, savedAt: Date.now(), value: value }));
            });
            return saved !== null;
        }

        async function remove(model) {
            const key = String(model || "").trim();
            if (!key) return false;
            return (await withStore("readwrite", function (store) { return requestResult(store.delete(key)); })) !== null;
        }

        async function clearAll() {
            const factory = indexedDbFactory(target);
            if (!factory) return false;
            const db = dbPromise ? await dbPromise : null;
            if (db) db.close();
            dbPromise = null;
            return new Promise(function (resolve) {
                try {
                    const request = factory.deleteDatabase(DB_NAME);
                    request.onsuccess = function () { resolve(true); };
                    request.onerror = function () { resolve(false); };
                    request.onblocked = function () { resolve(false); };
                } catch (_error) {
                    resolve(false);
                }
            });
        }

        return Object.freeze({ read: read, write: write, remove: remove, clearAll: clearAll });
    }

    const store = createReadModelStore(global);
    global.SoftoraReadModelStore = store;
    // The login page loads this script with data-softora-readmodel-reset: every
    // logout, expired session and user switch passes there and wipes all copies.
    try {
        const script = global.document && global.document.currentScript;
        if (script && script.hasAttribute && script.hasAttribute("data-softora-readmodel-reset")) store.clearAll();
    } catch (_error) { /* The login page must keep working without IndexedDB. */ }
    if (typeof module !== "undefined" && module.exports) module.exports = { createReadModelStore: createReadModelStore };
})(typeof window !== "undefined" ? window : globalThis);
