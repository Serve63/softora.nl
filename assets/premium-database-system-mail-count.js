(function () {
    let roiControlsBound = false;
    let lastRenderedMailCount = null;
    let roiDealsCount = 0;

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

    function clampDealCount(value) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
    }

    function loadDealCount() {
        return roiDealsCount;
    }

    function saveDealCount(value) {
        roiDealsCount = clampDealCount(value);
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
            lastRenderedMailCount = null;
            element.textContent = "--";
            renderRoiCalculator(null, true);
            return;
        }
        lastRenderedMailCount = getSoftoraSystemMailSentCount(customers, options);
        element.textContent = lastRenderedMailCount.toLocaleString("nl-NL");
        renderRoiCalculator(lastRenderedMailCount, false);
    }

    window.SoftoraDatabaseSystemMailCount = {
        hasSoftoraSystemMailSignal: hasSoftoraSystemMailSignal,
        getCustomerSoftoraSystemMailSentCount: getCustomerSoftoraSystemMailSentCount,
        getSoftoraSystemMailSentCount: getSoftoraSystemMailSentCount,
        renderRoiCalculator: renderRoiCalculator,
        render: render
    };
})();
