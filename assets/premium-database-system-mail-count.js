(function () {
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

    function render(customers, helpers) {
        const rootDocument = window.document || (typeof document === "undefined" ? null : document);
        const element = rootDocument && rootDocument.getElementById("systemMailSentCount");
        if (!element) return;
        const options = helpers || {};
        if (options.dataLoading && !(customers || []).length) {
            element.textContent = "--";
            return;
        }
        element.textContent = getSoftoraSystemMailSentCount(customers, options).toLocaleString("nl-NL");
    }

    window.SoftoraDatabaseSystemMailCount = {
        hasSoftoraSystemMailSignal: hasSoftoraSystemMailSignal,
        getCustomerSoftoraSystemMailSentCount: getCustomerSoftoraSystemMailSentCount,
        getSoftoraSystemMailSentCount: getSoftoraSystemMailSentCount,
        render: render
    };
})();
