(function (global) {
    "use strict";

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function clampCount(value, fallback) {
        return Math.max(0, Math.min(80, Number(value || fallback) || 0));
    }

    function createController(options) {
        const getUiState = options.getUiState;
        const setUiState = options.setUiState;
        const normalizeCustomer = options.normalizeCustomer;
        const shouldShowWebsitePhoto = options.shouldShowWebsitePhoto;
        const isValidWebsitePhotoDataUrl = options.isValidWebsitePhotoDataUrl;
        const buildCustomerIdentityKey = options.buildCustomerIdentityKey;
        const formatDateForStorage = options.formatDateForStorage;
        const scope = options.scope;
        const key = options.key;
        const dataPrefix = options.dataPrefix;
        const chunkSize = Math.max(20000, Math.min(180000, Number(options.chunkSize) || 180000));

        function wait(ms) {
            return new Promise(function (resolve) {
                const timer = typeof global.setTimeout === "function" ? global.setTimeout : function (callback) { callback(); };
                timer(resolve, ms);
            });
        }

        function loadPersistState() {
            return getUiState(scope).catch(function (firstError) {
                if (typeof console !== "undefined" && typeof console.warn === "function") {
                    console.warn("Databasefoto's laden voor opslaan opnieuw geprobeerd:", firstError);
                }
                return wait(700).then(function () {
                    return getUiState(scope);
                });
            });
        }

        function buildDataKey(customerId) {
            return dataPrefix + normalizeString(customerId).replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80);
        }

        function normalizeIdSet(values) {
            const ids = new Set((values || []).map(normalizeString).filter(Boolean));
            return ids.size ? ids : null;
        }

        function readChunkedData(values, photoKey, chunkCount) {
            const stateValues = values && typeof values === "object" ? values : {};
            const count = clampCount(chunkCount, 0);
            const chunks = [];
            if (count) {
                for (let index = 0; index < count; index += 1) chunks.push(normalizeString(stateValues[photoKey + "_" + index]));
            } else {
                for (let index = 0; index < 80; index += 1) {
                    const value = stateValues[photoKey + "_" + index];
                    if (typeof value !== "string") break;
                    chunks.push(normalizeString(value));
                }
            }
            const dataUrl = chunks.join("");
            return isValidWebsitePhotoDataUrl(dataUrl) ? { dataUrl: dataUrl, chunkCount: chunks.length } : null;
        }

        function stripPhotoMeta(item) {
            return {
                id: normalizeString(item && item.id),
                identityKey: normalizeString(item && item.identityKey),
                photoKey: normalizeString(item && item.photoKey),
                chunkCount: clampCount(item && item.chunkCount, 0),
                websitePhotoName: normalizeString(item && item.websitePhotoName) || "Websitefoto",
                updatedAt: normalizeString(item && item.updatedAt) || ""
            };
        }

        function parsePhotoMap(raw, values, customers) {
            let parsed = {};
            try {
                const value = JSON.parse(String(raw || "{}"));
                parsed = value && typeof value === "object" && !Array.isArray(value) ? value : {};
            } catch (error) {
                parsed = {};
            }

            const result = {};
            Object.keys(parsed).forEach(function (photoId) {
                const meta = stripPhotoMeta({ ...parsed[photoId], id: parsed[photoId].id || photoId });
                if (!meta.id || !meta.photoKey) return;
                const chunked = readChunkedData(values, meta.photoKey, meta.chunkCount);
                if (!chunked) return;
                result[meta.id] = { ...meta, chunkCount: chunked.chunkCount, websitePhoto: chunked.dataUrl };
            });

            (Array.isArray(customers) ? customers : []).forEach(function (customer, index) {
                const normalized = normalizeCustomer(customer, "photo-recover-" + index);
                if (!normalized.id || result[normalized.id] || !shouldShowWebsitePhoto(normalized)) return;
                const photoKey = buildDataKey(normalized.id);
                const chunked = readChunkedData(values, photoKey, 0);
                if (!chunked) return;
                result[normalized.id] = {
                    id: normalized.id,
                    identityKey: buildCustomerIdentityKey(normalized),
                    photoKey: photoKey,
                    chunkCount: chunked.chunkCount,
                    websitePhotoName: normalized.websitePhotoName || "Websitefoto",
                    updatedAt: normalized.updatedAt || "",
                    websitePhoto: chunked.dataUrl
                };
            });
            return result;
        }

        function buildCurrentStorage(customers, onlyCustomerIds) {
            const onlyIds = normalizeIdSet(onlyCustomerIds);
            const photoMap = {};
            const patch = {};
            (customers || []).forEach(function (customer, index) {
                const normalized = normalizeCustomer(customer, "photo-map-" + index);
                if (onlyIds && !onlyIds.has(normalized.id)) return;
                if (!normalized.id || !shouldShowWebsitePhoto(normalized) || !isValidWebsitePhotoDataUrl(normalized.websitePhoto)) return;
                const photoKey = buildDataKey(normalized.id);
                const chunks = normalizeString(normalized.websitePhoto).match(new RegExp("[\\s\\S]{1," + chunkSize + "}", "g")) || [];
                chunks.forEach(function (chunk, chunkIndex) {
                    patch[photoKey + "_" + chunkIndex] = chunk;
                });
                photoMap[normalized.id] = {
                    id: normalized.id,
                    identityKey: buildCustomerIdentityKey(normalized),
                    photoKey: photoKey,
                    chunkCount: chunks.length,
                    websitePhotoName: normalized.websitePhotoName || "Websitefoto",
                    updatedAt: normalized.updatedAt || formatDateForStorage(new Date())
                };
            });
            return { photoMap: photoMap, patch: patch };
        }

        function mergePhotoMaps(existing, current, removeIds) {
            const removed = new Set((removeIds || []).map(normalizeString).filter(Boolean));
            const merged = {};
            Object.keys(existing || {}).forEach(function (id) {
                const meta = stripPhotoMeta(existing[id]);
                if (!meta.id || removed.has(meta.id) || !meta.photoKey || !meta.chunkCount) return;
                merged[meta.id] = meta;
            });
            Object.keys(current || {}).forEach(function (id) {
                const meta = stripPhotoMeta(current[id]);
                if (!meta.id || removed.has(meta.id) || !meta.photoKey || !meta.chunkCount) return;
                merged[meta.id] = meta;
            });
            return merged;
        }

        function buildRemovalPatch(existing, removeIds) {
            const patch = {};
            (removeIds || []).map(normalizeString).filter(Boolean).forEach(function (id) {
                const meta = stripPhotoMeta(existing && existing[id]);
                const photoKey = meta.photoKey || buildDataKey(id);
                const count = meta.chunkCount || 80;
                for (let index = 0; index < count; index += 1) {
                    patch[photoKey + "_" + index] = "";
                }
            });
            return patch;
        }

        function load(customers) {
            return getUiState(scope).then(function (state) {
                const values = state && state.values && typeof state.values === "object" ? state.values : {};
                return parsePhotoMap(values[key], values, customers);
            }).catch(function (error) {
                console.error("Databasefoto's laden via Supabase mislukt:", error);
                return {};
            });
        }

        function persist(customers, persistOptions) {
            return loadPersistState().then(function (state) {
                const values = state && state.values && typeof state.values === "object" ? state.values : {};
                const existing = parsePhotoMap(values[key], values, customers);
                const current = buildCurrentStorage(customers, persistOptions && persistOptions.onlyCustomerIds);
                const merged = mergePhotoMaps(existing, current.photoMap, persistOptions && persistOptions.removeCustomerIds);
                const removalPatch = buildRemovalPatch(existing, persistOptions && persistOptions.removeCustomerIds);
                return setUiState(scope, {
                    patch: { ...removalPatch, ...current.patch, [key]: JSON.stringify(merged) },
                    source: "premium-database-photos",
                    actor: "Premium database"
                });
            }).then(function () {
                return { ok: true };
            }).catch(function (error) {
                if (typeof console !== "undefined" && typeof console.error === "function") {
                    console.error("Databasefoto's opslaan via Supabase mislukt:", error);
                }
                return { ok: false, error: error };
            });
        }

        return {
            buildDataKey: buildDataKey,
            load: load,
            persist: persist
        };
    }

    global.SoftoraDatabasePhotoStorage = {
        createController: createController
    };
})(window);
