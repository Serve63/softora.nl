(function () {
    function fallbackNormalizeString(value) {
        return value === null || value === undefined ? "" : String(value).trim();
    }

    function hasInstantlySignal(customer, helpers) {
        return Boolean(helpers.outreachController && typeof helpers.outreachController.hasInstantlyOutreachSignal === "function" && helpers.outreachController.hasInstantlyOutreachSignal(customer));
    }

    function getColdmailSentAt(customer, helpers) {
        return helpers.databaseContactStatus && typeof helpers.databaseContactStatus.getColdmailSentAt === "function"
            ? helpers.databaseContactStatus.getColdmailSentAt(customer, { normalizeString: helpers.normalizeString })
            : "";
    }

    function hasSoftoraSystemMailSignal(customer, helpers) {
        const normalizeString = helpers.normalizeString || fallbackNormalizeString;
        const isTestCompany = typeof helpers.isColdmailTestCompany === "function" && helpers.isColdmailTestCompany(customer);
        if (!customer || isTestCompany || hasInstantlySignal(customer, helpers)) return false;
        const provider = normalizeString(customer.lastColdmailProvider).toLowerCase();
        if (provider === "instantly") return false;
        if (["softora", "gmail", "smtp", "strato"].indexOf(provider) !== -1) return true;
        if (normalizeString(customer.lastColdmailSenderEmail || customer.sentFromEmail || customer.sent_from_email || customer.outreachSentFromEmail)) return true;
        if (getColdmailSentAt(customer, helpers)) return true;
        return Boolean(normalizeString(customer.coldmailSentMessageId || customer.outreachMessageId || customer.sentMessageId || customer.messageId));
    }

    function getSoftoraSystemMailSentCount(customers, helpers) {
        return (customers || []).filter(function (customer) {
            return hasSoftoraSystemMailSignal(customer, helpers || {});
        }).length;
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
        getSoftoraSystemMailSentCount: getSoftoraSystemMailSentCount,
        render: render
    };
})();
