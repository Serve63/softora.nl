(function (global) {
    "use strict";

    const KVK_SOURCE_LABEL = "softora bedrijven scraper";

    function normalizeString(value) {
        return String(value == null ? "" : value).trim();
    }

    function normalizeCustomerSourceFields(raw) {
        const source = raw && typeof raw === "object" ? raw : {};
        return {
            bronDatabase: normalizeString(source.bronDatabase),
            kvkNummer: normalizeString(source.kvkNummer || source.kvk_nummer),
            premiumTransferRunId: normalizeString(source.premiumTransferRunId)
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

    function getHeaderLabel(activeStatus) {
        if (activeStatus === "gevonden") return "Succesvol gevonden";
        return activeStatus === "benaderbaar" ? "Mailklaar" : "Foto's";
    }

    global.SoftoraPremiumDatabaseSourceFilter = {
        normalizeCustomerSourceFields: normalizeCustomerSourceFields,
        isKvkTransferCustomer: isKvkTransferCustomer,
        getHeaderLabel: getHeaderLabel
    };
})(window);
