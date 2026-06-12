(function () {
    const ROI_STATE_SCOPE = "premium_database_mail_roi";
    const ROI_STATE_KEY = "premium_database_mail_roi_v1";
    const COLDMAIL_STATS_URL = "/api/coldmailing/stats";
    const TODAY_SENT_REFRESH_MS = 15000;
    let roiControlsBound = false;
    let todaySentRefreshBound = false;
    let todaySentRefreshPromise = null;
    let lastTodaySentCount = null;
    let lastStatsMailCount = null;
    let lastRenderedMailCount = null;
    let roiDealsCount = 0;
    let roiStateLoadPromise = null;
    let roiDirtySinceLoad = false;

    function fallbackNormalizeString(value) {
        return value === null || value === undefined ? "" : String(value).trim();
    }

    function hasInstantlySignal(customer, helpers) {
        const options = helpers || {};
        return Boolean(options.outreachController && typeof options.outreachController.hasInstantlyOutreachSignal === "function" && options.outreachController.hasInstantlyOutreachSignal(customer));
    }

    function getColdmailSentAt(customer, helpers) {
        const options = helpers || {};
        if (options.databaseContactStatus && typeof options.databaseContactStatus.getColdmailSentAt === "function") {
            const helperValue = options.databaseContactStatus.getColdmailSentAt(customer, { normalizeString: options.normalizeString });
            if (helperValue) return helperValue;
        }
        const normalizeString = options.normalizeString || fallbackNormalizeString;
        return normalizeString(customer && (customer.outreachSentAt || customer.outreach_sent_at || customer.lastColdmailSentAt || customer.lastMailSentAt || customer.lastMailedAt || customer.coldmailCampaignStartedAt || customer.mailCampaignStartedAt || customer.sentAt));
    }

    function normalizeWebdesignValue(value, helpers) {
        const normalizeString = (helpers && helpers.normalizeString) || fallbackNormalizeString;
        return normalizeString(value)
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    function isWebdesignOutreachCustomer(customer, helpers) {
        const options = helpers || {};
        if (options.outreachController && typeof options.outreachController.isWebdesignOutreachCustomer === "function") {
            return options.outreachController.isWebdesignOutreachCustomer(customer);
        }
        return Boolean(customer) && [customer.campaignType, customer.campaign_type, customer.outreachCampaignType, customer.outreach_campaign_type, customer.coldmailSpecialAction, customer.specialAction].some(function (value) {
            const normalized = normalizeWebdesignValue(value, options);
            return normalized === "webdesign" || normalized === "website-design" || normalized === "website" || normalized.indexOf("webdesign") !== -1;
        });
    }

    function normalizeDomain(value, helpers) {
        const normalizeString = (helpers && helpers.normalizeString) || fallbackNormalizeString;
        const raw = normalizeString(value);
        if (!raw) return "";
        try {
            return normalizeString(new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw).hostname).replace(/^www\./i, "").toLowerCase();
        } catch (error) {
            return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/g, "").replace(/\/+$/g, "").toLowerCase();
        }
    }

    function buildWebdesignRecipientKey(customer, helpers) {
        const options = helpers || {};
        const normalizeString = options.normalizeString || fallbackNormalizeString;
        const email = normalizeString(customer && (customer.email || customer.contactEmail || customer.mail)).toLowerCase();
        if (email) return "email:" + email;
        const domain = normalizeDomain(customer && (customer.dom || customer.domain || customer.website || customer.websiteUrl || customer.website_url || customer.url || customer.site || customer.domein), options);
        if (domain) return "domain:" + domain;
        const id = normalizeWebdesignValue(customer && (customer.id || customer.customerId || customer.databaseId), options);
        if (id) return "id:" + id;
        const company = normalizeWebdesignValue(customer && (customer.bedrijf || customer.company || customer.companyName || customer.naam || customer.name), options);
        return company ? "company:" + company : "";
    }

    function getAmsterdamDateKey(value) {
        const parsed = new Date(String(value || ""));
        if (!Number.isFinite(parsed.getTime())) return "";
        try {
            const parts = new Intl.DateTimeFormat("en-CA", {
                timeZone: "Europe/Amsterdam",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }).formatToParts(parsed);
            const get = function (type) {
                const match = parts.find(function (part) { return part.type === type; });
                return match ? match.value : "";
            };
            return get("year") + "-" + get("month") + "-" + get("day");
        } catch (error) {
            return parsed.toISOString().slice(0, 10);
        }
    }

    function getWebdesignMailSentStats(customers, helpers) {
        const options = helpers || {};
        const nowValue = typeof options.now === "function" ? options.now() : (options.now || new Date());
        const todayKey = getAmsterdamDateKey(nowValue);
        const keys = new Set();
        const todayKeys = new Set();
        (customers || []).forEach(function (customer) {
            const isTestCompany = typeof options.isColdmailTestCompany === "function" && options.isColdmailTestCompany(customer);
            const sentAt = getColdmailSentAt(customer, options);
            if (!customer || isTestCompany || !sentAt || !isWebdesignOutreachCustomer(customer, options)) return;
            const key = buildWebdesignRecipientKey(customer, options) || "row:" + keys.size;
            keys.add(key);
            if (getAmsterdamDateKey(sentAt) === todayKey) todayKeys.add(key);
        });
        return {
            total: keys.size,
            today: todayKeys.size
        };
    }

    function isInstantlyHistoryEntry(entry, helpers) {
        const options = helpers || {};
        const normalizeString = options.normalizeString || fallbackNormalizeString;
        const provider = normalizeString(entry && (entry.provider || entry.lastColdmailProvider)).toLowerCase();
        const text = normalizeString([entry && entry.type, entry && entry.status, entry && entry.label, entry && entry.source, entry && entry.actor, entry && entry.subject, entry && entry.preview].join(" ")).toLowerCase();
        return provider === "instantly" || text.indexOf("instantly") !== -1;
    }

    function isSoftoraSystemMailHistoryEntry(entry, helpers) {
        const options = helpers || {};
        const normalizeString = options.normalizeString || fallbackNormalizeString;
        const text = normalizeString([entry && entry.type, entry && entry.status, entry && entry.label, entry && entry.message, entry && entry.title].join(" ")).toLowerCase();
        return !isInstantlyHistoryEntry(entry, options) && /\b(gemaild|mail verstuurd|email sent|coldmail verzonden)\b/.test(text);
    }

    function hasSoftoraSystemMailSignal(customer, helpers) {
        const options = helpers || {};
        const normalizeString = options.normalizeString || fallbackNormalizeString;
        const isTestCompany = typeof options.isColdmailTestCompany === "function" && options.isColdmailTestCompany(customer);
        if (!customer || isTestCompany || hasInstantlySignal(customer, options)) return false;
        const provider = normalizeString(customer.lastColdmailProvider).toLowerCase();
        if (provider === "instantly") return false;
        if (["softora", "gmail", "smtp", "strato"].indexOf(provider) !== -1) return true;
        if (normalizeString(customer.lastColdmailSenderEmail || customer.sentFromEmail || customer.sent_from_email || customer.outreachSentFromEmail)) return true;
        if (getColdmailSentAt(customer, options)) return true;
        return Boolean(normalizeString(customer.coldmailSentMessageId || customer.outreachMessageId || customer.sentMessageId || customer.messageId));
    }

    function getCustomerSoftoraSystemMailSentCount(customer, helpers) {
        const options = helpers || {};
        const isTestCompany = typeof options.isColdmailTestCompany === "function" && options.isColdmailTestCompany(customer);
        if (!customer || isTestCompany) return 0;
        const historyCount = (Array.isArray(customer.hist) ? customer.hist : []).filter(function (entry) {
            return isSoftoraSystemMailHistoryEntry(entry, options);
        }).length;
        if (historyCount) return historyCount;
        return hasSoftoraSystemMailSignal(customer, options) ? 1 : 0;
    }

    function getSoftoraSystemMailSentCount(customers, helpers) {
        return (customers || []).reduce(function (total, customer) {
            return total + getCustomerSoftoraSystemMailSentCount(customer, helpers || {});
        }, 0);
    }

    function getRootDocument() {
        return window.document || (typeof document === "undefined" ? null : document);
    }

    function getFetch() {
        if (typeof window.fetch === "function") return window.fetch.bind(window);
        if (typeof fetch === "function") return fetch;
        return null;
    }

    function getInterval() {
        if (typeof window.setInterval === "function") return window.setInterval.bind(window);
        if (typeof setInterval === "function") return setInterval;
        return null;
    }

    function addWindowListener(eventName, handler) {
        if (typeof window.addEventListener === "function") window.addEventListener(eventName, handler);
    }

    function parseRenderedMailCount(value) {
        const normalized = fallbackNormalizeString(value).replace(/\./g, "").replace(/,/g, "");
        const number = Number(normalized);
        return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
    }

    function rememberRenderedMailCount(element) {
        const renderedCount = parseRenderedMailCount(element && element.textContent);
        if (renderedCount === null) return lastRenderedMailCount;
        lastRenderedMailCount = Math.max(lastRenderedMailCount || 0, renderedCount);
        return lastRenderedMailCount;
    }

    function clampDealCount(value) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
    }

    function loadDealCount() {
        return roiDealsCount;
    }

    function getUiStateClient() {
        return window.SoftoraUiStateClient && typeof window.SoftoraUiStateClient.get === "function" && typeof window.SoftoraUiStateClient.set === "function"
            ? window.SoftoraUiStateClient
            : null;
    }

    function parseStoredDealCount(rawValue) {
        if (rawValue === null || rawValue === undefined || rawValue === "") return null;
        if (typeof rawValue === "number") return clampDealCount(rawValue);
        if (typeof rawValue === "object") return clampDealCount(rawValue.dealCount || rawValue.dealsCount || rawValue.count);
        try {
            return parseStoredDealCount(JSON.parse(String(rawValue)));
        } catch (error) {
            return clampDealCount(rawValue);
        }
    }

    function loadPersistedDealCount() {
        if (roiStateLoadPromise) return roiStateLoadPromise;
        const client = getUiStateClient();
        if (!client) {
            roiStateLoadPromise = Promise.resolve(roiDealsCount);
            return roiStateLoadPromise;
        }
        roiStateLoadPromise = client.get(ROI_STATE_SCOPE).then(function (state) {
            const values = state && state.values && typeof state.values === "object" ? state.values : {};
            const storedCount = parseStoredDealCount(values[ROI_STATE_KEY]);
            if (storedCount !== null && !roiDirtySinceLoad) {
                roiDealsCount = storedCount;
                renderRoiCalculator(lastRenderedMailCount, lastRenderedMailCount === null);
            }
            return roiDealsCount;
        }).catch(function (error) {
            if (typeof console !== "undefined" && typeof console.error === "function") console.error("Mail ROI laden mislukt:", error);
            return roiDealsCount;
        });
        return roiStateLoadPromise;
    }

    function persistDealCount() {
        const client = getUiStateClient();
        if (!client) return Promise.resolve(null);
        return client.set(ROI_STATE_SCOPE, {
            patch: {
                [ROI_STATE_KEY]: JSON.stringify({
                    dealCount: roiDealsCount,
                    updatedAt: new Date().toISOString()
                })
            },
            source: "premium-database-mail-roi",
            actor: "Premium database"
        }).catch(function (error) {
            if (typeof console !== "undefined" && typeof console.error === "function") console.error("Mail ROI opslaan mislukt:", error);
            return { ok: false, error: error };
        });
    }

    function saveDealCount(value, options) {
        roiDealsCount = clampDealCount(value);
        if (!options || options.persist !== false) {
            roiDirtySinceLoad = true;
            void persistDealCount();
        }
    }

    function readPositiveInteger(value) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
    }

    function readNonNegativeInteger(value) {
        if (value === null || value === undefined || value === "") return null;
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
    }

    function readMailCountFromStats(stats) {
        const fields = ["systemTotalSent", "totalSent", "webdesignTotalSent", "webdesignSentTotal", "webdesignDatabaseTotalSent", "databaseTotalSent"];
        for (let index = 0; index < fields.length; index += 1) {
            const count = readNonNegativeInteger(stats && stats[fields[index]]);
            if (count !== null) return count;
        }
        return null;
    }

    function readTodaySentCountFromStats(stats) {
        const fields = ["systemSentToday", "sentToday", "webdesignSentToday"];
        for (let index = 0; index < fields.length; index += 1) {
            const count = readNonNegativeInteger(stats && stats[fields[index]]);
            if (count !== null) return count;
        }
        return null;
    }

    function renderTodaySentCount(value, isLoading) {
        const rootDocument = getRootDocument();
        const element = rootDocument && rootDocument.getElementById("systemMailSentTodayCount");
        if (!element) return;
        if (isLoading && lastTodaySentCount === null) {
            element.textContent = "--";
            return;
        }
        const count = value === null || value === undefined ? lastTodaySentCount : readPositiveInteger(value);
        if (count === null || count === undefined) {
            element.textContent = "--";
            return;
        }
        lastTodaySentCount = count;
        element.textContent = count.toLocaleString("nl-NL");
    }

    function renderSystemMailCount(value, isLoading) {
        const rootDocument = getRootDocument();
        const element = rootDocument && rootDocument.getElementById("systemMailSentCount");
        if (!element) return;
        if (isLoading && lastRenderedMailCount === null) {
            element.textContent = "--";
            renderRoiCalculator(null, true);
            return;
        }
        const count = value === null || value === undefined ? lastRenderedMailCount : readNonNegativeInteger(value);
        if (count === null || count === undefined) {
            element.textContent = "--";
            renderRoiCalculator(null, true);
            return;
        }
        lastRenderedMailCount = count;
        element.textContent = count.toLocaleString("nl-NL");
        renderRoiCalculator(count, false);
    }

    function refreshTodaySentCount() {
        const fetchImpl = getFetch();
        if (!fetchImpl) {
            renderTodaySentCount(lastTodaySentCount, true);
            return Promise.resolve(lastTodaySentCount);
        }
        if (todaySentRefreshPromise) return todaySentRefreshPromise;
        todaySentRefreshPromise = fetchImpl(COLDMAIL_STATS_URL, {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            cache: "no-store"
        }).then(function (response) {
            return response.json().then(function (payload) {
                return { response: response, payload: payload };
            }).catch(function () {
                return { response: response, payload: null };
            });
        }).then(function (result) {
            const payload = result.payload;
            if (!result.response.ok || !payload || payload.ok === false) throw new Error(payload && (payload.message || payload.error) || "Coldmail statistieken laden mislukt.");
            const stats = payload.stats || {};
            const sentToday = readTodaySentCountFromStats(stats);
            const systemMailCount = readMailCountFromStats(stats);
            renderTodaySentCount(sentToday, false);
            if (systemMailCount !== null) {
                lastStatsMailCount = systemMailCount;
                renderSystemMailCount(systemMailCount, false);
            }
            return sentToday;
        }).catch(function (error) {
            renderTodaySentCount(lastTodaySentCount, lastTodaySentCount === null);
            if (typeof console !== "undefined" && typeof console.warn === "function") console.warn("Vandaag verstuurd laden mislukt:", error && error.message ? error.message : error);
            return lastTodaySentCount;
        }).finally(function () {
            todaySentRefreshPromise = null;
        });
        return todaySentRefreshPromise;
    }

    function bindTodaySentRefresh() {
        renderTodaySentCount(lastTodaySentCount, true);
        if (todaySentRefreshBound) return;
        todaySentRefreshBound = true;
        void refreshTodaySentCount();
        const interval = getInterval();
        if (interval) interval(refreshTodaySentCount, TODAY_SENT_REFRESH_MS);
        addWindowListener("focus", refreshTodaySentCount);
        addWindowListener("pageshow", refreshTodaySentCount);
        const rootDocument = getRootDocument();
        if (rootDocument && typeof rootDocument.addEventListener === "function") {
            rootDocument.addEventListener("visibilitychange", function () {
                if (!rootDocument.hidden) void refreshTodaySentCount();
            });
        }
    }

    function renderRoiCalculator(mailCount, isLoading) {
        const rootDocument = getRootDocument();
        if (!rootDocument) return;
        const dealsElement = rootDocument.getElementById("mailRoiDealsCount");
        const ratioElement = rootDocument.getElementById("mailRoiRatio");
        const deals = loadDealCount();
        if (dealsElement) dealsElement.textContent = deals.toLocaleString("nl-NL");
        if (!ratioElement) return;
        if (isLoading || !mailCount || deals <= 0) {
            ratioElement.textContent = "—";
            return;
        }
        ratioElement.textContent = "1 op " + Math.round(mailCount / deals).toLocaleString("nl-NL");
    }

    function bindRoiControls() {
        void loadPersistedDealCount();
        if (roiControlsBound) return;
        const rootDocument = getRootDocument();
        if (!rootDocument || typeof rootDocument.querySelectorAll !== "function") return;
        const buttons = rootDocument.querySelectorAll("[data-mail-roi-action]");
        if (!buttons.length) return;
        buttons.forEach(function (button) {
            button.addEventListener("click", function () {
                saveDealCount(loadDealCount() + Number(button.getAttribute("data-mail-roi-action") || 0));
                renderRoiCalculator(lastRenderedMailCount, lastRenderedMailCount === null);
            });
        });
        roiControlsBound = true;
    }

    function render(customers, helpers) {
        bindRoiControls();
        bindTodaySentRefresh();
        const rootDocument = getRootDocument();
        const element = rootDocument && rootDocument.getElementById("systemMailSentCount");
        if (!element) return;
        const options = helpers || {};
        if (options.dataLoading) {
            const rememberedCount = rememberRenderedMailCount(element);
            if (rememberedCount !== null) {
                element.textContent = rememberedCount.toLocaleString("nl-NL");
                renderRoiCalculator(rememberedCount, false);
                return;
            }
            element.textContent = "--";
            renderRoiCalculator(null, true);
            return;
        }
        const calculatedStats = getWebdesignMailSentStats(customers, options);
        if (lastTodaySentCount === null) renderTodaySentCount(calculatedStats.today, false);
        renderSystemMailCount(lastStatsMailCount === null ? calculatedStats.total : lastStatsMailCount, false);
    }

    window.SoftoraDatabaseSystemMailCount = {
        hasSoftoraSystemMailSignal: hasSoftoraSystemMailSignal,
        getCustomerSoftoraSystemMailSentCount: getCustomerSoftoraSystemMailSentCount,
        getSoftoraSystemMailSentCount: getSoftoraSystemMailSentCount,
        getWebdesignMailSentStats: getWebdesignMailSentStats,
        loadPersistedDealCount: loadPersistedDealCount,
        refreshTodaySentCount: refreshTodaySentCount,
        renderRoiCalculator: renderRoiCalculator,
        render: render
    };
})();
