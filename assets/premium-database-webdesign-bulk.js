(function (global) {
    "use strict";

    const BATCH_ENDPOINT = "/api/premium-database/webdesign-photo-batches";
    const RUN_ENDPOINT = "/api/premium-database/webdesign-photo-batches/run";
    const BULK_POLL_INTERVAL_MS = 1200;
    const WORKER_KICK_INTERVAL_MS = 8000;
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
    function isTerminalBatchStatus(status) {
        const value = fallbackNormalize(status).toLowerCase();
        return value === "done" || value === "error" || value === "cancelled";
    }
    function getBatchSortTime(batch) { return Math.max(0, Number(batch && (batch.finishedAt || batch.startedAt || batch.createdAt)) || 0); }

    function ensureStyles() {
        if (!global.document || global.document.getElementById(STYLE_ID)) return;
        const style = global.document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = ".webdesign-bulk-status{font-family:Inter,sans-serif;background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:14px;max-width:760px;margin:0 48px 18px;color:#71717a;line-height:1.2}.webdesign-bulk-status[hidden]{display:none}.webdesign-bulk-title{font-size:13px;font-weight:500;color:#71717a;white-space:nowrap}.webdesign-bulk-num{font-size:13px;font-weight:600;color:#18181b;white-space:nowrap}.webdesign-bulk-track{flex:1;height:6px;border-radius:99px;background:#f4f4f5;overflow:hidden;min-width:84px}.webdesign-bulk-fill{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#8B2252,#c4547a);width:0;transition:width 1.2s cubic-bezier(.22,1,.36,1)}.webdesign-bulk-rest{font-size:11px;color:#a1a1aa;white-space:nowrap}.webdesign-bulk-cancel{width:26px;height:26px;border:1px solid #ead5df;background:#fff7fb;color:#8B2252;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;font-weight:600;line-height:1;cursor:pointer;transition:background .2s ease,border-color .2s ease,color .2s ease,transform .2s ease}.webdesign-bulk-cancel:hover{background:#8B2252;border-color:#8B2252;color:#fff;transform:translateY(-1px)}.webdesign-bulk-cancel:disabled{opacity:.45;cursor:default;transform:none}.webdesign-bulk-cancel[hidden]{display:none}@media(max-width:860px){.webdesign-bulk-status{margin-left:20px;margin-right:20px;max-width:none;flex-wrap:wrap}.webdesign-bulk-track{flex-basis:100%;order:4}.webdesign-bulk-cancel{margin-left:auto}}";
        global.document.head.appendChild(style);
    }

    function createController(options) {
        const normalizeString = typeof options.normalizeString === "function" ? options.normalizeString : fallbackNormalize;
        const escapeHtml = typeof options.escapeHtml === "function" ? options.escapeHtml : fallbackEscape;
        const buildJobPayload = typeof options.buildJobPayload === "function" ? options.buildJobPayload : null;
        const refreshPhotos = typeof options.refreshPhotos === "function" ? options.refreshPhotos : null;
        const renderPage = typeof options.renderPage === "function" ? options.renderPage : null;
        const refreshDelayMs = Math.max(100, Number(options.refreshDelayMs) || 900);
        let activeBatchId = "", pollTimer = null, pollInFlight = false, latestMade = 0, refreshQueued = false, workerKickInFlight = false, lastWorkerKickAt = 0, cancelInFlight = false;
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

        function ensureStatusParts(node) {
            if (!node) return null;
            if (!node.__softoraBulkParts) {
                node.innerHTML = "<span class=\"webdesign-bulk-title\">Webdesigns</span><span class=\"webdesign-bulk-num\"></span><span class=\"webdesign-bulk-track\" aria-hidden=\"true\"><span class=\"webdesign-bulk-fill\"></span></span><span class=\"webdesign-bulk-rest\"></span><button class=\"webdesign-bulk-cancel\" type=\"button\" aria-label=\"Webdesign-bulk annuleren\" title=\"Rest annuleren\">&times;</button>";
                node.__softoraBulkParts = {
                    num: node.querySelector ? node.querySelector(".webdesign-bulk-num") : null,
                    fill: node.querySelector ? node.querySelector(".webdesign-bulk-fill") : null,
                    rest: node.querySelector ? node.querySelector(".webdesign-bulk-rest") : null,
                    cancel: node.querySelector ? node.querySelector(".webdesign-bulk-cancel") : null
                };
                if (node.__softoraBulkParts.cancel && typeof node.__softoraBulkParts.cancel.addEventListener === "function") {
                    node.__softoraBulkParts.cancel.addEventListener("click", function () { void confirmAndCancelBatch(); });
                }
            }
            return node.__softoraBulkParts;
        }

        function getStatusLine(batch) {
            const total = Math.max(0, Number(batch && batch.total) || 0);
            const made = Math.max(0, Number(batch && (batch.made || batch.done)) || 0);
            const failed = Math.max(0, Number(batch && batch.failed) || 0);
            const cancelled = Math.max(0, Number(batch && batch.cancelled) || 0);
            const remaining = Math.max(0, total - made - failed - cancelled);
            const status = fallbackNormalize(batch && batch.status).toLowerCase();
            return {
                num: formatNumber(made) + " / " + formatNumber(total),
                rest: status === "cancelled" ? formatNumber(cancelled || Math.max(0, total - made - failed)) + " geannuleerd" : formatNumber(remaining) + " resterend"
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
            const parts = ensureStatusParts(node);
            const status = fallbackNormalize(batch && batch.status).toLowerCase();
            node.hidden = false;
            if (!parts || !parts.num || !parts.fill || !parts.rest) {
                node.innerHTML = "<span class=\"webdesign-bulk-title\">Webdesigns</span><span class=\"webdesign-bulk-num\">" + escapeHtml(line.num) + "</span><span class=\"webdesign-bulk-track\" aria-hidden=\"true\"><span class=\"webdesign-bulk-fill\" style=\"width:" + visiblePct + "%\"></span></span><span class=\"webdesign-bulk-rest\">" + escapeHtml(line.rest) + "</span><button class=\"webdesign-bulk-cancel\" type=\"button\" aria-label=\"Webdesign-bulk annuleren\" title=\"Rest annuleren\"" + (isTerminalBatchStatus(status) ? " hidden" : "") + ">&times;</button>";
                return;
            }
            if (parts && parts.num) parts.num.textContent = line.num;
            if (parts && parts.rest) parts.rest.textContent = line.rest;
            if (parts && parts.cancel) {
                parts.cancel.hidden = isTerminalBatchStatus(status);
                parts.cancel.disabled = cancelInFlight;
            }
            if (parts && parts.fill) {
                const nextWidth = visiblePct + "%";
                if (!parts.fill.style.width) {
                    parts.fill.style.width = "0%";
                    if (typeof global.requestAnimationFrame === "function") {
                        global.requestAnimationFrame(function () { parts.fill.style.width = nextWidth; });
                    } else {
                        parts.fill.style.width = nextWidth;
                    }
                } else {
                    parts.fill.style.width = nextWidth;
                }
            }
        }

        async function confirmCancelBatch() {
            const message = "Weet je zeker dat je de resterende webdesigns wilt annuleren? Gemaakte webdesigns blijven staan.";
            if (global.SoftoraDialogs && typeof global.SoftoraDialogs.confirm === "function") {
                return global.SoftoraDialogs.confirm(message, {
                    title: "Bulk annuleren",
                    confirmText: "Rest annuleren",
                    cancelText: "Terug"
                });
            }
            return typeof global.confirm === "function" ? global.confirm(message) : false;
        }

        async function cancelActiveBatch() {
            const id = normalizeString(activeBatchId);
            if (!id || cancelInFlight || typeof fetch !== "function") return null;
            cancelInFlight = true;
            const node = ensureStatusNode();
            const parts = node ? ensureStatusParts(node) : null;
            if (parts && parts.cancel) parts.cancel.disabled = true;
            try {
                const response = await fetch(BATCH_ENDPOINT + "/" + encodeURIComponent(id) + "/cancel", {
                    method: "POST",
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify({})
                });
                const payload = await readJson(response);
                if (!response.ok || !payload || !payload.batch) throw new Error(normalizeString(payload && (payload.detail || payload.error)) || "Webdesign-bulk annuleren is mislukt.");
                handleBatch(payload.batch, "cancelled");
                return payload.batch;
            } finally {
                cancelInFlight = false;
                if (parts && parts.cancel) parts.cancel.disabled = false;
            }
        }

        async function confirmAndCancelBatch() {
            if (!(await confirmCancelBatch())) return null;
            try {
                return await cancelActiveBatch();
            } catch (error) {
                const message = error && error.message ? error.message : "Webdesign-bulk annuleren is mislukt.";
                if (global.SoftoraDialogs && typeof global.SoftoraDialogs.alert === "function") await global.SoftoraDialogs.alert(message, { title: "Annuleren mislukt" });
                else if (typeof global.alert === "function") global.alert(message);
                return null;
            }
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

        function kickServerWorker() {
            if (typeof fetch !== "function" || workerKickInFlight) return;
            const currentTime = Date.now();
            if (lastWorkerKickAt && currentTime - lastWorkerKickAt < WORKER_KICK_INTERVAL_MS) return;
            lastWorkerKickAt = currentTime;
            workerKickInFlight = true;
            fetch(RUN_ENDPOINT, {
                method: "POST",
                credentials: "same-origin",
                cache: "no-store",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ batchLimit: 1 })
            })
                .catch(function () {})
                .finally(function () {
                    workerKickInFlight = false;
                    schedulePoll(0);
                });
        }

        function handleBatch(batch, phase, options) {
            if (!batch || !batch.id) return;
            const status = normalizeString(batch.status).toLowerCase();
            activeBatchId = batch.id;
            renderStatus(batch, phase);
            queuePhotoRefresh(batch);
            if (isTerminalBatchStatus(status)) {
                if (pollTimer && typeof global.clearTimeout === "function") global.clearTimeout(pollTimer);
                pollTimer = null;
                activeBatchId = "";
                return;
            }
            kickServerWorker();
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
                return item && item.id && (status === "done" || status === "error" || status === "cancelled") && sortTime && Date.now() - sortTime <= RESTORE_DONE_BATCH_WINDOW_MS;
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

        return { cancelActiveBatch: cancelActiveBatch, loadLatestBatch: loadLatestBatch, startBulkBatchForCustomers: startBulkBatchForCustomers };
    }

    global.SoftoraDatabaseWebdesignBulk = { createController: createController };
})(typeof window !== "undefined" ? window : globalThis);
