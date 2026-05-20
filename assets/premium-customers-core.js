(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.SoftoraPremiumCustomersCore = api;
    }
})(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    const CUSTOMER_SERVICE_OPTIONS = Object.freeze(["website", "bedrijfssoftware", "voicesoftware", "chatbot"]);
    const CUSTOMER_DATABASE_STATUSES = Object.freeze([
        "nieuw",
        "prospect",
        "benaderbaar",
        "gebeld",
        "geengehoor",
        "gemaild",
        "interesse",
        "afspraak",
        "klant",
        "afgehaakt",
        "geblokkeerd",
        "buiten",
    ]);

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function normalizeSearchValue(value) {
        return normalizeString(value).toLowerCase();
    }

    function normalizeDate(value) {
        const raw = normalizeString(value);
        return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
    }

    function normalizeActiveValue(value) {
        return normalizeString(value).toLowerCase() === "nee" ? "Nee" : "Ja";
    }

    function parseResponsibleValue(value) {
        const normalized = normalizeString(value)
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
        if (normalized.includes("martijn")) return "Martijn";
        if (normalized.includes("serve")) return "Serve";
        if (
            normalized.includes("team")
            || normalized.includes("softora")
            || normalized.includes("algemeen")
            || normalized.includes("beide")
            || normalized.includes("allebei")
        ) return "Team";
        return "";
    }

    function normalizeResponsibleValue(value) {
        return parseResponsibleValue(value) || "Team";
    }

    function formatResponsibleDisplayName(value) {
        const normalized = parseResponsibleValue(value);
        if (normalized === "Martijn") return "Martijn";
        if (normalized === "Serve") return "Serv\u00e9";
        return "Team";
    }

    function getResponsibleSourceValue(raw) {
        if (!raw || typeof raw !== "object") return "";
        return normalizeString(
            raw.verantwoordelijk
                || raw.responsible
                || raw.claimedBy
                || raw.leadOwnerName
                || raw.leadOwnerFullName
                || raw.assignedToName
                || raw.assignedToFullName
                || ""
        );
    }

    function normalizeOptionalAmount(value) {
        if (value === null || value === undefined || value === "") return null;
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount < 0) return null;
        return Math.round(amount);
    }

    function normalizeCustomerService(raw) {
        const rawSvc = normalizeString(raw && raw.service).toLowerCase();
        if (CUSTOMER_SERVICE_OPTIONS.includes(rawSvc)) return rawSvc;
        return "website";
    }

    function formatCustomerServiceLabel(service) {
        const key = normalizeString(service).toLowerCase();
        if (key === "website") return "Website";
        if (key === "bedrijfssoftware") return "Bedrijfssoftware";
        if (key === "voicesoftware") return "Voicesoftware";
        if (key === "chatbot") return "Chatbot";
        return key.charAt(0).toUpperCase() + key.slice(1);
    }

    function normalizeCustomerReview(raw) {
        return normalizeString(raw && raw.review).toLowerCase() === "ja" ? "Ja" : "Nee";
    }

    function normalizeCustomerDatabaseStatus(raw) {
        const value = normalizeString(raw && raw.databaseStatus).toLowerCase();
        const status = normalizeString(raw && raw.status).toLowerCase();
        if (CUSTOMER_DATABASE_STATUSES.includes(value)) return value;
        if (CUSTOMER_DATABASE_STATUSES.includes(status)) return status;
        if (status === "betaald" || status === "open") return "klant";
        return "klant";
    }

    function isCustomerLifecycleRecord(raw) {
        return normalizeCustomerDatabaseStatus(raw) === "klant";
    }

    return Object.freeze({
        CUSTOMER_SERVICE_OPTIONS,
        normalizeString,
        normalizeSearchValue,
        normalizeDate,
        normalizeActiveValue,
        parseResponsibleValue,
        normalizeResponsibleValue,
        formatResponsibleDisplayName,
        getResponsibleSourceValue,
        normalizeOptionalAmount,
        normalizeCustomerService,
        formatCustomerServiceLabel,
        normalizeCustomerReview,
        normalizeCustomerDatabaseStatus,
        isCustomerLifecycleRecord,
    });
});
