(function (global) {
    "use strict";

    const STYLE_ID = "softora-database-webdesign-action-style";
    const JOB_ENDPOINT = "/api/premium-database/webdesign-photo-jobs";
    const PENDING_TTL_MS = 6 * 60 * 60 * 1000;
    const POLL_INTERVAL_MS = 2200;
    const PHOTO_LOAD_FALLBACK_MS = 6000;
    const PHOTO_LOAD_RETRY_AFTER_MS = 30000;
    const PHOTO_LOAD_CACHE_PROPERTY = "__SoftoraDatabasePhotoLoadCacheV1";
    const PHOTO_LOAD_CACHE_LIMIT = 2500;
    const LIGHTNING_ICON = "<svg class=\"photo-generate-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"currentColor\" d=\"M13.25 2.25 4.9 13.35a.75.75 0 0 0 .6 1.2h5.08l-1.84 7.02a.75.75 0 0 0 1.33.62l8.95-11.55a.75.75 0 0 0-.6-1.21h-5.21l1.45-6.54a.75.75 0 0 0-1.41-.64Z\"/></svg>";
    const MOCKUP_ICON = "<svg class=\"photo-mockup-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M4 6.5h10.5v7H4zM3 16h13M17 8h3.5v8H17zM18.75 18h.01\"/></svg>";
    const LOADING_ICON = "<span class=\"photo-generate-spinner\" aria-hidden=\"true\"></span>";
    const FALLBACK_ICON = "<span class=\"photo-fallback-icon\" aria-hidden=\"true\">!</span>";
    const PHOTO_READY_SELECTOR = ".photo-drop[data-has-photo=\"true\"], .photo-drop--mockup[data-has-photo=\"true\"]";

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function formatCentCost(value) {
        return "-" + Math.round(Math.max(0, Number(value) || 0) * 100) + " cent";
    }

    function ensureStyles() {
        if (!global.document || global.document.getElementById(STYLE_ID)) return;
        const style = global.document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = ".photo-cell{display:inline-flex;align-items:center;justify-content:center;gap:4px;width:72px;min-width:72px;line-height:0}.photo-drop{position:relative;flex:0 0 34px;aspect-ratio:1/1;overflow:hidden;contain:layout paint}.photo-drop[data-has-photo=\"false\"]{overflow:visible}.photo-drop[data-has-photo=\"false\"][data-can-generate=\"true\"]{background:rgba(155,35,85,.08)}.photo-drop[data-has-photo=\"false\"][data-can-generate=\"false\"]{opacity:.55;cursor:not-allowed}.photo-drop.is-generating,.photo-drop.is-restoring,.photo-drop[data-has-photo=\"true\"][data-photo-loaded=\"false\"]{cursor:wait}.photo-drop[data-photo-error=\"true\"]{background:rgba(155,35,85,.06);cursor:default}.photo-drop[data-photo-error=\"true\"] .photo-drop-image,.photo-drop[data-photo-error=\"true\"] .photo-drop-loader{display:none}.photo-drop--mockup{border-style:solid;background:rgba(20,24,45,.04)}.photo-drop-loader{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.84);opacity:1;pointer-events:none;transition:opacity .16s ease;z-index:1}.photo-drop[data-photo-loaded=\"true\"] .photo-drop-loader{opacity:0}.photo-drop-image{width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity .16s ease}.photo-drop[data-photo-loaded=\"true\"] .photo-drop-image{opacity:1}.photo-fallback-icon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:999px;background:rgba(155,35,85,.1);color:var(--crimson);font:800 12px/1 Inter,sans-serif}.photo-generate-icon,.photo-mockup-icon{width:18px;height:18px;color:var(--crimson);transition:transform .16s ease,color .16s ease}.photo-drop:hover .photo-generate-icon,.photo-drop:focus-visible .photo-generate-icon,.photo-drop:hover .photo-mockup-icon,.photo-drop:focus-visible .photo-mockup-icon{color:var(--crimson-light);transform:scale(1.08)}.photo-generate-charge-label{position:fixed;right:18px;bottom:18px;z-index:12000;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:#c0392b;color:#fff;box-shadow:0 12px 28px rgba(192,57,43,.24);padding:8px 12px;font-family:Inter,sans-serif;font-size:13px;font-weight:800;letter-spacing:0;line-height:1;opacity:0;transform:translateY(8px) scale(.96);pointer-events:none;transition:opacity .14s ease,transform .14s ease,bottom .16s ease}.photo-generate-charge-label.is-visible{opacity:1;transform:translateY(0) scale(1)}.photo-generate-spinner{width:18px;height:18px;border:2px solid rgba(155,35,85,.18);border-top-color:var(--crimson);border-radius:999px;animation:photoGenerateSpin .8s linear infinite}@keyframes photoGenerateSpin{to{transform:rotate(360deg)}}";
        global.document.head.appendChild(style);
    }

    function createController(options) {
        const state = options.state;
        const escapeHtml = options.escapeHtml;
        const shouldShowWebsitePhoto = options.shouldShowWebsitePhoto;
        const isValidWebsitePhotoDataUrl = options.isValidWebsitePhotoDataUrl;
        const resolveCustomerWebsiteUrl = options.resolveCustomerWebsiteUrl;
        const isWebdesignPhotoEligible = options.isWebdesignPhotoEligible;
        const openWebsitePhotoPreview = options.openWebsitePhotoPreview;
        const setStatusMessage = options.setStatusMessage;
        const renderPage = options.renderPage;
        const refreshPhotos = options.refreshPhotos;
        const logMediaDebug = typeof options.logMediaDebug === "function" ? options.logMediaDebug : function () {};
        const ensureMockupForCustomer = typeof options.ensureMockupForCustomer === "function" ? options.ensureMockupForCustomer : async function () {};
        const isMockupPending = typeof options.isMockupPending === "function" ? options.isMockupPending : function () { return false; };
        const getAssetState = typeof options.getAssetState === "function" ? options.getAssetState : null;
        const isRestoringPhotos = typeof options.isRestoringPhotos === "function" ? options.isRestoringPhotos : function (customer) { return Boolean(state && state.photoRestorePending) && shouldShowWebsitePhoto(customer); };
        const costEur = Math.max(0, Number(options.costEur) || 0);
        const pendingIds = new Set();
        const pendingJobs = new Map();
        const pollTimers = new Map();
        const loadedPhotoKeys = getSharedLoadedPhotoKeys();
        const failedPhotoKeys = new Set();
        const failedPhotoKeyTimes = new Map();
        const failedMockupIds = new Set();
        const autoMockupQueuedIds = new Set();
        const autoMockupQueue = [];
        let photoHydrationQueued = false;
        let autoMockupScheduled = false;
        let autoMockupRunning = false;
        ensureStyles();

        function getSharedLoadedPhotoKeys() {
            try {
                if (!global[PHOTO_LOAD_CACHE_PROPERTY] || typeof global[PHOTO_LOAD_CACHE_PROPERTY].has !== "function") {
                    global[PHOTO_LOAD_CACHE_PROPERTY] = new Set();
                }
                return global[PHOTO_LOAD_CACHE_PROPERTY];
            } catch (error) {
                return new Set();
            }
        }

        function trimLoadedPhotoKeys() {
            while (loadedPhotoKeys.size > PHOTO_LOAD_CACHE_LIMIT) {
                const oldest = loadedPhotoKeys.values().next().value;
                loadedPhotoKeys.delete(oldest);
            }
        }

        function runNextFrame(callback) {
            const frame = typeof global.requestAnimationFrame === "function"
                ? global.requestAnimationFrame
                : function (next) { global.setTimeout(next, 0); };
            frame(callback);
        }

        function hashText(value) {
            let hash = 2166136261;
            const text = normalizeString(value);
            for (let index = 0; index < text.length; index += 1) {
                hash ^= text.charCodeAt(index);
                hash = Math.imul(hash, 16777619);
            }
            return (hash >>> 0).toString(36);
        }

        function buildPhotoSourceFingerprint(source) {
            const raw = normalizeString(source);
            if (/^https?:\/\//i.test(raw)) {
                try {
                    const UrlConstructor = global.URL || (typeof URL === "function" ? URL : null);
                    if (UrlConstructor) {
                        const parsed = new UrlConstructor(raw);
                        return [parsed.origin, parsed.pathname].join("");
                    }
                } catch (error) {
                    return [raw.length, hashText(raw)].join("-");
                }
            }
            return [raw.length, hashText(raw)].join("-");
        }

        function buildPhotoLoadKey(kind, customerId, source) {
            return [normalizeString(kind) || "photo", normalizeString(customerId) || "unknown", buildPhotoSourceFingerprint(source)].join("-");
        }

        function isInlinePhotoSource(source) {
            return /^data:image\//i.test(normalizeString(source));
        }

        function markPhotoKeyLoaded(key) {
            const normalized = normalizeString(key);
            if (!normalized) return;
            failedPhotoKeys.delete(normalized);
            failedPhotoKeyTimes.delete(normalized);
            loadedPhotoKeys.add(normalized);
            trimLoadedPhotoKeys();
        }

        function markPhotoKeyFailed(key) {
            const normalized = normalizeString(key);
            if (!normalized) return;
            loadedPhotoKeys.delete(normalized);
            failedPhotoKeys.add(normalized);
            failedPhotoKeyTimes.set(normalized, now());
        }

        function shouldRetryFailedPhotoKey(key) {
            const normalized = normalizeString(key);
            if (!normalized || !failedPhotoKeys.has(normalized)) return false;
            const failedAt = Number(failedPhotoKeyTimes.get(normalized)) || 0;
            return !failedAt || (now() - failedAt) >= PHOTO_LOAD_RETRY_AFTER_MS;
        }

        function clearFailedPhotoKey(key) {
            const normalized = normalizeString(key);
            if (!normalized) return;
            failedPhotoKeys.delete(normalized);
            failedPhotoKeyTimes.delete(normalized);
        }

        function getPhotoDropDebug(drop) {
            if (!drop || typeof drop.getAttribute !== "function") return {};
            const isMockup = Boolean(drop.classList && typeof drop.classList.contains === "function" && drop.classList.contains("photo-drop--mockup"));
            return {
                customerId: normalizeString(drop.getAttribute(isMockup ? "data-mockup-photo-id" : "data-photo-id")),
                kind: isMockup ? "mockup" : "webdesign",
                key: normalizeString(drop.getAttribute("data-photo-key"))
            };
        }

        function markPhotoDropReady(drop, failed) {
            if (!drop || typeof drop.setAttribute !== "function") return;
            const key = normalizeString(drop.getAttribute("data-photo-key"));
            if (key) {
                if (failed) markPhotoKeyFailed(key);
                else markPhotoKeyLoaded(key);
            }
            logMediaDebug(failed ? "image-load-error" : "image-load-success", getPhotoDropDebug(drop));
            drop.setAttribute("data-photo-loaded", "true");
            if (failed) drop.setAttribute("data-photo-error", "true");
            else drop.setAttribute("data-photo-error", "false");
            drop.removeAttribute("data-photo-loading-bound");
            if (failed && typeof drop.querySelector === "function" && !drop.querySelector(".photo-fallback-icon") && typeof drop.insertAdjacentHTML === "function") {
                drop.insertAdjacentHTML("beforeend", FALLBACK_ICON);
            }
        }

        function bindPhotoDropLoading(drop) {
            if (!drop || typeof drop.querySelector !== "function") return;
            const image = drop.querySelector(".photo-drop-image");
            if (!image) {
                markPhotoDropReady(drop);
                return;
            }
            if (drop.getAttribute("data-photo-loaded") === "true") return;
            const key = normalizeString(drop.getAttribute("data-photo-key"));
            if (key && loadedPhotoKeys.has(key)) {
                markPhotoDropReady(drop, false);
                return;
            }
            if (key && failedPhotoKeys.has(key) && !shouldRetryFailedPhotoKey(key)) {
                markPhotoDropReady(drop, true);
                return;
            }
            if (key && shouldRetryFailedPhotoKey(key)) clearFailedPhotoKey(key);
            let fallbackTimer = null;
            let finished = false;
            logMediaDebug("image-load-start", getPhotoDropDebug(drop));
            const finishReady = function (failed) {
                if (finished) return;
                finished = true;
                if (fallbackTimer && typeof global.clearTimeout === "function") global.clearTimeout(fallbackTimer);
                markPhotoDropReady(drop, failed);
            };
            const finish = function () { finishReady(false); };
            const fail = function () { finishReady(true); };
            const startFallbackTimer = function () {
                if (fallbackTimer || typeof global.setTimeout !== "function") return;
                fallbackTimer = global.setTimeout(function () {
                    if (image.complete && Number(image.naturalWidth) > 0) finishReady(false);
                    else finishReady(true);
                }, PHOTO_LOAD_FALLBACK_MS);
            };
            const onLoad = function () {
                startFallbackTimer();
                if (typeof image.decode === "function") {
                    image.decode().catch(function () {}).finally(finish);
                    return;
                }
                finish();
            };
            if (image.complete && Number(image.naturalWidth) > 0) {
                onLoad();
                return;
            }
            if (image.complete && Number(image.naturalWidth) <= 0) {
                fail();
                return;
            }
            if (drop.getAttribute("data-photo-loading-bound") === "true") return;
            drop.setAttribute("data-photo-loading-bound", "true");
            image.addEventListener("load", onLoad, { once: true });
            image.addEventListener("error", fail, { once: true });
            startFallbackTimer();
        }

        function hydratePhotoDrops(root) {
            const scope = root && typeof root.querySelectorAll === "function" ? root : (global.document || null);
            if (!scope || typeof scope.querySelectorAll !== "function") return;
            Array.from(scope.querySelectorAll(PHOTO_READY_SELECTOR)).forEach(bindPhotoDropLoading);
        }

        function schedulePhotoDropHydration() {
            if (photoHydrationQueued || !global.document) return;
            photoHydrationQueued = true;
            runNextFrame(function () {
                photoHydrationQueued = false;
                hydratePhotoDrops(global.document);
            });
        }

        function scheduleAutoMockupQueue() {
            if (autoMockupScheduled) return;
            autoMockupScheduled = true;
            const run = function () {
                autoMockupScheduled = false;
                processAutoMockupQueue();
            };
            if (typeof global.queueMicrotask === "function") {
                global.queueMicrotask(run);
                return;
            }
            Promise.resolve().then(run);
        }

        function scheduleMissingMockupPair(customerId) {
            const id = normalizeString(customerId);
            if (!id || autoMockupQueuedIds.has(id) || isMockupPending(id)) return;
            autoMockupQueuedIds.add(id);
            autoMockupQueue.push(id);
            scheduleAutoMockupQueue();
        }

        function processAutoMockupQueue() {
            if (autoMockupRunning) return;
            const id = autoMockupQueue.shift();
            if (!id) return;
            autoMockupRunning = true;
            Promise.resolve(ensureMockupForCustomer(id, { silent: true, source: "database-visible-pair" }))
                .then(function (ok) {
                    if (ok) {
                        failedMockupIds.delete(id);
                    } else {
                        failedMockupIds.add(id);
                    }
                })
                .catch(function () {
                    failedMockupIds.add(id);
                })
                .finally(function () {
                    autoMockupRunning = false;
                    autoMockupQueuedIds.delete(id);
                    if (typeof renderPage === "function") renderPage();
                    if (autoMockupQueue.length) scheduleAutoMockupQueue();
                });
        }

        function getCustomerById(customerId) {
            return (state.klanten || []).find(function (item) {
                return item.id === customerId;
            }) || null;
        }

        function hasApprovedMockup(customer) {
            if (!customer || !isValidWebsitePhotoDataUrl(customer.websiteMockup)) return false;
            const status = normalizeString(customer.mockupQualityStatus || customer.websiteMockupQualityStatus).toLowerCase();
            const orientation = normalizeString(customer.mockupOrientation || customer.websiteMockupOrientation).toLowerCase();
            const renderer = normalizeString(customer.mockupRenderer || customer.websiteMockupRenderer);
            const checkedAt = normalizeString(customer.mockupQualityCheckedAt || customer.websiteMockupQualityCheckedAt);
            if (!(status || orientation || renderer || checkedAt)) return false;
            if (status !== "checked" && status !== "verified" && status !== "ok") return false;
            return !orientation || orientation === "upright";
        }

        function isMockupFailed(customerId) {
            const id = normalizeString(customerId);
            if (!id || !failedMockupIds.has(id)) return false;
            return !hasApprovedMockup(getCustomerById(id));
        }

        function queueVisibleMissingMockupRepairs(customers, limit) {
            const max = Math.max(0, Number(limit) || 0);
            if (!max) return 0;
            let queued = 0;
            (Array.isArray(customers) ? customers : []).some(function (customer) {
                const id = normalizeString(customer && customer.id);
                if (!id || autoMockupQueuedIds.has(id) || isMockupPending(id) || isMockupFailed(id)) return false;
                const assetState = getAssetState ? getAssetState(customer) : null;
                const shouldRepair = assetState ? assetState.canRepairMockup : (isValidWebsitePhotoDataUrl(customer && customer.websitePhoto) && !isValidWebsitePhotoDataUrl(customer && customer.websiteMockup));
                if (!shouldRepair) return false;
                scheduleMissingMockupPair(id);
                queued += 1;
                return queued >= max;
            });
            return queued;
        }

        function now() {
            return Date.now ? Date.now() : new Date().getTime();
        }

        function createJobId() {
            if (global.crypto && typeof global.crypto.randomUUID === "function") return global.crypto.randomUUID();
            return "webdesign_" + now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
        }

        function updateChargeLabelPositions() {
            if (!global.document) return;
            const labels = Array.from(global.document.querySelectorAll(".photo-generate-charge-label"));
            labels.reverse().forEach(function (label, index) {
                label.style.bottom = (18 + (index * 44)) + "px";
            });
        }

        function showChargeLabel() {
            if (!global.document) return;
            const label = global.document.createElement("div");
            label.className = "photo-generate-charge-label";
            label.setAttribute("aria-live", "polite");
            label.textContent = formatCentCost(costEur);
            global.document.body.appendChild(label);
            updateChargeLabelPositions();
            const frame = typeof global.requestAnimationFrame === "function"
                ? global.requestAnimationFrame
                : function (callback) { global.setTimeout(callback, 0); };
            frame(function () {
                label.classList.add("is-visible");
            });
            global.setTimeout(function () {
                label.classList.remove("is-visible");
            }, 1800);
            global.setTimeout(function () {
                if (label.parentNode) label.parentNode.removeChild(label);
                updateChargeLabelPositions();
            }, 2200);
        }

        function readPendingJobs() {
            const cutoff = now() - PENDING_TTL_MS;
            return Array.from(pendingJobs.values()).filter(function (item) {
                return item.customerId && item.jobId && item.startedAt >= cutoff;
            });
        }

        function upsertPendingJob(job) {
            pendingJobs.set(job.customerId, job);
        }

        function removePendingJob(customerId) {
            pendingJobs.delete(customerId);
            pendingIds.delete(customerId);
        }

        function setPendingJob(job) {
            pendingIds.add(job.customerId);
            upsertPendingJob(job);
            if (typeof renderPage === "function") renderPage();
        }

        function buildJobPayload(target, jobId) {
            return {
                jobId: jobId,
                websiteUrl: resolveCustomerWebsiteUrl(target),
                customer: {
                    id: target.id,
                    bedrijf: target.bedrijf,
                    naam: target.naam,
                    tel: target.tel || target.telefoon,
                    dom: target.dom,
                    website: target.website
                }
            };
        }

        async function refreshFinishedPhotos(customerId) {
            if (typeof refreshPhotos === "function") {
                await refreshPhotos({ customerId: customerId });
            } else if (typeof renderPage === "function") {
                renderPage();
            }
            if (customerId) await ensureMockupForCustomer(customerId);
        }

        function clearPollTimer(jobId) {
            const timer = pollTimers.get(jobId);
            if (timer) global.clearTimeout(timer);
            pollTimers.delete(jobId);
        }

        function schedulePoll(jobId, delay) {
            if (!jobId || pollTimers.has(jobId)) return;
            const timer = global.setTimeout(function () {
                pollTimers.delete(jobId);
                void pollJob(jobId);
            }, Math.max(0, Number(delay) || 0));
            pollTimers.set(jobId, timer);
        }

        function resolveJobPollDelay(job) {
            const nextAttemptAt = Math.max(0, Number(job && job.nextAttemptAt) || 0);
            if (nextAttemptAt > now()) {
                return Math.max(POLL_INTERVAL_MS, Math.min(nextAttemptAt - now(), POLL_INTERVAL_MS * 12));
            }
            return POLL_INTERVAL_MS;
        }

        async function finishPendingJob(job, message) {
            clearPollTimer(job.jobId);
            removePendingJob(job.customerId);
            await refreshFinishedPhotos(job.customerId);
            if (message) setStatusMessage(message, "error");
            if (typeof renderPage === "function") renderPage();
        }

        async function pollJob(jobId) {
            const storedJob = readPendingJobs().find(function (item) {
                return item.jobId === jobId;
            });
            if (!storedJob) return;

            try {
                const response = await fetch(JOB_ENDPOINT + "/" + encodeURIComponent(jobId), {
                    method: "GET",
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: { Accept: "application/json" }
                });
                const payload = await response.json().catch(function () {
                    return {};
                });
                const job = payload && payload.job ? payload.job : null;
                if (response.status === 404) {
                    if (now() - storedJob.startedAt < 15000) {
                        schedulePoll(jobId, POLL_INTERVAL_MS);
                        return;
                    }
                    await finishPendingJob(storedJob, "Webdesign-opdracht niet gevonden. Probeer opnieuw.");
                    return;
                }
                if (!response.ok || !job) {
                    throw new Error(normalizeString(payload && (payload.detail || payload.error)) || "Webdesign-status laden is mislukt.");
                }
                if (job.status === "done") {
                    await finishPendingJob(storedJob, "");
                    return;
                }
                if (job.status === "error") {
                    await finishPendingJob(storedJob, normalizeString(job.error) || "Webdesign maken is mislukt.");
                    return;
                }
                schedulePoll(jobId, resolveJobPollDelay(job));
            } catch (error) {
                schedulePoll(jobId, POLL_INTERVAL_MS * 2);
            }
        }

        async function loadRunningJobs() {
            try {
                const response = await fetch(JOB_ENDPOINT, {
                    method: "GET",
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: { Accept: "application/json" }
                });
                const payload = await response.json().catch(function () {
                    return {};
                });
                const jobs = Array.isArray(payload && payload.jobs) ? payload.jobs : [];
                if (!response.ok) return;
                jobs.forEach(function (job) {
                    if (!job || (job.status !== "queued" && job.status !== "running")) return;
                    const pendingJob = {
                        customerId: normalizeString(job.customerId),
                        jobId: normalizeString(job.id),
                        startedAt: Math.max(0, Number(job.createdAt) || now())
                    };
                    if (!pendingJob.customerId || !pendingJob.jobId) return;
                    setPendingJob(pendingJob);
                    schedulePoll(pendingJob.jobId, 0);
                });
            } catch (error) {
                /* The next page load or poll will pick up running server jobs again. */
            }
        }

        function resumePendingJobs() {
            const firstLoad = loadRunningJobs();
            global.setTimeout(function () { void loadRunningJobs(); }, 2000);
            return firstLoad;
        }

        function waitForPhotoImage(photo, timeoutMs, loadKey) {
            return new Promise(function (resolve) {
                const source = normalizeString(photo);
                if (!isValidWebsitePhotoDataUrl(source) || typeof global.Image !== "function") {
                    resolve(false);
                    return;
                }
                const image = new global.Image();
                let finished = false;
                const timer = global.setTimeout(function () { finish(false); }, Math.max(250, Number(timeoutMs) || 900));
                function finish(wasLoaded) {
                    if (finished) return;
                    finished = true;
                    if (wasLoaded && loadKey) markPhotoKeyLoaded(loadKey);
                    global.clearTimeout(timer);
                    resolve(Boolean(wasLoaded));
                }
                function fail() {
                    if (loadKey) markPhotoKeyFailed(loadKey);
                    finish(false);
                }
                image.onload = function () {
                    if (typeof image.decode === "function") {
                        image.decode().catch(function () {}).finally(function () { finish(true); });
                        return;
                    }
                    finish(true);
                };
                image.onerror = fail;
                image.src = source;
            });
        }

        async function preloadPhotoImages(customers, limit, timeoutMs) {
            const seen = new Set();
            const photos = [];
            (Array.isArray(customers) ? customers : []).some(function (customer) {
                const photo = normalizeString(customer && customer.websitePhoto);
                if (!isValidWebsitePhotoDataUrl(photo) || seen.has(photo)) return false;
                seen.add(photo);
                photos.push({ source: photo, key: buildPhotoLoadKey("photo", customer && customer.id, photo) });
                const mockup = normalizeString(customer && customer.websiteMockup);
                if (isValidWebsitePhotoDataUrl(mockup) && !seen.has(mockup)) {
                    seen.add(mockup);
                    photos.push({ source: mockup, key: buildPhotoLoadKey("mockup", customer && customer.id, mockup) });
                }
                return photos.length >= Math.max(1, Number(limit) || 24);
            });
            if (!photos.length) return;
            await Promise.allSettled(photos.map(function (photo) {
                return waitForPhotoImage(photo.source, timeoutMs || 450, photo.key);
            }));
        }

        function render(customer) {
            if (!shouldShowWebsitePhoto(customer)) return "";
            const assetState = getAssetState ? getAssetState(customer) : null;
            const photo = normalizeString(customer && customer.websitePhoto);
            const label = normalizeString(customer && customer.websitePhotoName) || "Websitefoto";
            const hasPhoto = assetState ? assetState.hasPhoto : isValidWebsitePhotoDataUrl(photo);
            const photoLoadKey = buildPhotoLoadKey("photo", customer && customer.id, photo);
            if (hasPhoto && shouldRetryFailedPhotoKey(photoLoadKey)) clearFailedPhotoKey(photoLoadKey);
            const photoLoaded = !hasPhoto || isInlinePhotoSource(photo) || loadedPhotoKeys.has(photoLoadKey);
            const photoFailed = hasPhoto && failedPhotoKeys.has(photoLoadKey);
            const isPending = pendingIds.has(customer.id);
            const isRestoring = !hasPhoto && !isPending && Boolean(isRestoringPhotos(customer));
            const isLoading = isPending || isRestoring;
            const canGenerate = !hasPhoto && !isLoading && Boolean(resolveCustomerWebsiteUrl(customer));
            const inner = hasPhoto
                ? (photoFailed ? FALLBACK_ICON : "<span class=\"photo-drop-loader\" aria-hidden=\"true\">" + LOADING_ICON + "</span><img class=\"photo-drop-image\" src=\"" + escapeHtml(photo) + "\" alt=\"" + escapeHtml(label) + "\" loading=\"eager\" fetchpriority=\"high\" decoding=\"async\">")
                : (isLoading ? LOADING_ICON : LIGHTNING_ICON);
            const remove = hasPhoto ? "<button class=\"photo-remove\" type=\"button\" data-remove-photo-id=\"" + escapeHtml(customer.id) + "\" aria-label=\"Websitefoto verwijderen\">&times;</button>" : "";
            const ariaLabel = hasPhoto ? (photoFailed ? "Websitefoto kon niet geladen worden" : "Websitefoto bekijken") : (isLoading ? (isPending ? "Webdesign wordt gemaakt" : "Websitefoto's worden hersteld") : (canGenerate ? "Webdesign maken" : "Geen geldige website gevonden"));
            const title = ariaLabel;
            const mockup = normalizeString(customer && customer.websiteMockup);
            const mockupLabel = normalizeString(customer && customer.websiteMockupName) || "Device mockup";
            const hasMockup = assetState ? assetState.hasMockup : isValidWebsitePhotoDataUrl(mockup);
            const mockupLoadKey = buildPhotoLoadKey("mockup", customer && customer.id, mockup);
            if (hasMockup && shouldRetryFailedPhotoKey(mockupLoadKey)) clearFailedPhotoKey(mockupLoadKey);
            const mockupLoaded = !hasMockup || isInlinePhotoSource(mockup) || loadedPhotoKeys.has(mockupLoadKey);
            const mockupImageFailed = hasMockup && failedPhotoKeys.has(mockupLoadKey);
            const mockupGenerationFailed = isMockupFailed(customer && customer.id);
            const mockupFailed = mockupImageFailed || mockupGenerationFailed;
            const mockupLoading = assetState ? assetState.mockupPending : isMockupPending(customer && customer.id);
            const canGenerateMockup = assetState ? assetState.canRepairMockup : (hasPhoto && !hasMockup && !mockupLoading);
            const mockupInner = hasMockup
                ? (mockupImageFailed ? FALLBACK_ICON : "<span class=\"photo-drop-loader\" aria-hidden=\"true\">" + LOADING_ICON + "</span><img class=\"photo-drop-image\" src=\"" + escapeHtml(mockup) + "\" alt=\"" + escapeHtml(mockupLabel) + "\" loading=\"eager\" fetchpriority=\"high\" decoding=\"async\">")
                : (mockupLoading ? LOADING_ICON : MOCKUP_ICON);
            const mockupAriaLabel = hasMockup ? (mockupImageFailed ? "Device mockup kon niet geladen worden" : (canGenerateMockup ? "Device mockup opnieuw maken" : "Device mockup bekijken")) : (mockupLoading ? "Device mockup wordt gemaakt" : (mockupGenerationFailed ? "Device mockup maken is mislukt" : (canGenerateMockup ? "Device mockup maken" : "Device mockup nog niet beschikbaar")));
            const mockupTitle = hasMockup ? (canGenerateMockup ? "Klik om device mockup opnieuw te maken" : mockupLabel) : (mockupLoading ? "Device mockup wordt gemaakt" : (mockupGenerationFailed ? "Mockup maken is mislukt. Klik om opnieuw te proberen." : (canGenerateMockup ? "Klik om device mockup te maken" : "Maak eerst een webdesign")));
            const mockupSlot = "<div class=\"photo-drop photo-drop--mockup" + (mockupLoading ? " is-generating" : "") + "\" role=\"button\" tabindex=\"0\" data-mockup-photo-id=\"" + escapeHtml(customer.id) + "\" data-has-photo=\"" + (hasMockup ? "true" : "false") + "\" data-photo-key=\"" + escapeHtml(mockupLoadKey) + "\" data-photo-loaded=\"" + (mockupLoaded || mockupFailed ? "true" : "false") + "\" data-photo-error=\"" + (mockupFailed ? "true" : "false") + "\" data-can-generate=\"" + (canGenerateMockup ? "true" : "false") + "\" data-mockup-disabled=\"" + (hasMockup || canGenerateMockup ? "false" : "true") + "\" aria-label=\"" + escapeHtml(mockupAriaLabel) + "\" title=\"" + escapeHtml(mockupTitle) + "\">" + mockupInner + "</div>";
            if (hasPhoto || hasMockup) schedulePhotoDropHydration();
            return "<div class=\"photo-cell\"><div class=\"photo-drop" + (isLoading ? " is-generating" : "") + (isRestoring ? " is-restoring" : "") + "\" role=\"button\" tabindex=\"0\" data-photo-id=\"" + escapeHtml(customer.id) + "\" data-has-photo=\"" + (hasPhoto ? "true" : "false") + "\" data-photo-key=\"" + escapeHtml(photoLoadKey) + "\" data-photo-loaded=\"" + (photoLoaded || photoFailed ? "true" : "false") + "\" data-photo-error=\"" + (photoFailed ? "true" : "false") + "\" data-can-generate=\"" + (canGenerate ? "true" : "false") + "\" aria-label=\"" + ariaLabel + "\" title=\"" + escapeHtml(title) + "\">" + inner + remove + "</div>" + mockupSlot + "</div>";
        }

        async function generateForCustomer(customerId) {
            const target = getCustomerById(customerId);
            if (!target) return;
            if (isValidWebsitePhotoDataUrl(target.websitePhoto)) {
                openWebsitePhotoPreview(customerId);
                return;
            }
            if (pendingIds.has(target.id)) {
                return;
            }
            if (isRestoringPhotos(target)) {
                return;
            }
            if (!isWebdesignPhotoEligible(target)) {
                setStatusMessage("Geen geldige website gevonden voor " + target.bedrijf + ".", "error");
                return;
            }
            setStatusMessage("");
            showChargeLabel();
            const jobId = createJobId();
            setPendingJob({ customerId: target.id, jobId: jobId, startedAt: now() });
            try {
                const response = await fetch(JOB_ENDPOINT, {
                    method: "POST",
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify(buildJobPayload(target, jobId))
                });
                const payload = await response.json().catch(function () {
                    return {};
                });
                const job = payload && payload.job ? payload.job : null;
                if (!response.ok || !job || !job.id) {
                    throw new Error(normalizeString(payload && (payload.detail || payload.error)) || "Webdesign starten is mislukt.");
                }
                if (job.id !== jobId) {
                    clearPollTimer(jobId);
                    setPendingJob({ customerId: target.id, jobId: job.id, startedAt: now() });
                }
                if (job.status === "done") {
                    await finishPendingJob({ customerId: target.id, jobId: job.id }, "");
                    return;
                }
                if (job.status === "error") {
                    await finishPendingJob({ customerId: target.id, jobId: job.id }, normalizeString(job.error) || "Webdesign maken is mislukt.");
                    return;
                }
                schedulePoll(job.id, 0);
            } catch (error) {
                await finishPendingJob({ customerId: target.id, jobId: jobId }, normalizeString(error && error.message) || "Webdesign starten is mislukt.");
            }
        }

        return {
            generateForCustomer: generateForCustomer,
            hydratePhotoDrops: hydratePhotoDrops,
            isMockupFailed: isMockupFailed,
            preloadPhotoImages: preloadPhotoImages,
            queueVisibleMissingMockupRepairs: queueVisibleMissingMockupRepairs,
            render: render,
            resumePendingJobs: resumePendingJobs
        };
    }

    function createOutreachController(options) {
        const state = options.state;
        const nodes = options.nodes;
        const escapeHtml = options.escapeHtml;
        const normalizeSearchValue = options.normalizeSearchValue;
        const normalizeDatabaseStatus = options.normalizeDatabaseStatus;
        const formatDisplayDate = options.formatDisplayDate;
        const parseDateValue = options.parseDateValue;
        const normalizeCustomer = options.normalizeCustomer;
        const persistCustomerList = options.persistCustomerList;
        const renderPage = options.renderPage;
        const setStatusMessage = options.setStatusMessage;
        const STYLE_OUTREACH_ID = "softora-database-outreach-style";

        function ensureOutreachStyles() {
            if (!global.document || global.document.getElementById(STYLE_OUTREACH_ID)) return;
            const style = global.document.createElement("style");
            style.id = STYLE_OUTREACH_ID;
            style.textContent = ".outreach-line{margin-top:4px;color:var(--light);font-size:11px;line-height:1.35;white-space:normal}.outreach-badge{display:inline-flex;align-items:center;width:fit-content;margin-top:6px;padding:3px 8px;border-radius:999px;background:rgba(22,115,60,.1);color:var(--green);font-size:10px;font-weight:700;letter-spacing:.3px;text-transform:uppercase}.outreach-reply{display:flex;flex-direction:column;gap:3px;color:var(--mid);font-size:12px;line-height:1.35}.outreach-reply strong{color:var(--dark);font-size:12px}.outreach-days{display:inline-flex;align-items:center;justify-content:center;min-width:24px;color:var(--crimson);font-weight:800;line-height:1}.outreach-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;width:100%;max-width:320px;min-width:0;margin:0 auto}.outreach-actions--single{grid-template-columns:minmax(0,1fr);max-width:180px}.outreach-action{box-sizing:border-box;min-width:0;min-height:34px;border:1px solid rgba(155,35,85,.18);border-radius:6px;background:rgba(255,255,255,.78);color:var(--crimson);cursor:pointer;font-family:Oswald,sans-serif;font-size:9px;font-weight:700;letter-spacing:.35px;line-height:1.08;overflow-wrap:anywhere;padding:6px 5px;text-align:center;text-transform:uppercase;transition:background .15s ease,border-color .15s ease,color .15s ease}.outreach-action:hover{background:rgba(155,35,85,.08);border-color:rgba(155,35,85,.34)}";
            global.document.head.appendChild(style);
        }

        function normalizeOutreachValue(value) {
            return normalizeString(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        }

        function normalizeOutreachStatus(value) {
            const normalized = normalizeOutreachValue(value);
            if (["benaderd", "gemaild", "sent", "mailed"].indexOf(normalized) !== -1) return "benaderd";
            if (["reactie_ontvangen", "reply_received", "actie_nodig", "action_required"].indexOf(normalized) !== -1) return "reactie_ontvangen";
            if (["interesse", "interested", "geinteresseerd"].indexOf(normalized) !== -1) return "interesse";
            if (["geen_interesse", "geblokkeerd", "opt_out", "unsubscribe", "geenbehoefte"].indexOf(normalized) !== -1) return "geen_interesse";
            if (["afgehaakt", "lost", "no_deal", "geendeal"].indexOf(normalized) !== -1) return "afgehaakt";
            if (["geen_gehoor", "geengehoor", "no_answer"].indexOf(normalized) !== -1) return "geen_gehoor";
            if (["klant_geworden", "klant", "customer", "paid"].indexOf(normalized) !== -1) return "klant_geworden";
            return "";
        }

        function normalizeBooleanFlag(value) {
            const normalized = normalizeString(value).toLowerCase();
            if (["false", "nee", "no", "0", "uit"].indexOf(normalized) !== -1) return false;
            return value === true || normalized === "true" || normalized === "ja" || normalized === "yes" || normalized === "1";
        }

        function normalizeCustomerFields(raw) {
            return {
                campaignType: normalizeString(raw && (raw.campaignType || raw.campaign_type)),
                campaign_type: normalizeString(raw && (raw.campaign_type || raw.campaignType)),
                outreachCampaignType: normalizeString(raw && (raw.outreachCampaignType || raw.outreach_campaign_type)),
                outreach_campaign_type: normalizeString(raw && (raw.outreach_campaign_type || raw.outreachCampaignType)),
                coldmailSpecialAction: normalizeString(raw && raw.coldmailSpecialAction),
                outreachStatus: normalizeString(raw && raw.outreachStatus),
                actionRequired: normalizeBooleanFlag(raw && (raw.actionRequired || raw.outreachActionRequired)),
                outreachActionRequired: normalizeBooleanFlag(raw && (raw.outreachActionRequired || raw.actionRequired)),
                sentFromEmail: normalizeString(raw && (raw.sentFromEmail || raw.sent_from_email || raw.outreachSentFromEmail || raw.lastColdmailSenderEmail)),
                sent_from_email: normalizeString(raw && (raw.sent_from_email || raw.sentFromEmail || raw.outreachSentFromEmail || raw.lastColdmailSenderEmail)),
                outreachSentFromEmail: normalizeString(raw && (raw.outreachSentFromEmail || raw.sentFromEmail || raw.sent_from_email || raw.lastColdmailSenderEmail)),
                outreachSentAt: normalizeString(raw && (raw.outreachSentAt || raw.outreach_sent_at || raw.lastColdmailSentAt || raw.lastMailSentAt)),
                outreach_sent_at: normalizeString(raw && (raw.outreach_sent_at || raw.outreachSentAt || raw.lastColdmailSentAt || raw.lastMailSentAt)),
                lastReplyAt: normalizeString(raw && (raw.lastReplyAt || raw.last_reply_at || raw.lastColdmailReplyAt)),
                last_reply_at: normalizeString(raw && (raw.last_reply_at || raw.lastReplyAt || raw.lastColdmailReplyAt)),
                replyThreadId: normalizeString(raw && (raw.replyThreadId || raw.reply_thread_id || raw.replyMailboxId || raw.lastColdmailReplyMessageKey)),
                reply_thread_id: normalizeString(raw && (raw.reply_thread_id || raw.replyThreadId || raw.replyMailboxId || raw.lastColdmailReplyMessageKey)),
                replyMessageId: normalizeString(raw && raw.replyMessageId),
                replyMailboxId: normalizeString(raw && raw.replyMailboxId),
                replyMailboxFolder: normalizeString(raw && raw.replyMailboxFolder),
                replyMailboxAccount: normalizeString(raw && raw.replyMailboxAccount),
                coldmailSentMessageId: normalizeString(raw && raw.coldmailSentMessageId),
                outreachMessageId: normalizeString(raw && raw.outreachMessageId),
                lastColdmailSenderEmail: normalizeString(raw && raw.lastColdmailSenderEmail),
                lastMailSentAt: normalizeString(raw && raw.lastMailSentAt),
                lastColdmailSentAt: normalizeString(raw && raw.lastColdmailSentAt),
                coldmailCampaignStartedAt: normalizeString(raw && raw.coldmailCampaignStartedAt),
                coldmailCampaignDurationDays: raw && raw.coldmailCampaignDurationDays,
                coldmailCampaignEndsAt: normalizeString(raw && raw.coldmailCampaignEndsAt),
                activeColdmailCampaignUntil: normalizeString(raw && raw.activeColdmailCampaignUntil),
                lastColdmailReplyAt: normalizeString(raw && raw.lastColdmailReplyAt),
                lastColdmailReplySubject: normalizeString(raw && raw.lastColdmailReplySubject),
                lastColdmailReplyPreview: normalizeString(raw && raw.lastColdmailReplyPreview),
                lastColdmailReplyMessageKey: normalizeString(raw && raw.lastColdmailReplyMessageKey),
                coldmailReplyIntent: normalizeString(raw && raw.coldmailReplyIntent),
                lastColdmailProvider: normalizeString(raw && raw.lastColdmailProvider),
                lastColdmailProviderStatus: normalizeString(raw && raw.lastColdmailProviderStatus),
                instantlyLeadId: normalizeString(raw && raw.instantlyLeadId),
                instantlyCampaignId: normalizeString(raw && raw.instantlyCampaignId),
                instantlyStatus: normalizeString(raw && raw.instantlyStatus),
                instantlySyncedAt: normalizeString(raw && raw.instantlySyncedAt),
                instantlyLastEventAt: normalizeString(raw && raw.instantlyLastEventAt),
                instantlyEmailSentAt: normalizeString(raw && raw.instantlyEmailSentAt),
                statusUpdatedAt: normalizeString(raw && raw.statusUpdatedAt)
            };
        }

        function hasInstantlyOutreachSignal(customer) {
            if (!customer) return false;
            const provider = normalizeString(customer.lastColdmailProvider).toLowerCase();
            if (provider === "instantly") return true;
            return Boolean(normalizeString(customer.instantlyLeadId || customer.instantlyCampaignId || customer.instantlyStatus || customer.instantlySyncedAt || customer.instantlyLastEventAt || customer.instantlyEmailSentAt));
        }

        function isInstantlyTabCustomer(customer) {
            if (!hasInstantlyOutreachSignal(customer)) return false;
            const status = normalizeDatabaseStatus(customer && customer.status, customer);
            return ["klant", "interesse", "afspraak", "afgehaakt", "geblokkeerd", "geengehoor", "buiten"].indexOf(status) === -1;
        }

        function matchesStatusFilter(customer, activeStatus, hasUsedColdCalling, hasUsedColdMailing) {
            const status = normalizeString(activeStatus);
            if (status === "instantly") return isInstantlyTabCustomer(customer);
            if (status === "benaderd") {
                const usedColdCalling = typeof hasUsedColdCalling === "function" && hasUsedColdCalling(customer);
                const usedColdMailing = typeof hasUsedColdMailing === "function" && hasUsedColdMailing(customer);
                return !isInstantlyTabCustomer(customer) && (usedColdCalling || usedColdMailing);
            }
            return status === "alle" || normalizeDatabaseStatus(customer && customer.status, customer) === status;
        }

        function isWebdesignOutreachCustomer(customer) {
            return Boolean(customer) && [customer.campaignType, customer.campaign_type, customer.outreachCampaignType, customer.outreach_campaign_type, customer.coldmailSpecialAction].some(function (value) {
                const normalized = normalizeOutreachValue(value);
                return normalized === "webdesign" || normalized === "website_design";
            });
        }

        function isDefinitiveOutreachStatus(status) {
            return ["interesse", "geen_interesse", "afgehaakt", "geen_gehoor", "klant_geworden"].indexOf(normalizeOutreachStatus(status)) !== -1;
        }

        function mapDatabaseStatus(customer) {
            const status = normalizeDatabaseStatus(customer && customer.status, customer);
            if (status === "interesse") return "interesse";
            if (status === "geblokkeerd") return "geen_interesse";
            if (status === "afgehaakt") return "afgehaakt";
            if (status === "geengehoor") return "geen_gehoor";
            if (status === "klant") return "klant_geworden";
            return "";
        }

        function isActionRequired(customer) {
            const status = getEffectiveStatus(customer);
            return isWebdesignOutreachCustomer(customer) && !isDefinitiveOutreachStatus(status) && (status === "reactie_ontvangen" || Boolean(customer && (customer.actionRequired || customer.outreachActionRequired)));
        }

        function getEffectiveStatus(customer) {
            const outreachStatus = normalizeOutreachStatus(customer && customer.outreachStatus);
            const databaseStatus = mapDatabaseStatus(customer);
            if (isDefinitiveOutreachStatus(databaseStatus) && !isDefinitiveOutreachStatus(outreachStatus)) return databaseStatus;
            if (outreachStatus) return outreachStatus;
            if (databaseStatus) return databaseStatus;
            return "benaderd";
        }

        function getStatusLabel(status) {
            return {
                benaderd: "Benaderd",
                reactie_ontvangen: "Reactie ontvangen",
                interesse: "Interesse",
                geen_interesse: "Geen interesse",
                afgehaakt: "Afgehaakt",
                geen_gehoor: "Geen gehoor",
                klant_geworden: "Klant geworden"
            }[normalizeOutreachStatus(status)] || "Benaderd";
        }

        function getSentFromEmail(customer) {
            return normalizeString(customer && (customer.sentFromEmail || customer.sent_from_email || customer.outreachSentFromEmail || customer.lastColdmailSenderEmail));
        }

        function getSentAt(customer) {
            const explicitSentAt = normalizeString(customer && (customer.outreachSentAt || customer.outreach_sent_at || customer.lastColdmailSentAt || customer.lastMailSentAt));
            if (explicitSentAt) return explicitSentAt;
            return normalizeDatabaseStatus(customer && customer.status, customer) === "gemaild"
                ? normalizeString(customer && (customer.statusUpdatedAt || customer.updatedAt))
                : "";
        }

        function getReplyAt(customer) {
            return normalizeString(customer && (customer.lastReplyAt || customer.last_reply_at || customer.lastColdmailReplyAt));
        }

        function hasMailMessageReference(customer) {
            return Boolean(normalizeString(customer && (
                customer.replyThreadId
                || customer.reply_thread_id
                || customer.replyMessageId
                || customer.replyMailboxId
                || customer.coldmailSentMessageId
                || customer.outreachMessageId
                || customer.lastColdmailReplyMessageKey
            )));
        }

        function isTrackedOutreachCustomer(customer) {
            return Boolean(customer) && (
                isWebdesignOutreachCustomer(customer)
                || normalizeDatabaseStatus(customer && customer.status, customer) === "gemaild"
                || Boolean(getSentAt(customer))
                || Boolean(getSentFromEmail(customer))
                || Boolean(getReplyAt(customer))
                || hasMailMessageReference(customer)
            );
        }

        function augmentSearchHaystack(customer) {
            return [getSentFromEmail(customer), getStatusLabel(getEffectiveStatus(customer)), isActionRequired(customer) ? "reactie ontvangen actie nodig" : ""].join(" ").toLowerCase();
        }

        function renderMeta(customer, forceOutreachMeta) {
            if (!isWebdesignOutreachCustomer(customer) && !(forceOutreachMeta && isTrackedOutreachCustomer(customer))) return "";
            const sentAt = getSentAt(customer);
            return "<div class=\"outreach-line\">Verstuurd vanaf " + escapeHtml(getSentFromEmail(customer) || "onbekend mailadres") + (sentAt ? " · " + escapeHtml(formatDisplayDate(sentAt)) : "") + "</div>" + (isActionRequired(customer) ? "<span class=\"outreach-badge\">Reactie ontvangen</span>" : "");
        }

        function renderReplyInfo(customer) {
            if (!isWebdesignOutreachCustomer(customer)) return "";
            const replyAt = getReplyAt(customer);
            return escapeHtml(formatDisplayDate(replyAt || customer.updatedAt || getSentAt(customer)));
        }

        function getLocalDateSerial(timestamp) {
            const date = new Date(timestamp);
            if (!Number.isFinite(date.getTime())) return null;
            return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
        }

        function getDaysSinceSent(customer) {
            const sentMs = parseDateValue(getSentAt(customer));
            if (!sentMs) return null;
            const sentDay = getLocalDateSerial(sentMs);
            const today = getLocalDateSerial(Date.now());
            if (sentDay === null || today === null) return null;
            return Math.max(0, Math.floor((today - sentDay) / 86400000));
        }

        function renderDaysSinceSent(customer) {
            if (!isTrackedOutreachCustomer(customer)) return "";
            const days = getDaysSinceSent(customer);
            if (days === null) return "";
            const label = days === 1 ? "1 dag geleden" : days + " dagen geleden";
            return "<span class=\"outreach-days\" title=\"" + escapeHtml(label) + "\">" + escapeHtml(String(days)) + "</span>";
        }

        function renderActions(customer, options) {
            if (!isTrackedOutreachCustomer(customer)) return "";
            const settings = options && typeof options === "object" ? options : {};
            const id = escapeHtml(customer.id);
            const hideMailButton = Boolean(settings.hideMailButton);
            const mailButton = hideMailButton ? "" : "<button class=\"outreach-action\" type=\"button\" data-outreach-status=\"mail\" data-outreach-id=\"" + id + "\">Mail bekijken</button>";
            return "<div class=\"outreach-actions" + (hideMailButton ? " outreach-actions--single" : "") + "\"><button class=\"outreach-action\" type=\"button\" data-outreach-status=\"klant_geworden\" data-outreach-id=\"" + id + "\">Is klant geworden</button>" + mailButton + "</div>";
        }

        function getRecentOutreachTimestamp(customer, parseValue) {
            const sentMs = parseValue(getSentAt(customer));
            if (sentMs) return sentMs;
            return Number(customer && customer.updatedMs) || parseValue(customer && customer.updatedAt) || 0;
        }

        function sortByRecentOutreach(customers, parseValue, normalizeValue) {
            const parseTimestamp = typeof parseValue === "function" ? parseValue : function () { return 0; };
            const normalizeName = typeof normalizeValue === "function" ? normalizeValue : normalizeOutreachValue;
            return (Array.isArray(customers) ? customers : []).slice().sort(function (a, b) {
                const left = getRecentOutreachTimestamp(a, parseTimestamp);
                const right = getRecentOutreachTimestamp(b, parseTimestamp);
                if (left !== right) return right - left;
                const leftName = normalizeName(a && a.bedrijf);
                const rightName = normalizeName(b && b.bedrijf);
                if (leftName < rightName) return -1;
                if (leftName > rightName) return 1;
                return 0;
            });
        }

        function hasAutomatedNoReplyHistory(customer) {
            const history = Array.isArray(customer && customer.hist) ? customer.hist : [];
            return history.some(function (item) {
                const source = normalizeOutreachValue(item && item.source);
                const label = normalizeOutreachValue(item && (item.label || item.message || item.title));
                return source === "webdesign_outreach_automation" || label === "geen_gehoor_na_25_dagen";
            });
        }

        function shouldRestoreAutomatedNoReply(customer) {
            if (!isWebdesignOutreachCustomer(customer) || !hasAutomatedNoReplyHistory(customer)) return false;
            return normalizeOutreachStatus(customer && customer.outreachStatus) === "geen_gehoor" || mapDatabaseStatus(customer) === "geen_gehoor";
        }

        function restoreAutomatedNoReply(customer, nowIso) {
            return {
                ...customer,
                status: "gemaild",
                databaseStatus: "gemaild",
                outreachStatus: "benaderd",
                actionRequired: false,
                outreachActionRequired: false,
                statusUpdatedAt: nowIso,
                updatedAt: nowIso,
                hist: [{
                    type: "gemaild",
                    label: "Automatische geen gehoor-regel teruggedraaid",
                    date: nowIso,
                    actor: "Premium database",
                    source: "webdesign-outreach-automation-rollback"
                }].concat(Array.isArray(customer.hist) ? customer.hist : []).slice(0, 50)
            };
        }

        function applyAutomation(customers) {
            let changed = false;
            const nowIso = new Date().toISOString();
            const list = Array.isArray(customers) ? customers : [];
            const nextCustomers = list.map(function (customer) {
                if (!shouldRestoreAutomatedNoReply(customer)) return customer;
                changed = true;
                return restoreAutomatedNoReply(customer, nowIso);
            });
            return {
                changed: changed,
                customers: nextCustomers
            };
        }

        function findCustomerById(id) {
            const key = normalizeString(id);
            return (state.klanten || []).find(function (customer) { return normalizeString(customer.id) === key; }) || null;
        }

        function openMail(customer) {
            const params = new URLSearchParams();
            const account = normalizeString(customer.replyMailboxAccount || getSentFromEmail(customer));
            const replyMessage = normalizeString(customer.replyMailboxId || customer.replyThreadId || customer.replyMessageId || customer.lastColdmailReplyMessageKey);
            const sentMessage = normalizeString(customer.outreachMessageId || customer.coldmailSentMessageId);
            const message = replyMessage || sentMessage;
            if (account) params.set("account", account);
            params.set("folder", replyMessage ? "inbox" : "sent");
            if (message) params.set("message", message);
            if (customer.email) params.set("email", customer.email);
            params.set("q", customer.email || customer.bedrijf || "");
            params.set("select", "first");
            global.location.href = "/premium-mailbox?" + params.toString();
        }

        async function updateStatus(customerId, status) {
            const customer = findCustomerById(customerId);
            if (!customer) return;
            if (status === "mail") return openMail(customer);
            setStatusMessage("Outreach-status bijwerken...", "info");
            try {
                const response = await fetch("/api/coldmailing/outreach/status", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ customerId: customer.id, email: customer.email, mailboxId: customer.replyMailboxId, messageId: customer.replyMessageId || customer.outreachMessageId, status: status }) });
                const data = await response.json().catch(function () { return {}; });
                if (!response.ok || !data.ok) throw new Error(data.message || "Status kon niet worden bijgewerkt.");
                const normalized = normalizeCustomer(data.customer || {}, data.customer && data.customer.id);
                state.klanten = state.klanten.map(function (item) { return item.id === normalized.id ? normalized : item; });
                renderPage();
                setStatusMessage(getStatusLabel(status) + " opgeslagen.", "success", true);
            } catch (error) {
                setStatusMessage(String(error && error.message || error || "Status kon niet worden bijgewerkt."), "error");
            }
        }

        ensureOutreachStyles();
        return { applyAutomation: applyAutomation, augmentSearchHaystack: augmentSearchHaystack, getEffectiveStatus: getEffectiveStatus, getSentAt: getSentAt, getSentFromEmail: getSentFromEmail, getStatusLabel: getStatusLabel, hasInstantlyOutreachSignal: hasInstantlyOutreachSignal, isActionRequired: isActionRequired, isInstantlyTabCustomer: isInstantlyTabCustomer, isTrackedOutreachCustomer: isTrackedOutreachCustomer, isWebdesignOutreachCustomer: isWebdesignOutreachCustomer, matchesStatusFilter: matchesStatusFilter, normalizeCustomerFields: normalizeCustomerFields, renderActions: renderActions, renderDaysSinceSent: renderDaysSinceSent, renderMeta: renderMeta, renderReplyInfo: renderReplyInfo, sortByRecentOutreach: sortByRecentOutreach, updateStatus: updateStatus };
    }

    global.SoftoraDatabaseOutreach = {
        createController: createOutreachController,
        normalizeCustomerFields: function (raw) {
            return createOutreachController({
                state: {},
                nodes: {},
                escapeHtml: function (value) { return String(value || ""); },
                normalizeSearchValue: normalizeString,
                normalizeDatabaseStatus: function (value) { return normalizeString(value); },
                formatDisplayDate: normalizeString,
                parseDateValue: function () { return 0; },
                normalizeCustomer: function (value) { return value || {}; },
                persistCustomerList: function () {},
                renderPage: function () {},
                setStatusMessage: function () {}
            }).normalizeCustomerFields(raw);
        }
    };

    global.SoftoraDatabaseWebdesignAction = {
        createController: createController
    };
})(window);
