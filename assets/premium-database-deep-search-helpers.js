(function (global) {
    "use strict";

    function normalizeString(value) {
        return String(value == null ? "" : value).trim();
    }

    function normalizeKey(value) {
        return normalizeString(value)
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "");
    }

    function normalizeExistingWebsiteDomain(value) {
        const raw = normalizeString(value)
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "")
            .replace(/\/.*$/, "")
            .trim();
        return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(raw) ? raw : "";
    }

    function collectCustomerMatchKeys(customer) {
        const keys = [];
        const email = normalizeString(customer && customer.email).toLowerCase();
        const domain = normalizeExistingWebsiteDomain(customer && (customer.website || customer.dom || customer.url || customer.site));
        const company = normalizeKey(customer && (customer.bedrijf || customer.bedrijfsnaam || customer.company || customer.companyName || customer.naam));
        const address = normalizeKey(customer && (customer.stad || customer.adres || customer.address || customer.location));
        if (email && email !== "—") keys.push("email:" + email);
        if (domain && domain !== "onbekend.nl") keys.push("domain:" + domain);
        if (company && address && address !== "onbekend") keys.push("company-address:" + company + "|" + address);
        return keys;
    }

    function collectNewCustomersAfterImport(beforeCustomers, afterCustomers, limit) {
        const beforeKeys = new Set();
        (Array.isArray(beforeCustomers) ? beforeCustomers : []).forEach(function (customer) {
            collectCustomerMatchKeys(customer).forEach(function (key) { beforeKeys.add(key); });
        });
        const maxItems = Math.max(0, Number(limit) || 0);
        if (maxItems <= 0) return [];
        const result = [];
        (Array.isArray(afterCustomers) ? afterCustomers : []).forEach(function (customer) {
            if (result.length >= maxItems) return;
            const keys = collectCustomerMatchKeys(customer);
            if (!keys.length || keys.some(function (key) { return beforeKeys.has(key); })) return;
            result.push(customer);
        });
        return result;
    }

    const manualCompletedTargetLabels = Object.freeze(["Nederland | Noord-Brabant | Vught | Helvoirt", "Nederland | Noord-Brabant | Boxtel | Boxtel", "Nederland | Noord-Brabant | Boxtel | Esch", "Nederland | Noord-Brabant | Boxtel | Liempde", "Nederland | Noord-Brabant | Hilvarenbeek | Biest-Houtakker", "Nederland | Noord-Brabant | Hilvarenbeek | Diessen", "Nederland | Noord-Brabant | Hilvarenbeek | Esbeek", "Nederland | Noord-Brabant | Hilvarenbeek | Haghorst"]);

    function applyManualCompletedTargets(targets, labels) {
        const completedKeys = new Set((Array.isArray(labels) ? labels : manualCompletedTargetLabels).map(normalizeKey));
        if (!completedKeys.size) return targets || [];
        return (targets || []).map(function (target) {
            return target && completedKeys.has(normalizeKey(target.label)) ? { ...target, status: "done", placeComplete: true, completionReason: normalizeString(target.completionReason) || "Handmatig afgerond in de verzamellijst." } : target;
        });
    }

    global.SoftoraDatabaseDeepSearchHelpers = {
        applyManualCompletedTargets: applyManualCompletedTargets,
        collectCustomerMatchKeys: collectCustomerMatchKeys,
        collectNewCustomersAfterImport: collectNewCustomersAfterImport,
        manualCompletedTargetLabels: manualCompletedTargetLabels,
        normalizeExistingWebsiteDomain: normalizeExistingWebsiteDomain
    };
})(window);
