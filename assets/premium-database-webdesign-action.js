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

    function formatCentCost(value) {
        return "-" + Math.round(Math.max(0, Number(value) || 0) * 100) + " cent";
    }

    function ensureStyles() {
        if (!global.document || global.document.getElementById(STYLE_ID)) return;
        const style = global.document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = ".photo-drop[data-has-photo=\"false\"]{overflow:visible}.photo-drop[data-has-photo=\"false\"][data-can-generate=\"true\"]{background:rgba(155,35,85,.08)}.photo-drop[data-has-photo=\"false\"][data-can-generate=\"false\"]{opacity:.55;cursor:not-allowed}.photo-drop.is-generating,.photo-drop.is-restoring{cursor:wait}.photo-generate-icon{width:18px;height:18px;color:var(--crimson);transition:transform .16s ease,color .16s ease}.photo-drop:hover .photo-generate-icon,.photo-drop:focus-visible .photo-generate-icon{color:var(--crimson-light);transform:scale(1.08)}.photo-generate-charge-label{position:fixed;right:18px;bottom:18px;z-index:12000;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:#c0392b;color:#fff;box-shadow:0 12px 28px rgba(192,57,43,.24);padding:8px 12px;font-family:Inter,sans-serif;font-size:13px;font-weight:800;letter-spacing:0;line-height:1;opacity:0;transform:translateY(8px) scale(.96);pointer-events:none;transition:opacity .14s ease,transform .14s ease,bottom .16s ease}.photo-generate-charge-label.is-visible{opacity:1;transform:translateY(0) scale(1)}.photo-generate-spinner{width:18px;height:18px;border:2px solid rgba(155,35,85,.18);border-top-color:var(--crimson);border-radius:999px;animation:photoGenerateSpin .8s linear infinite}@keyframes photoGenerateSpin{to{transform:rotate(360deg)}}";
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
        const isRestoringPhotos = typeof options.isRestoringPhotos === "function" ? options.isRestoringPhotos : function (customer) { return Boolean(state && state.photoRestorePending) && shouldShowWebsitePhoto(customer); };
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
            const firstLoad = loadRunningJobs();
            global.setTimeout(function () { void loadRunningJobs(); }, 2000);
            return firstLoad;
        }

        function preloadImage(src) {
            const value = normalizeString(src);
            if (!value || !isValidWebsitePhotoDataUrl(value) || typeof global.Image !== "function") {
                return Promise.resolve(false);
            }
            return new Promise(function (resolve) {
                let settled = false;
                const finish = function (loaded) {
                    if (settled) return;
                    settled = true;
                    resolve(Boolean(loaded));
                };
                const img = new global.Image();
                img.onload = function () { finish(true); };
                img.onerror = function () { finish(false); };
                img.src = value;
                if (typeof img.decode === "function") {
                    img.decode().then(function () { finish(true); }).catch(function () { finish(false); });
                }
                global.setTimeout(function () { finish(false); }, 2500);
            });
        }

        async function preloadPhotoImages(customers, limit, timeoutMs) {
            const photoSources = (Array.isArray(customers) ? customers : [])
                .map(function (customer) { return normalizeString(customer && customer.websitePhoto); })
                .filter(function (photo) { return isValidWebsitePhotoDataUrl(photo); })
                .slice(0, Math.max(0, Number(limit) || 24));
            if (!photoSources.length) return { ok: true, count: 0 };
            const preload = Promise.all(photoSources.map(preloadImage)).then(function (results) {
                return { ok: true, count: results.filter(Boolean).length };
            });
            const waitMs = Math.max(0, Number(timeoutMs) || 0);
            if (!waitMs) return preload;
            return Promise.race([
                preload,
                new Promise(function (resolve) {
                    global.setTimeout(function () {
                        resolve({ ok: false, count: 0, timeout: true });
                    }, waitMs);
                })
            ]);
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
            const inner = hasPhoto
                ? "<img src=\"" + escapeHtml(photo) + "\" loading=\"eager\" decoding=\"sync\" alt=\"" + escapeHtml(label) + "\">"
                : (isLoading ? LOADING_ICON : LIGHTNING_ICON);
            const remove = hasPhoto ? "<button class=\"photo-remove\" type=\"button\" data-remove-photo-id=\"" + escapeHtml(customer.id) + "\" aria-label=\"Websitefoto verwijderen\">&times;</button>" : "";
            const ariaLabel = hasPhoto ? "Websitefoto bekijken" : (isLoading ? (isPending ? "Webdesign wordt gemaakt" : "Websitefoto's worden hersteld") : (canGenerate ? "Webdesign maken" : "Geen geldige website gevonden"));
            const title = ariaLabel;
            return "<div class=\"photo-cell\"><div class=\"photo-drop" + (isLoading ? " is-generating" : "") + (isRestoring ? " is-restoring" : "") + "\" role=\"button\" tabindex=\"0\" data-photo-id=\"" + escapeHtml(customer.id) + "\" data-has-photo=\"" + (hasPhoto ? "true" : "false") + "\" data-can-generate=\"" + (canGenerate ? "true" : "false") + "\" aria-label=\"" + ariaLabel + "\" title=\"" + escapeHtml(title) + "\">" + inner + remove + "</div></div>";
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
            resumePendingJobs: resumePendingJobs,
            preloadPhotoImages: preloadPhotoImages
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
            style.textContent = ".outreach-line{margin-top:4px;color:var(--light);font-size:11px;line-height:1.35;white-space:normal}.outreach-badge{display:inline-flex;align-items:center;width:fit-content;margin-top:6px;padding:3px 8px;border-radius:999px;background:rgba(22,115,60,.1);color:var(--green);font-size:10px;font-weight:700;letter-spacing:.3px;text-transform:uppercase}.outreach-reply{display:flex;flex-direction:column;gap:3px;color:var(--mid);font-size:12px;line-height:1.35}.outreach-reply strong{color:var(--dark);font-size:12px}.outreach-days{display:inline-flex;align-items:center;justify-content:center;min-width:24px;color:var(--crimson);font-weight:800;line-height:1}.outreach-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.outreach-action{border:1px solid rgba(155,35,85,.18);border-radius:6px;background:rgba(255,255,255,.78);color:var(--crimson);cursor:pointer;font-family:Oswald,sans-serif;font-size:10px;font-weight:700;letter-spacing:.7px;line-height:1;padding:8px 9px;text-transform:uppercase;transition:background .15s ease,border-color .15s ease,color .15s ease}.outreach-action:hover{background:rgba(155,35,85,.08);border-color:rgba(155,35,85,.34)}.outreach-action[data-outreach-status=\"klant_geworden\"]{background:var(--crimson);border-color:var(--crimson);color:#fff}";
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
                statusUpdatedAt: normalizeString(raw && raw.statusUpdatedAt)
            };
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
            return normalizeString(customer && (customer.outreachSentAt || customer.outreach_sent_at || customer.lastColdmailSentAt || customer.lastMailSentAt));
        }

        function getReplyAt(customer) {
            return normalizeString(customer && (customer.lastReplyAt || customer.last_reply_at || customer.lastColdmailReplyAt));
        }

        function augmentSearchHaystack(customer) {
            return [getSentFromEmail(customer), getStatusLabel(getEffectiveStatus(customer)), isActionRequired(customer) ? "reactie ontvangen actie nodig" : ""].join(" ").toLowerCase();
        }

        function renderMeta(customer) {
            if (!isWebdesignOutreachCustomer(customer)) return "";
            const sentAt = getSentAt(customer);
            return "<div class=\"outreach-line\">Verstuurd vanaf " + escapeHtml(getSentFromEmail(customer) || "onbekend mailadres") + (sentAt ? " · " + escapeHtml(formatDisplayDate(sentAt)) : "") + "</div>" + (isActionRequired(customer) ? "<span class=\"outreach-badge\">Reactie ontvangen</span>" : "");
        }

        function renderReplyInfo(customer) {
            if (!isWebdesignOutreachCustomer(customer)) return "";
            const replyAt = getReplyAt(customer);
            return replyAt ? "<div class=\"outreach-reply\"><strong>Reactie ontvangen</strong><span>" + escapeHtml(formatDisplayDate(replyAt)) + "</span></div>" : "<div class=\"outreach-reply\"><strong>Nog geen reactie</strong><span>Blijft in Benaderd</span></div>";
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
            if (!isWebdesignOutreachCustomer(customer)) return "";
            const days = getDaysSinceSent(customer);
            if (days === null) return "";
            const label = days === 1 ? "1 dag geleden" : days + " dagen geleden";
            return "<span class=\"outreach-days\" title=\"" + escapeHtml(label) + "\">" + escapeHtml(String(days)) + "</span>";
        }

        function renderActions(customer) {
            if (!isWebdesignOutreachCustomer(customer)) return "";
            const id = escapeHtml(customer.id);
            return "<div class=\"outreach-actions\"><button class=\"outreach-action\" type=\"button\" data-outreach-status=\"klant_geworden\" data-outreach-id=\"" + id + "\">Is klant geworden</button><button class=\"outreach-action\" type=\"button\" data-outreach-status=\"mail\" data-outreach-id=\"" + id + "\">Mail bekijken</button></div>";
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
        return { applyAutomation: applyAutomation, augmentSearchHaystack: augmentSearchHaystack, getEffectiveStatus: getEffectiveStatus, getSentAt: getSentAt, getSentFromEmail: getSentFromEmail, getStatusLabel: getStatusLabel, isActionRequired: isActionRequired, isWebdesignOutreachCustomer: isWebdesignOutreachCustomer, normalizeCustomerFields: normalizeCustomerFields, renderActions: renderActions, renderDaysSinceSent: renderDaysSinceSent, renderMeta: renderMeta, renderReplyInfo: renderReplyInfo, updateStatus: updateStatus };
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
