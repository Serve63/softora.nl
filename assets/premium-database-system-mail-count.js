(function () {
    const ROI_STATE_SCOPE = "premium_database_mail_roi";
    const ROI_STATE_KEY = "premium_database_mail_roi_v1";
    let roiControlsBound = false;
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
        return options.databaseContactStatus && typeof options.databaseContactStatus.getColdmailSentAt === "function"
            ? options.databaseContactStatus.getColdmailSentAt(customer, { normalizeString: options.normalizeString })
            : "";
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
        const calculatedCount = getSoftoraSystemMailSentCount(customers, options);
        const rememberedCount = rememberRenderedMailCount(element);
        lastRenderedMailCount = Math.max(rememberedCount || 0, calculatedCount);
        element.textContent = lastRenderedMailCount.toLocaleString("nl-NL");
        renderRoiCalculator(lastRenderedMailCount, false);
    }

    window.SoftoraDatabaseSystemMailCount = {
        hasSoftoraSystemMailSignal: hasSoftoraSystemMailSignal,
        getCustomerSoftoraSystemMailSentCount: getCustomerSoftoraSystemMailSentCount,
        getSoftoraSystemMailSentCount: getSoftoraSystemMailSentCount,
        loadPersistedDealCount: loadPersistedDealCount,
        renderRoiCalculator: renderRoiCalculator,
        render: render
    };
})();
