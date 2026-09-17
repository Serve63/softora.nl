(function (global, factory) {
    "use strict";

    const api = factory();
    if (global) global.SoftoraPremiumDatabaseSourceFilter = api;
    if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window === "object" ? window : null, function () {
    "use strict";

    const KVK_SOURCE_LABEL = "softora bedrijven scraper";
    const ROBOT_TRANSFER_DESTINATION = "available";

    function normalizeString(value) {
        return String(value == null ? "" : value).trim();
    }

    function normalizeCustomerSourceFields(raw) {
        const source = raw && typeof raw === "object" ? raw : {};
        return {
            bronDatabase: normalizeString(source.bronDatabase),
            kvkNummer: normalizeString(source.kvkNummer || source.kvk_nummer),
            premiumTransferRunId: normalizeString(source.premiumTransferRunId),
            premiumTransferDestination: normalizeString(source.premiumTransferDestination).toLowerCase()
        };
    }

    function isKvkTransferCustomer(customer) {
        if (!customer || typeof customer !== "object") return false;
        if (normalizeString(customer.bronDatabase).toLowerCase() === KVK_SOURCE_LABEL) return true;
        if (/^kvk-transfer-/i.test(normalizeString(customer.premiumTransferRunId))) return true;
        return (Array.isArray(customer.hist) ? customer.hist : []).some(function (entry) {
            return /^kvk-transfer:/i.test(normalizeString(entry && entry.messageKey));
        });
    }

    function isRobotTransferCustomer(customer) {
        return isKvkTransferCustomer(customer) &&
            normalizeString(customer && customer.premiumTransferDestination).toLowerCase() === ROBOT_TRANSFER_DESTINATION;
    }

    function isSearcherTransferCustomer(customer) {
        return isKvkTransferCustomer(customer) && !isRobotTransferCustomer(customer);
    }

    function getHeaderLabel(activeStatus) {
        return activeStatus === "benaderbaar" || activeStatus === "instantly-ready" ? "Mailklaar" : "Foto's";
    }

    function getContextualStatusPresentation(activeStatus, isCanonicalMailReady) {
        if (isCanonicalMailReady !== true) return null;
        if (activeStatus === "benaderbaar" || activeStatus === "instantly-ready") {
            return { className: "benaderbaar", label: "Mailklaar" };
        }
        return null;
    }

    return {
        normalizeCustomerSourceFields: normalizeCustomerSourceFields,
        isKvkTransferCustomer: isKvkTransferCustomer,
        isRobotTransferCustomer: isRobotTransferCustomer,
        isSearcherTransferCustomer: isSearcherTransferCustomer,
        getHeaderLabel: getHeaderLabel,
        getContextualStatusPresentation: getContextualStatusPresentation
    };
});
