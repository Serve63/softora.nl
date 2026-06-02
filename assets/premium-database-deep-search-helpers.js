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

    function normalizeEstimatedLocalBusinessCount(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) return 0;
        return Math.min(100000, Math.round(parsed));
    }

    function normalizeEstimateSources(value, maxItems) {
        const seen = new Set();
        const result = [];
        (Array.isArray(value) ? value : []).forEach(function (source) {
            const normalized = normalizeString(source).slice(0, 220);
            const key = normalizeKey(normalized);
            if (!normalized || !key || seen.has(key)) return;
            seen.add(key);
            result.push(normalized);
        });
        return result.slice(0, maxItems || 20);
    }

    function mergeTargetEstimate(target, body) {
        target.estimatedLocalBusinessCount = Math.max(
            normalizeEstimatedLocalBusinessCount(target && target.estimatedLocalBusinessCount),
            normalizeEstimatedLocalBusinessCount(body && body.estimatedLocalBusinessCount)
        );
        target.estimateSources = normalizeEstimateSources((target.estimateSources || []).concat(body && body.estimateSources || []), 20);
        target.coverageStrategy = normalizeString(body && body.coverageStrategy) || target.coverageStrategy;
    }

    function buildBatchCoverageResult(body) {
        return {
            estimatedLocalBusinessCount: normalizeEstimatedLocalBusinessCount(body && body.estimatedLocalBusinessCount),
            estimateSources: normalizeEstimateSources(body && body.estimateSources, 20),
            coverageStrategy: normalizeString(body && body.coverageStrategy)
        };
    }

    function getKnownBusinessCoverage(target) {
        return Math.max(
            Math.max(0, Number(target && target.found) || 0),
            Math.max(0, Number(target && target.added) || 0),
            Array.isArray(target && target.foundWebsites) ? target.foundWebsites.length : 0
        );
    }

    function getCompletionCoverageThreshold(estimatedCount) {
        const estimate = normalizeEstimatedLocalBusinessCount(estimatedCount);
        if (estimate <= 0) return Infinity;
        return Math.min(estimate, Math.max(5, Math.ceil(estimate * 0.55)));
    }

    function hasEnoughCompletionCoverage(target, result) {
        const estimate = Math.max(
            normalizeEstimatedLocalBusinessCount(target && target.estimatedLocalBusinessCount),
            normalizeEstimatedLocalBusinessCount(result && result.estimatedLocalBusinessCount)
        );
        return getKnownBusinessCoverage(target) >= getCompletionCoverageThreshold(estimate);
    }

    function isTargetCompletionConfirmed(target, result, requiredEmptyCompletionRounds) {
        const hasNewInformation = result.found > 0 || result.addedCount > 0;
        const emptyCompletion = result.completed && !hasNewInformation;
        target.completionChecks = emptyCompletion ? Math.max(0, Number(target.completionChecks) || 0) + 1 : 0;
        target.placeComplete = emptyCompletion
            && target.completionChecks >= Math.max(1, Number(requiredEmptyCompletionRounds) || 1)
            && hasEnoughCompletionCoverage(target, result);
        return target.placeComplete;
    }

    function describeCompletionCoverageGap(target, result) {
        const estimate = Math.max(
            normalizeEstimatedLocalBusinessCount(target && target.estimatedLocalBusinessCount),
            normalizeEstimatedLocalBusinessCount(result && result.estimatedLocalBusinessCount)
        );
        const known = getKnownBusinessCoverage(target);
        const threshold = getCompletionCoverageThreshold(estimate);
        if (!Number.isFinite(threshold)) {
            return "Er is nog geen betrouwbare indicatie van hoeveel bedrijven daar gevestigd zijn.";
        }
        return "Dekking is nog te laag: " + known + " gevonden tegenover circa " + estimate + " verwachte bedrijven.";
    }

    function safeParseJson(raw) {
        try {
            const parsed = JSON.parse(String(raw || "{}"));
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    function uniqueStrings(values, maxItems) {
        const seen = new Set();
        const result = [];
        (values || []).forEach(function (value) {
            const normalized = normalizeString(value);
            const key = normalizeKey(normalized);
            if (!normalized || !key || seen.has(key)) return;
            seen.add(key);
            result.push(normalized.slice(0, 180));
        });
        return result.slice(0, maxItems || 180);
    }

    function normalizeWebsiteHref(value) {
        const raw = normalizeString(value);
        if (!raw) return "";
        return /^https?:\/\//i.test(raw) ? raw : "https://" + raw.replace(/^\/+/, "");
    }

    function normalizeWebsiteDisplayValue(value) {
        const raw = normalizeString(value);
        if (!raw) return "";
        return raw.replace(/^https?:\/\/www\./i, "https://").replace(/\/$/, "");
    }

    function uniqueWebsiteValues(values, maxItems) {
        const seen = new Set();
        const result = [];
        (values || []).forEach(function (value) {
            const normalized = normalizeWebsiteDisplayValue(value && value.url || value);
            const key = normalizeKey(normalized.replace(/^https?:\/\//i, ""));
            if (!normalized || !key || seen.has(key)) return;
            seen.add(key);
            result.push(normalized.slice(0, 180));
        });
        return result.slice(0, maxItems || 200);
    }

    function collectWebsitesFromCustomers(customers) {
        return (Array.isArray(customers) ? customers : []).map(function (customer) {
            return customer && (customer.website || customer.dom || customer.url || customer.site);
        });
    }

    global.SoftoraDatabaseDeepSearchHelpers = {
        buildBatchCoverageResult: buildBatchCoverageResult,
        collectCustomerMatchKeys: collectCustomerMatchKeys,
        collectNewCustomersAfterImport: collectNewCustomersAfterImport,
        collectWebsitesFromCustomers: collectWebsitesFromCustomers,
        describeCompletionCoverageGap: describeCompletionCoverageGap,
        hasEnoughCompletionCoverage: hasEnoughCompletionCoverage,
        isTargetCompletionConfirmed: isTargetCompletionConfirmed,
        mergeTargetEstimate: mergeTargetEstimate,
        normalizeEstimatedLocalBusinessCount: normalizeEstimatedLocalBusinessCount,
        normalizeExistingWebsiteDomain: normalizeExistingWebsiteDomain,
        normalizeWebsiteHref: normalizeWebsiteHref,
        safeParseJson: safeParseJson,
        uniqueStrings: uniqueStrings,
        uniqueWebsiteValues: uniqueWebsiteValues
    };
})(window);
