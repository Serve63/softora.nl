(function (global) {
    "use strict";

    const BATCH_ENDPOINT = "/api/premium-database/webdesign-photo-batches";
    const BULK_POLL_INTERVAL_MS = 2600;
    const BULK_UPLOAD_CHUNK_SIZE = 100;
    const STYLE_ID = "softora-database-webdesign-bulk-style";

    function fallbackNormalize(value) { return String(value || "").trim(); }
    function fallbackEscape(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
            return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] || char;
        });
    }
    function formatNumber(value) { return Math.max(0, Number(value) || 0).toLocaleString("nl-NL"); }

    function ensureStyles() {
        if (!global.document || global.document.getElementById(STYLE_ID)) return;
        const style = global.document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = ".webdesign-bulk-status{display:block;margin:14px 0 18px;padding:13px 16px;border:1px solid rgba(74,144,226,.24);border-radius:8px;background:#f7fbff;color:#2368ad;font-family:Inter,sans-serif;line-height:1.35}.webdesign-bulk-status[hidden]{display:none}.webdesign-bulk-status strong{font-weight:900;color:#1d5f9f}.webdesign-bulk-status small{display:block;margin-top:3px;color:#5c7f9f;font-size:12px;font-weight:700}.webdesign-bulk-bar{display:block;height:7px;margin-top:10px;border-radius:999px;background:rgba(74,144,226,.14);overflow:hidden}.webdesign-bulk-bar span{display:block;height:100%;width:0;border-radius:inherit;background:#4a90e2;transition:width .24s ease}";
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

        function getStatusLine(batch, phase) {
            const total = Math.max(0, Number(batch && batch.total) || 0);
            const made = Math.max(0, Number(batch && (batch.made || batch.done)) || 0);
            const failed = Math.max(0, Number(batch && batch.failed) || 0);
            const queued = Math.max(0, Number(batch && batch.queued) || 0);
            const running = Math.max(0, Number(batch && batch.running) || 0);
            const pending = Math.max(0, Number(batch && batch.pending) || 0);
            const uploaded = Math.max(0, Number(batch && batch.uploadedTargets) || 0);
            const parts = [];
            if (phase === "uploading") parts.push(formatNumber(uploaded) + "/" + formatNumber(total) + " klaargezet");
            if (running) parts.push(formatNumber(running) + " bezig");
            if (queued) parts.push(formatNumber(queued) + " in wachtrij");
            if (pending) parts.push(formatNumber(pending) + " wachten");
            if (failed) parts.push(formatNumber(failed) + " mislukt");
            if (!parts.length && batch && batch.status === "done") parts.push("volledig afgerond");
            return { title: "Webdesigns gemaakt: " + formatNumber(made) + "/" + formatNumber(total), detail: parts.join(", ") };
        }

        function renderStatus(batch, phase) {
            const node = ensureStatusNode();
            if (!node || !batch) return;
            const total = Math.max(0, Number(batch.total) || 0);
            const made = Math.max(0, Number(batch.made || batch.done) || 0);
            const pct = total ? Math.max(0, Math.min(100, Math.round((made / total) * 100))) : 0;
            const line = getStatusLine(batch, phase);
            node.hidden = false;
            node.innerHTML = "<strong>" + escapeHtml(line.title) + "</strong>" + (line.detail ? "<small>" + escapeHtml(line.detail) + "</small>" : "") + "<span class=\"webdesign-bulk-bar\" aria-hidden=\"true\"><span style=\"width:" + pct + "%\"></span></span>";
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
            if (!activeBatchId || pollTimer || typeof global.setTimeout !== "function") return;
            pollTimer = global.setTimeout(function () {
                pollTimer = null;
                void pollBatch(activeBatchId);
            }, Math.max(0, Number(delay) || 0));
        }

        function handleBatch(batch, phase) {
            if (!batch || !batch.id) return;
            activeBatchId = batch.id;
            renderStatus(batch, phase);
            queuePhotoRefresh(batch);
            if (batch.status === "done" || batch.status === "error") {
                if (pollTimer && typeof global.clearTimeout === "function") global.clearTimeout(pollTimer);
                pollTimer = null;
                return;
            }
            schedulePoll(BULK_POLL_INTERVAL_MS);
        }

        async function readJson(response) { return response.json().catch(function () { return {}; }); }
        async function pollBatch(batchId) {
            const id = normalizeString(batchId || activeBatchId);
            if (!id || pollInFlight) return;
            pollInFlight = true;
            try {
                const response = await fetch(BATCH_ENDPOINT + "/" + encodeURIComponent(id), { method: "GET", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
                const payload = await readJson(response);
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
            handleBatch(latest, "running");
            schedulePoll(0);
            return latest;
        }

        async function loadLatestBatch() {
            try {
                const response = await fetch(BATCH_ENDPOINT, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
                const payload = await readJson(response);
                const batches = Array.isArray(payload && payload.batches) ? payload.batches : [];
                if (!response.ok || !batches.length) return;
                const batch = batches.find(function (item) { return item && (item.status === "running" || item.status === "queued"); }) || batches[0];
                if (!batch || !batch.id) return;
                activeBatchId = batch.id;
                latestMade = Math.max(0, Number(batch.made || batch.done) || 0);
                renderStatus(batch, batch.status === "queued" ? "uploading" : "running");
                if (batch.status === "running" || batch.status === "queued") schedulePoll(0);
            } catch (error) {
                /* A later page load or status poll can pick up the persistent batch again. */
            }
        }

        return { loadLatestBatch: loadLatestBatch, startBulkBatchForCustomers: startBulkBatchForCustomers };
    }

    global.SoftoraDatabaseWebdesignBulk = { createController: createController };
})(typeof window !== "undefined" ? window : globalThis);
