(function (global) {
    "use strict";

    const BATCH_ENDPOINT = "/api/premium-database/webdesign-photo-batches";
    const BULK_POLL_INTERVAL_MS = 2600;
    const BULK_UPLOAD_CHUNK_SIZE = 100;
    const RESTORE_DONE_BATCH_WINDOW_MS = 15 * 60 * 1000;
    const STYLE_ID = "softora-database-webdesign-bulk-style";

    function fallbackNormalize(value) { return String(value || "").trim(); }
    function fallbackEscape(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
            return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] || char;
        });
    }
    function formatNumber(value) { return Math.max(0, Number(value) || 0).toLocaleString("nl-NL"); }
    function isActiveBatchStatus(status) {
        const value = fallbackNormalize(status).toLowerCase();
        return value === "queued" || value === "running";
    }
    function getBatchSortTime(batch) { return Math.max(0, Number(batch && (batch.finishedAt || batch.startedAt || batch.createdAt)) || 0); }

    function ensureStyles() {
        if (!global.document || global.document.getElementById(STYLE_ID)) return;
        const style = global.document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = ".webdesign-bulk-status{font-family:Inter,sans-serif;background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:14px;max-width:700px;margin:0 48px 18px;color:#71717a;line-height:1.2}.webdesign-bulk-status[hidden]{display:none}.webdesign-bulk-title{font-size:13px;font-weight:500;color:#71717a;white-space:nowrap}.webdesign-bulk-num{font-size:13px;font-weight:600;color:#18181b;white-space:nowrap}.webdesign-bulk-track{flex:1;height:6px;border-radius:99px;background:#f4f4f5;overflow:hidden;min-width:84px}.webdesign-bulk-fill{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#8B2252,#c4547a);width:0;transition:width 1.2s cubic-bezier(.22,1,.36,1)}.webdesign-bulk-rest{font-size:11px;color:#a1a1aa;white-space:nowrap}@media(max-width:860px){.webdesign-bulk-status{margin-left:20px;margin-right:20px;max-width:none;flex-wrap:wrap}.webdesign-bulk-track{flex-basis:100%;order:4}}";
        global.document.head.appendChild(style);
    }

    function createController(options) {
        const normalizeString = typeof options.normalizeString === "function" ? options.normalizeString : fallbackNormalize;
        const escapeHtml = typeof options.escapeHtml === "function" ? options.escapeHtml : fallbackEscape;
        const buildJobPayload = typeof options.buildJobPayload === "function" ? options.buildJobPayload : null;
        const refreshPhotos = typeof options.refreshPhotos === "function" ? options.refreshPhotos : null;
        const renderPage = typeof options.renderPage === "function" ? options.renderPage : null;
        const refreshDelayMs = Math.max(100, Number(options.refreshDelayMs) || 900);
        let activeBatchId = "", pollTimer = null, pollInFlight = false, latestMade = 0, refreshQueued = false;
        ensureStyles();

        function ensureStatusNode() {
            if (!global.document) return null;
            let node = global.document.getElementById("webdesignBulkStatus");
            if (node) return node;
            node = global.document.createElement("div");
            node.id = "webdesignBulkStatus";
            node.className = "webdesign-bulk-status";
            node.hidden = true;
            const banner = global.document.getElementById("statusBanner");
            if (banner && banner.parentNode && typeof banner.parentNode.insertBefore === "function") banner.parentNode.insertBefore(node, banner.nextSibling);
            else if (global.document.body && typeof global.document.body.appendChild === "function") global.document.body.appendChild(node);
            return node;
        }

        function getStatusLine(batch) {
            const total = Math.max(0, Number(batch && batch.total) || 0);
            const made = Math.max(0, Number(batch && (batch.made || batch.done)) || 0);
            const remaining = Math.max(0, total - made);
            return {
                num: formatNumber(made) + " / " + formatNumber(total),
                rest: formatNumber(remaining) + " resterend"
            };
        }

        function renderStatus(batch, phase) {
            const node = ensureStatusNode();
            if (!node || !batch) return;
            const total = Math.max(0, Number(batch.total) || 0);
            const made = Math.max(0, Number(batch.made || batch.done) || 0);
            const pct = total ? Math.max(0, Math.min(100, Math.round((made / total) * 100))) : 0;
            const visiblePct = total ? Math.max(pct, 0.12) : 0;
            const line = getStatusLine(batch);
            node.hidden = false;
            node.innerHTML = "<span class=\"webdesign-bulk-title\">Webdesigns</span><span class=\"webdesign-bulk-num\">" + escapeHtml(line.num) + "</span><span class=\"webdesign-bulk-track\" aria-hidden=\"true\"><span class=\"webdesign-bulk-fill\" style=\"width:" + visiblePct + "%\"></span></span><span class=\"webdesign-bulk-rest\">" + escapeHtml(line.rest) + "</span>";
        }

        function queuePhotoRefresh(batch) {
            const made = Math.max(0, Number(batch && (batch.made || batch.done)) || 0);
            if (made <= latestMade) return;
            latestMade = made;
            if (refreshQueued || typeof global.setTimeout !== "function") return;
            refreshQueued = true;
            global.setTimeout(function () {
                refreshQueued = false;
                if (refreshPhotos) void refreshPhotos({ batch: true });
                else if (renderPage) renderPage();
            }, refreshDelayMs);
        }

        function schedulePoll(delay) {
            const delayMs = Math.max(0, Number(delay) || 0);
            if (!activeBatchId || typeof global.setTimeout !== "function") return;
            if (pollTimer) {
                if (delayMs > 0) return;
                if (typeof global.clearTimeout === "function") global.clearTimeout(pollTimer);
                pollTimer = null;
            }
            pollTimer = global.setTimeout(function () {
                pollTimer = null;
                void pollBatch(activeBatchId);
            }, delayMs);
        }

        function handleBatch(batch, phase, options) {
            if (!batch || !batch.id) return;
            const status = normalizeString(batch.status).toLowerCase();
            activeBatchId = batch.id;
            renderStatus(batch, phase);
            queuePhotoRefresh(batch);
            if (status === "done" || status === "error") {
                if (pollTimer && typeof global.clearTimeout === "function") global.clearTimeout(pollTimer);
                pollTimer = null;
                return;
            }
            schedulePoll(options && options.immediate ? 0 : BULK_POLL_INTERVAL_MS);
        }

        async function readJson(response) { return response.json().catch(function () { return {}; }); }
        async function pollBatch(batchId) {
            const id = normalizeString(batchId || activeBatchId);
            if (!id || pollInFlight) return;
            pollInFlight = true;
            try {
                const response = await fetch(BATCH_ENDPOINT + "/" + encodeURIComponent(id), { method: "GET", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
                const payload = await readJson(response);
                if (response.status === 404) {
                    if (id === activeBatchId) activeBatchId = "";
                    return;
                }
                if (!response.ok || !payload || !payload.batch) throw new Error(normalizeString(payload && (payload.detail || payload.error)) || "Webdesign-bulk laden is mislukt.");
                handleBatch(payload.batch, "running");
            } catch (error) {
                schedulePoll(BULK_POLL_INTERVAL_MS * 2);
            } finally {
                pollInFlight = false;
            }
        }

        async function postJson(url, body) {
            const response = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body || {}) });
            const payload = await readJson(response);
            if (!response.ok || !payload || !payload.batch) throw new Error(normalizeString(payload && (payload.detail || payload.error)) || "Webdesign-bulk starten is mislukt.");
            return payload.batch;
        }
        function waitForRetry(delay) { return new Promise(function (resolve) { if (typeof global.setTimeout === "function") global.setTimeout(resolve, Math.max(0, Number(delay) || 0)); else resolve(); }); }
        async function postJsonWithRetry(url, body) {
            let lastError = null;
            for (let attempt = 0; attempt < 3; attempt += 1) {
                try { return await postJson(url, body); }
                catch (error) { lastError = error; await waitForRetry(700 * (attempt + 1)); }
            }
            throw lastError || new Error("Webdesign-bulk starten is mislukt.");
        }

        function buildTargetPayload(target) {
            if (!buildJobPayload) return target || {};
            const payload = buildJobPayload(target, "");
            delete payload.jobId;
            return payload;
        }

        async function startBulkBatchForCustomers(customers) {
            const targets = (Array.isArray(customers) ? customers : []).filter(Boolean);
            const total = targets.length;
            if (!total) return null;
            const created = await postJsonWithRetry(BATCH_ENDPOINT, { total: total });
            const batchId = created.id;
            const expectedChunks = Math.ceil(total / BULK_UPLOAD_CHUNK_SIZE);
            let latest = created;
            handleBatch(created, "uploading");
            for (let offset = 0, chunkIndex = 0; offset < total; offset += BULK_UPLOAD_CHUNK_SIZE, chunkIndex += 1) {
                latest = await postJsonWithRetry(BATCH_ENDPOINT + "/" + encodeURIComponent(batchId) + "/chunks", { index: chunkIndex, offset: offset, targets: targets.slice(offset, offset + BULK_UPLOAD_CHUNK_SIZE).map(buildTargetPayload) });
                handleBatch(latest, "uploading");
            }
            latest = await postJsonWithRetry(BATCH_ENDPOINT + "/" + encodeURIComponent(batchId) + "/commit", { total: total, expectedChunks: expectedChunks });
            handleBatch(latest, "running", { immediate: true });
            return latest;
        }

        function pickRestorableBatch(batches) {
            const sorted = (Array.isArray(batches) ? batches : []).filter(Boolean).sort(function (left, right) { return getBatchSortTime(right) - getBatchSortTime(left); });
            return sorted.find(function (item) { return item && item.id && isActiveBatchStatus(item.status); }) || sorted.find(function (item) {
                const status = normalizeString(item && item.status).toLowerCase();
                const sortTime = getBatchSortTime(item);
                return item && item.id && (status === "done" || status === "error") && sortTime && Date.now() - sortTime <= RESTORE_DONE_BATCH_WINDOW_MS;
            }) || null;
        }

        async function loadLatestBatch() {
            try {
                const response = await fetch(BATCH_ENDPOINT, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
                const payload = await readJson(response);
                const batches = Array.isArray(payload && payload.batches) ? payload.batches : [];
                if (!response.ok || !batches.length) return;
                const batch = pickRestorableBatch(batches);
                if (!batch || !batch.id) return;
                latestMade = Math.max(0, Number(batch.made || batch.done) || 0);
                handleBatch(batch, batch.status === "queued" ? "uploading" : "running", { immediate: true });
                return batch;
            } catch (error) {
                /* A later page load or status poll can pick up the persistent batch again. */
            }
        }

        return { loadLatestBatch: loadLatestBatch, startBulkBatchForCustomers: startBulkBatchForCustomers };
    }

    global.SoftoraDatabaseWebdesignBulk = { createController: createController };
})(typeof window !== "undefined" ? window : globalThis);
