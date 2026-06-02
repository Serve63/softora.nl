(function (global) {
    "use strict";

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function normalizeEmailAddress(value) {
        const raw = normalizeString(value).toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, "");
        const match = raw.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\.?/i);
        return (match ? match[0] : raw)
            .replace(/[<>()"[\]]/g, "")
            .replace(/[.,;:!?]+$/g, "")
            .trim();
    }

    function normalizeGuardKeyPart(value) {
        return normalizeString(value)
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    function normalizeWebsiteDomain(value) {
        const raw = normalizeString(value);
        if (!raw) return "";
        const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw;
        try {
            const parsed = new URL(candidate);
            return normalizeString(parsed.hostname).replace(/^www\./i, "");
        } catch (error) {
            return raw
                .replace(/^https?:\/\//i, "")
                .replace(/^www\./i, "")
                .replace(/\/.*$/g, "")
                .replace(/\/+$/g, "");
        }
    }

    function getEmailDomain(email) {
        const normalized = normalizeEmailAddress(email);
        const parts = normalized.split("@");
        return parts.length === 2 ? parts[1] : "";
    }

    function parseGuardPayload(raw) {
        try {
            const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {});
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    function normalizeGuardEntry(entry) {
        if (!entry || typeof entry !== "object") return null;
        const recipientEmail = normalizeEmailAddress(entry.recipientEmail);
        const recipientDomain = normalizeGuardKeyPart(entry.recipientDomain);
        const recipientId = normalizeGuardKeyPart(entry.recipientId);
        const recipientKey = normalizeString(entry.recipientKey);
        if (!recipientKey && !recipientEmail && !recipientDomain && !recipientId) return null;
        return {
            recipientKey: recipientKey,
            recipientEmail: recipientEmail,
            recipientDomain: recipientDomain,
            recipientId: recipientId
        };
    }

    function readGuardEntries(values, key) {
        const stateValues = values && typeof values === "object" ? values : {};
        const parsed = parseGuardPayload(stateValues[normalizeString(key)]);
        const rawEntries = []
            .concat(Array.isArray(parsed.recipientEntries) ? parsed.recipientEntries : [])
            .concat(Array.isArray(parsed.entries) ? parsed.entries : []);
        const seen = new Set();
        return rawEntries.map(normalizeGuardEntry).filter(function (entry) {
            if (!entry) return false;
            const identity = [
                entry.recipientKey,
                entry.recipientEmail,
                entry.recipientDomain,
                entry.recipientId
            ].join("|");
            if (seen.has(identity)) return false;
            seen.add(identity);
            return true;
        });
    }

    function buildCustomerRecipientGuard(customer) {
        const row = customer && typeof customer === "object" ? customer : {};
        const email = normalizeEmailAddress(row.email || row.contactEmail || "");
        const id = normalizeGuardKeyPart(row.id || row.customerId || row.databaseId || "");
        const websiteDomain = normalizeWebsiteDomain(
            row.dom || row.domain || row.website || row.websiteUrl || row.website_url || row.url || row.site || row.domein || ""
        );
        const domainCandidates = Array.from(new Set([
            normalizeGuardKeyPart(websiteDomain),
            normalizeGuardKeyPart(getEmailDomain(email))
        ].filter(Boolean)));
        const recipientKey = email
            ? "email:" + email
            : (domainCandidates[0] ? "domain:" + domainCandidates[0] : (id ? "id:" + id : ""));
        return {
            recipientKey: recipientKey,
            recipientEmail: email,
            recipientDomains: domainCandidates,
            recipientId: id
        };
    }

    function entryMatchesCustomer(entry, guard) {
        if (!entry || !guard) return false;
        if (guard.recipientKey && entry.recipientKey === guard.recipientKey) return true;
        if (guard.recipientEmail && entry.recipientEmail === guard.recipientEmail) return true;
        if (entry.recipientDomain && guard.recipientDomains.indexOf(entry.recipientDomain) !== -1) return true;
        if (guard.recipientId && entry.recipientId === guard.recipientId) return true;
        return false;
    }

    function createController(options) {
        const getUiState = options && options.getUiState;
        const scope = normalizeString(options && options.scope);
        const key = normalizeString(options && options.key);
        let entries = [];

        async function load() {
            if (typeof getUiState !== "function" || !scope || !key) {
                entries = [];
                return entries;
            }
            const state = await getUiState(scope);
            entries = readGuardEntries(state && state.values, key);
            return entries;
        }

        function hasGuard(customer) {
            const guard = buildCustomerRecipientGuard(customer);
            return entries.some(function (entry) {
                return entryMatchesCustomer(entry, guard);
            });
        }

        return {
            load: load,
            hasGuard: hasGuard,
            getEntries: function () { return entries.slice(); },
            buildCustomerRecipientGuard: buildCustomerRecipientGuard
        };
    }

    global.SoftoraDatabaseColdmailGuard = {
        buildCustomerRecipientGuard: buildCustomerRecipientGuard,
        createController: createController,
        readGuardEntries: readGuardEntries
    };
})(window);
