(function (global) {
    "use strict";

    const STYLE_ID = "softora-database-webdesign-action-style";
    const JOB_ENDPOINT = "/api/premium-database/webdesign-photo-jobs";
    const PENDING_TTL_MS = 6 * 60 * 60 * 1000;
    const POLL_INTERVAL_MS = 2200;
    const LIGHTNING_ICON = "<svg class=\"photo-generate-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"currentColor\" d=\"M13.25 2.25 4.9 13.35a.75.75 0 0 0 .6 1.2h5.08l-1.84 7.02a.75.75 0 0 0 1.33.62l8.95-11.55a.75.75 0 0 0-.6-1.21h-5.21l1.45-6.54a.75.75 0 0 0-1.41-.64Z\"/></svg>";
    const LOADING_ICON = "<span class=\"photo-generate-spinner\" aria-hidden=\"true\"></span>";

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function defaultFormatEuroCost(value) {
        return "€" + Number(value || 0).toLocaleString("nl-NL", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function ensureStyles() {
        if (!global.document || global.document.getElementById(STYLE_ID)) return;
        const style = global.document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = ".photo-drop[data-has-photo=\"false\"]{overflow:visible}.photo-drop[data-has-photo=\"false\"][data-can-generate=\"true\"]{background:rgba(155,35,85,.08)}.photo-drop[data-has-photo=\"false\"][data-can-generate=\"false\"]{opacity:.55;cursor:not-allowed}.photo-drop.is-generating{cursor:wait}.photo-generate-icon{width:18px;height:18px;color:var(--crimson);transition:transform .16s ease,color .16s ease}.photo-drop:hover .photo-generate-icon,.photo-drop:focus-visible .photo-generate-icon{color:var(--crimson-light);transform:scale(1.08)}.photo-generate-cost{position:absolute;left:calc(100% + 8px);top:50%;transform:translateY(-50%) scale(.96);z-index:30;display:inline-flex;align-items:center;white-space:nowrap;border:1px solid rgba(155,35,85,.24);background:#fff;color:var(--crimson);box-shadow:0 8px 18px rgba(26,26,46,.12);border-radius:999px;padding:4px 8px;font-family:Inter,sans-serif;font-size:11px;font-weight:700;letter-spacing:0;text-transform:none;line-height:1;opacity:0;pointer-events:none;transition:opacity .08s ease,transform .08s ease}.photo-drop:hover .photo-generate-cost,.photo-drop:focus-visible .photo-generate-cost{opacity:1;transform:translateY(-50%) scale(1)}.photo-generate-spinner{width:18px;height:18px;border:2px solid rgba(155,35,85,.18);border-top-color:var(--crimson);border-radius:999px;animation:photoGenerateSpin .8s linear infinite}@keyframes photoGenerateSpin{to{transform:rotate(360deg)}}";
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
        const formatEuroCost = typeof options.formatEuroCost === "function" ? options.formatEuroCost : defaultFormatEuroCost;
        const costEur = Math.max(0, Number(options.costEur) || 0);
        const pendingIds = new Set();
        const pendingJobs = new Map();
        const pollTimers = new Map();
        ensureStyles();

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

        async function refreshFinishedPhotos() {
            if (typeof refreshPhotos === "function") {
                await refreshPhotos();
            } else if (typeof renderPage === "function") {
                renderPage();
            }
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
            await refreshFinishedPhotos();
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
                    await finishPendingJob(storedJob, "");
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
            void loadRunningJobs();
            global.setTimeout(function () { void loadRunningJobs(); }, 2000);
        }

        function render(customer) {
            if (!shouldShowWebsitePhoto(customer)) return "";
            const photo = normalizeString(customer && customer.websitePhoto);
            const label = normalizeString(customer && customer.websitePhotoName) || "Websitefoto";
            const hasPhoto = isValidWebsitePhotoDataUrl(photo);
            const canGenerate = !hasPhoto && Boolean(resolveCustomerWebsiteUrl(customer));
            const isPending = pendingIds.has(customer.id);
            const costText = "-" + formatEuroCost(costEur) + " AI-kosten";
            const costBadge = canGenerate ? "<span class=\"photo-generate-cost\" aria-hidden=\"true\">" + escapeHtml(costText) + "</span>" : "";
            const inner = hasPhoto ? "<img src=\"" + escapeHtml(photo) + "\" alt=\"" + escapeHtml(label) + "\">" : (isPending ? LOADING_ICON : LIGHTNING_ICON + costBadge);
            const remove = hasPhoto ? "<button class=\"photo-remove\" type=\"button\" data-remove-photo-id=\"" + escapeHtml(customer.id) + "\" aria-label=\"Websitefoto verwijderen\">&times;</button>" : "";
            const ariaLabel = hasPhoto ? "Websitefoto bekijken" : (isPending ? "Webdesign wordt gemaakt" : (canGenerate ? "Webdesign maken, kost " + costText : "Geen geldige website gevonden"));
            const title = canGenerate && !hasPhoto && !isPending ? "Webdesign maken kost " + costText : ariaLabel;
            return "<div class=\"photo-cell\"><div class=\"photo-drop" + (isPending ? " is-generating" : "") + "\" role=\"button\" tabindex=\"0\" data-photo-id=\"" + escapeHtml(customer.id) + "\" data-has-photo=\"" + (hasPhoto ? "true" : "false") + "\" data-can-generate=\"" + (canGenerate ? "true" : "false") + "\" aria-label=\"" + ariaLabel + "\" title=\"" + escapeHtml(title) + "\">" + inner + remove + "</div></div>";
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
            if (!isWebdesignPhotoEligible(target)) {
                setStatusMessage("Geen geldige website gevonden voor " + target.bedrijf + ".", "error", true);
                return;
            }
            setStatusMessage("");
            const jobId = createJobId();
            setPendingJob({ customerId: target.id, jobId: jobId, startedAt: now() });
            try {
                const response = await fetch(JOB_ENDPOINT, {
                    method: "POST",
                    credentials: "same-origin",
                    cache: "no-store",
                    keepalive: true,
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
            render: render,
            resumePendingJobs: resumePendingJobs
        };
    }

    global.SoftoraDatabaseWebdesignAction = {
        createController: createController
    };
})(window);
