(function (global) {
    "use strict";

    const STYLE_ID = "softora-database-webdesign-action-style";
    const JOB_ENDPOINT = "/api/premium-database/webdesign-photo-jobs";
    const PENDING_TTL_MS = 6 * 60 * 60 * 1000;
    const POLL_INTERVAL_MS = 2200;
    const LIGHTNING_ICON = "<svg class=\"photo-generate-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"currentColor\" d=\"M13.25 2.25 4.9 13.35a.75.75 0 0 0 .6 1.2h5.08l-1.84 7.02a.75.75 0 0 0 1.33.62l8.95-11.55a.75.75 0 0 0-.6-1.21h-5.21l1.45-6.54a.75.75 0 0 0-1.41-.64Z\"/></svg>";
    const MOCKUP_ICON = "<svg class=\"photo-mockup-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M4 6.5h10.5v7H4zM3 16h13M17 8h3.5v8H17zM18.75 18h.01\"/></svg>";
    const LOADING_ICON = "<span class=\"photo-generate-spinner\" aria-hidden=\"true\"></span>";
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
        style.textContent = ".photo-cell{display:inline-flex;align-items:center;justify-content:center;gap:4px}.photo-drop[data-has-photo=\"false\"]{overflow:visible}.photo-drop[data-has-photo=\"false\"][data-can-generate=\"true\"]{background:rgba(155,35,85,.08)}.photo-drop[data-has-photo=\"false\"][data-can-generate=\"false\"]{opacity:.55;cursor:not-allowed}.photo-drop.is-generating,.photo-drop.is-restoring,.photo-drop[data-has-photo=\"true\"][data-photo-loaded=\"false\"]{cursor:wait}.photo-drop--mockup{border-style:solid;background:rgba(20,24,45,.04)}.photo-drop-loader{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.84);opacity:1;pointer-events:none;transition:opacity .16s ease;z-index:1}.photo-drop[data-photo-loaded=\"true\"] .photo-drop-loader{opacity:0}.photo-drop-image{width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity .16s ease}.photo-drop[data-photo-loaded=\"true\"] .photo-drop-image{opacity:1}.photo-generate-icon,.photo-mockup-icon{width:18px;height:18px;color:var(--crimson);transition:transform .16s ease,color .16s ease}.photo-drop:hover .photo-generate-icon,.photo-drop:focus-visible .photo-generate-icon,.photo-drop:hover .photo-mockup-icon,.photo-drop:focus-visible .photo-mockup-icon{color:var(--crimson-light);transform:scale(1.08)}.photo-generate-charge-label{position:fixed;right:18px;bottom:18px;z-index:12000;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:#c0392b;color:#fff;box-shadow:0 12px 28px rgba(192,57,43,.24);padding:8px 12px;font-family:Inter,sans-serif;font-size:13px;font-weight:800;letter-spacing:0;line-height:1;opacity:0;transform:translateY(8px) scale(.96);pointer-events:none;transition:opacity .14s ease,transform .14s ease,bottom .16s ease}.photo-generate-charge-label.is-visible{opacity:1;transform:translateY(0) scale(1)}.photo-generate-spinner{width:18px;height:18px;border:2px solid rgba(155,35,85,.18);border-top-color:var(--crimson);border-radius:999px;animation:photoGenerateSpin .8s linear infinite}@keyframes photoGenerateSpin{to{transform:rotate(360deg)}}";
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
        const ensureMockupForCustomer = typeof options.ensureMockupForCustomer === "function" ? options.ensureMockupForCustomer : async function () {};
        const isMockupPending = typeof options.isMockupPending === "function" ? options.isMockupPending : function () { return false; };
        const isRestoringPhotos = typeof options.isRestoringPhotos === "function" ? options.isRestoringPhotos : function (customer) { return Boolean(state && state.photoRestorePending) && shouldShowWebsitePhoto(customer); };
        const costEur = Math.max(0, Number(options.costEur) || 0);
        const pendingIds = new Set();
        const pendingJobs = new Map();
        const pollTimers = new Map();
        let photoHydrationQueued = false;
        ensureStyles();

        function runNextFrame(callback) {
            const frame = typeof global.requestAnimationFrame === "function"
                ? global.requestAnimationFrame
                : function (next) { global.setTimeout(next, 0); };
            frame(callback);
        }

        function markPhotoDropReady(drop) {
            if (!drop || typeof drop.setAttribute !== "function") return;
            drop.setAttribute("data-photo-loaded", "true");
            drop.removeAttribute("data-photo-loading-bound");
        }

        function bindPhotoDropLoading(drop) {
            if (!drop || typeof drop.querySelector !== "function") return;
            const image = drop.querySelector(".photo-drop-image");
            if (!image) {
                markPhotoDropReady(drop);
                return;
            }
            if (drop.getAttribute("data-photo-loaded") === "true") return;
            const finish = function () { markPhotoDropReady(drop); };
            const onLoad = function () {
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
            if (drop.getAttribute("data-photo-loading-bound") === "true") return;
            drop.setAttribute("data-photo-loading-bound", "true");
            image.addEventListener("load", onLoad, { once: true });
            image.addEventListener("error", finish, { once: true });
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

        function getCustomerById(customerId) {
            return (state.klanten || []).find(function (item) {
                return item.id === customerId;
            }) || null;
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

        async function finishPendingJob(job, message) {
            clearPollTimer(job.jobId);
            removePendingJob(job.customerId);
            await refreshFinishedPhotos(job.customerId);
            if (message) setStatusMessage(message, "error", true);
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
                schedulePoll(jobId, POLL_INTERVAL_MS);
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

        function waitForPhotoImage(photo, timeoutMs) {
            return new Promise(function (resolve) {
                const dataUrl = normalizeString(photo);
                if (!isValidWebsitePhotoDataUrl(dataUrl) || typeof global.Image !== "function") {
                    resolve(false);
                    return;
                }
                const image = new global.Image();
                let finished = false;
                const timer = global.setTimeout(finish, Math.max(250, Number(timeoutMs) || 900));
                function finish() {
                    if (finished) return;
                    finished = true;
                    global.clearTimeout(timer);
                    resolve(true);
                }
                image.onload = function () {
                    if (typeof image.decode === "function") {
                        image.decode().catch(function () {}).finally(finish);
                        return;
                    }
                    finish();
                };
                image.onerror = finish;
                image.src = dataUrl;
            });
        }

        async function preloadPhotoImages(customers, limit, timeoutMs) {
            const seen = new Set();
            const photos = [];
            (Array.isArray(customers) ? customers : []).some(function (customer) {
                const photo = normalizeString(customer && customer.websitePhoto);
                if (!isValidWebsitePhotoDataUrl(photo) || seen.has(photo)) return false;
                seen.add(photo);
                photos.push(photo);
                return photos.length >= Math.max(1, Number(limit) || 24);
            });
            if (!photos.length) return;
            await Promise.allSettled(photos.map(function (photo) {
                return waitForPhotoImage(photo, timeoutMs || 450);
            }));
        }

        function render(customer) {
            if (!shouldShowWebsitePhoto(customer)) return "";
            const photo = normalizeString(customer && customer.websitePhoto);
            const label = normalizeString(customer && customer.websitePhotoName) || "Websitefoto";
            const hasPhoto = isValidWebsitePhotoDataUrl(photo);
            const isPending = pendingIds.has(customer.id);
            const isRestoring = !hasPhoto && !isPending && Boolean(isRestoringPhotos(customer));
            const isLoading = isPending || isRestoring;
            const canGenerate = !hasPhoto && !isLoading && Boolean(resolveCustomerWebsiteUrl(customer));
            const inner = hasPhoto ? "<span class=\"photo-drop-loader\" aria-hidden=\"true\">" + LOADING_ICON + "</span><img class=\"photo-drop-image\" src=\"" + escapeHtml(photo) + "\" alt=\"" + escapeHtml(label) + "\" loading=\"eager\" decoding=\"sync\">" : (isLoading ? LOADING_ICON : LIGHTNING_ICON);
            const remove = hasPhoto ? "<button class=\"photo-remove\" type=\"button\" data-remove-photo-id=\"" + escapeHtml(customer.id) + "\" aria-label=\"Websitefoto verwijderen\">&times;</button>" : "";
            const ariaLabel = hasPhoto ? "Websitefoto bekijken" : (isLoading ? (isPending ? "Webdesign wordt gemaakt" : "Websitefoto's worden hersteld") : (canGenerate ? "Webdesign maken" : "Geen geldige website gevonden"));
            const title = ariaLabel;
            const mockup = normalizeString(customer && customer.websiteMockup);
            const mockupLabel = normalizeString(customer && customer.websiteMockupName) || "Device mockup";
            const hasMockup = isValidWebsitePhotoDataUrl(mockup);
            const canUseMockup = hasPhoto || hasMockup;
            const mockupLoading = hasPhoto && !hasMockup && isMockupPending(customer.id);
            const mockupInner = hasMockup ? "<span class=\"photo-drop-loader\" aria-hidden=\"true\">" + LOADING_ICON + "</span><img class=\"photo-drop-image\" src=\"" + escapeHtml(mockup) + "\" alt=\"" + escapeHtml(mockupLabel) + "\" loading=\"eager\" decoding=\"sync\">" : (mockupLoading ? LOADING_ICON : MOCKUP_ICON);
            const mockupAriaLabel = hasMockup ? "Device mockup bekijken" : (mockupLoading ? "Device mockup wordt gemaakt" : (canUseMockup ? "Device mockup maken" : "Device mockup nog niet beschikbaar"));
            const mockupTitle = hasMockup ? mockupLabel : (canUseMockup ? "Device mockup maken" : "Maak eerst een webdesign");
            const mockupSlot = "<div class=\"photo-drop photo-drop--mockup" + (mockupLoading ? " is-generating" : "") + "\" role=\"button\" tabindex=\"0\" data-mockup-photo-id=\"" + escapeHtml(customer.id) + "\" data-has-photo=\"" + (hasMockup ? "true" : "false") + "\" data-photo-loaded=\"" + (hasMockup ? "false" : "true") + "\" data-can-generate=\"" + (canUseMockup ? "true" : "false") + "\" data-mockup-disabled=\"" + (canUseMockup ? "false" : "true") + "\" aria-label=\"" + escapeHtml(mockupAriaLabel) + "\" title=\"" + escapeHtml(mockupTitle) + "\">" + mockupInner + "</div>";
            if (hasPhoto || hasMockup) schedulePhotoDropHydration();
            return "<div class=\"photo-cell\"><div class=\"photo-drop" + (isLoading ? " is-generating" : "") + (isRestoring ? " is-restoring" : "") + "\" role=\"button\" tabindex=\"0\" data-photo-id=\"" + escapeHtml(customer.id) + "\" data-has-photo=\"" + (hasPhoto ? "true" : "false") + "\" data-photo-loaded=\"" + (hasPhoto ? "false" : "true") + "\" data-can-generate=\"" + (canGenerate ? "true" : "false") + "\" aria-label=\"" + ariaLabel + "\" title=\"" + escapeHtml(title) + "\">" + inner + remove + "</div>" + mockupSlot + "</div>";
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
                setStatusMessage("Geen geldige website gevonden voor " + target.bedrijf + ".", "error", true);
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
            preloadPhotoImages: preloadPhotoImages,
            render: render,
            resumePendingJobs: resumePendingJobs
        };
    }

    global.SoftoraDatabaseWebdesignAction = {
        createController: createController
    };
})(window);
