(function (global) {
    "use strict";

    const VERIFY_ENDPOINT = "/api/premium-database/email-verification/verify";
    const STATUS_ENDPOINT = "/api/premium-database/email-verification/status";
    const DEFAULT_LIMIT = 100;
    const MAX_LIMIT = 500;
    const BUTTON_LABEL = "E-mails controleren";
    const STYLE_ID = "softora-email-verification-styles";
    const STYLE_TEXT = ".email-verification-cell{display:inline-flex;flex-direction:column;gap:4px;min-width:0;max-width:100%}.email-verification-address{overflow-wrap:anywhere}.email-verification-badge{width:fit-content;max-width:100%;border-radius:3px;padding:2px 6px;font-size:10px;font-weight:700;line-height:1.2;white-space:nowrap}.email-verification-badge.is-green{background:rgba(13,138,75,.12);color:var(--green)}.email-verification-badge.is-orange{background:rgba(180,90,0,.12);color:var(--orange)}.email-verification-badge.is-red{background:rgba(180,35,35,.12);color:var(--red)}";

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function normalizeStatus(value) {
        return normalizeString(value).toLowerCase().replace(/[\s-]+/g, "_");
    }

    function escapeHtml(value) {
        return normalizeString(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function showToast(message, duration) {
        const toast = global.document && global.document.getElementById("toast");
        if (!toast) return;
        toast.textContent = normalizeString(message);
        toast.classList.add("on");
        global.clearTimeout(showToast.timer);
        showToast.timer = global.setTimeout(function () {
            toast.classList.remove("on");
        }, duration || 4200);
    }

    function setBusy(button, busy, label) {
        if (!button) return;
        button.disabled = Boolean(busy);
        button.textContent = label || (busy ? "E-mails worden gecontroleerd..." : BUTTON_LABEL);
    }

    function getPayloadMessage(payload, fallback) {
        if (payload && typeof payload === "object") {
            return normalizeString(payload.message || payload.error) || fallback;
        }
        return fallback;
    }

    function promptLimit() {
        const raw = typeof global.prompt === "function"
            ? global.prompt("Hoeveel e-mailadressen controleren?", String(DEFAULT_LIMIT))
            : String(DEFAULT_LIMIT);
        if (raw === null) return null;
        const parsed = Math.floor(Number(String(raw).replace(",", ".")));
        if (!Number.isFinite(parsed) || parsed < 1) {
            showToast("Kies een geldig aantal e-mails.", 5600);
            return null;
        }
        return Math.min(MAX_LIMIT, parsed);
    }

    function getVerdict(customer) {
        return normalizeStatus(customer && customer.emailVerificationVerdict);
    }

    function getVerificationReason(customer) {
        return normalizeString(customer && customer.emailVerificationReason);
    }

    function getVerificationBadge(customer) {
        const verdict = getVerdict(customer);
        if (verdict === "green") return { className: "is-green", label: "Geverifieerd" };
        if (verdict === "orange") return { className: "is-orange", label: "Risico" };
        if (verdict === "red") return { className: "is-red", label: "Blokkeren" };
        return null;
    }

    function isOutboundAllowed(customer, options) {
        const requireGreen = Boolean(options && options.requireGreen);
        const verdict = getVerdict(customer);
        const status = normalizeStatus(customer && customer.emailVerificationStatus);
        if (verdict === "green") return true;
        if (verdict === "orange" || verdict === "red") return false;
        if (["invalid", "spamtrap", "abuse", "do_not_mail"].indexOf(status) !== -1) return false;
        return requireGreen ? false : true;
    }

    function renderEmailCell(email, customer) {
        const label = normalizeString(email) || "—";
        const badge = getVerificationBadge(customer);
        if (!badge) return escapeHtml(label);
        const title = getVerificationReason(customer) || badge.label;
        return [
            "<span class=\"email-verification-cell\">",
                "<span class=\"email-verification-address\">", escapeHtml(label), "</span>",
                "<span class=\"email-verification-badge ", badge.className, "\" title=\"", escapeHtml(title), "\">", escapeHtml(badge.label), "</span>",
            "</span>"
        ].join("");
    }

    async function fetchStatus() {
        const response = await fetch(STATUS_ENDPOINT, {
            method: "GET",
            credentials: "same-origin",
            headers: { Accept: "application/json" }
        });
        return response.json().catch(function () { return {}; });
    }

    async function verifyEmails(button) {
        const limit = promptLimit();
        if (!limit) return;
        if (typeof global.confirm === "function" && !global.confirm(limit + " e-mailadressen server-side controleren?")) return;
        setBusy(button, true);
        try {
            const status = await fetchStatus().catch(function () { return {}; });
            if (status && status.ok && status.configured === false) {
                const missing = Array.isArray(status.missing) ? status.missing.join(", ") : "ZEROBOUNCE_API_KEY";
                throw new Error("E-mailverificatie mist configuratie: " + missing + ".");
            }
            const response = await fetch(VERIFY_ENDPOINT, {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    limit: limit,
                    actor: "Premium Database e-mailverificatie"
                })
            });
            const payload = await response.json().catch(function () { return {}; });
            if (!response.ok || !payload.ok) {
                throw new Error(getPayloadMessage(payload, "E-mailverificatie mislukt."));
            }
            const summary = payload.summary || {};
            showToast(
                "✓ " + Number(payload.checked || 0).toLocaleString("nl-NL") +
                " gecontroleerd · groen " + Number(summary.green || 0).toLocaleString("nl-NL") +
                " · risico " + Number(summary.orange || 0).toLocaleString("nl-NL") +
                " · blokkeren " + Number(summary.red || 0).toLocaleString("nl-NL"),
                7000
            );
            setBusy(button, true, "Database wordt ververst...");
            global.setTimeout(function () {
                global.location.reload();
            }, 1100);
        } catch (error) {
            const message = error && error.message ? error.message : "E-mailverificatie mislukt.";
            showToast(message, 7000);
            if (typeof global.alert === "function") global.alert(message);
            setBusy(button, false);
        }
    }

    function bind() {
        const button = global.document && global.document.getElementById("emailVerificationButton");
        if (!button) return;
        injectStyles();
        button.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            const menu = button.closest(".add-actions");
            if (menu) menu.classList.remove("is-open");
            verifyEmails(button);
        });
    }

    function injectStyles() {
        if (!global.document || global.document.getElementById(STYLE_ID)) return;
        const style = global.document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = STYLE_TEXT;
        global.document.head.appendChild(style);
    }

    global.SoftoraDatabaseEmailVerification = {
        bind: bind,
        isOutboundAllowed: isOutboundAllowed,
        renderEmailCell: renderEmailCell
    };

    if (global.document) {
        if (global.document.readyState === "loading") {
            global.document.addEventListener("DOMContentLoaded", bind);
        } else {
            bind();
        }
    }
})(window);
