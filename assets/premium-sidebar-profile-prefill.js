/**
 * Synchroon direct na </aside> laden: zet actieve sidebar-state en profiel uit de opgeslagen sessie vóór deferred
 * personnel-theme.js, zodat de sidebar niet eerst op een oude alias/hash staat en daarna springt.
 * Moet dezelfde sleutel en velden gebruiken als personnel-theme.js (PREMIUM_SIDEBAR_SESSION_STORAGE_KEY).
 */
(function () {
    var STORAGE_KEY = "softora_premium_sidebar_session_v1";

    function isLeadsPagePath(path) {
        var p = String(path || "").toLowerCase();
        return p.indexOf("/premium-leads") === 0 || p.indexOf("/premium-ai-coldmailing") === 0;
    }

    function resolvePremiumSidebarActiveKey() {
        var p = String((window.location && window.location.pathname) || "").toLowerCase();
        var hashRaw = String((window.location && window.location.hash) || "").replace(/^#/, "").toLowerCase();
        if (p.indexOf("/premium-advertenties") === 0) {
            if (hashRaw === "google") return "ads_google";
            if (hashRaw === "facebook") return "ads_facebook";
            if (hashRaw === "pinterest") return "ads_pinterest";
            if (hashRaw === "linkedin") return "ads_linkedin";
            if (hashRaw === "twitter") return "ads_twitter";
            return "ads_trustoo";
        }
        if (p.indexOf("/premium-socialmedia") === 0) {
            if (hashRaw === "facebook") return "social_facebook";
            if (hashRaw === "linkedin") return "social_linkedin";
            if (hashRaw === "twitter") return "social_twitter";
            return "social_instagram";
        }
        if (
            p.indexOf("/premium-actieve-opdrachten") === 0 ||
            p.indexOf("/premium-opdracht-preview") === 0 ||
            p.indexOf("/premium-opdracht-dossier") === 0
        ) return "active_orders";
        if (p.indexOf("/premium-personeel-agenda") === 0) return "agenda";
        if (isLeadsPagePath(p)) return "leads";
        if (p.indexOf("/premium-ai-lead-generator") === 0) return "coldcalling";
        if (p.indexOf("/premium-bevestigingsmails") === 0) return "coldmailing";
        if (p.indexOf("/premium-klanten") === 0) return "customers";
        if (p.indexOf("/premium-database") === 0) return "database";
        if (p.indexOf("/premium-mailbox") === 0) return "mailbox";
        if (p.indexOf("/premium-websitegenerator") === 0 || p.indexOf("/premium-websitepreview") === 0) return "websitegenerator";
        if (p.indexOf("/premium-seo") === 0 || p.indexOf("/premium-seo-crm-system") === 0) return "seo";
        if (p.indexOf("/premium-pakketten") === 0) return "packages";
        if (p.indexOf("/premium-pdfs") === 0) return "pdfs";
        if (p.indexOf("/premium-vaste-lasten") === 0) return "monthly_costs";
        if (p.indexOf("/premium-boekhouding") === 0) return "bookkeeping";
        if (p.indexOf("/premium-kladblok") === 0) return "notepad";
        if (p.indexOf("/premium-word") === 0) return "word";
        if (p.indexOf("/premium-wachtwoordenregister") === 0) return "passwords";
        if (p.indexOf("/premium-instellingen") === 0) return "settings";
        return "dashboard";
    }

    function prefillPremiumSidebarActiveState() {
        var sidebar = document.querySelector(".sidebar[data-static-sidebar='1']");
        if (!sidebar) return;
        var activeKey = resolvePremiumSidebarActiveKey();
        Array.prototype.forEach.call(sidebar.querySelectorAll(".sidebar-link[data-sidebar-key]"), function (link) {
            var key = String(link.getAttribute("data-sidebar-key") || "").trim();
            link.classList.toggle("active", key === activeKey);
        });
        sidebar.setAttribute("data-sidebar-active-prefilled", "1");
    }

    function roleLabel(role) {
        return String(role || "").toLowerCase() === "admin" ? "Full Acces" : "Medewerker";
    }

    function initialsFromSession(session) {
        var displayName = String((session && (session.displayName || session.firstName || session.email)) || "").trim();
        if (!displayName) return "SP";
        var parts = displayName.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
        }
        var compact = displayName.replace(/[^a-z0-9]+/gi, "");
        return (compact.slice(0, 2) || "SP").toUpperCase();
    }

    function buildProfileRenderKey(session) {
        var displayName = String((session && session.displayName) || "Softora Premium").trim() || "Softora Premium";
        var role = String((session && session.role) || "admin").trim().toLowerCase() || "admin";
        var avatarDataUrl = String((session && session.avatarDataUrl) || "").trim();
        return [displayName, role, avatarDataUrl].join("\u0001");
    }

    try {
        prefillPremiumSidebarActiveState();

        var raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        var s = JSON.parse(raw);
        if (!s || typeof s !== "object" || !s.authenticated) return;

        var nameEl = document.querySelector("[data-sidebar-user-name]");
        var roleEl = document.querySelector("[data-sidebar-user-role]");
        var avatarEl = document.querySelector("[data-sidebar-avatar]");
        var profileWrapEl = document.querySelector(".sidebar-user .sidebar-user-trigger");
        var sidebarEl = document.querySelector(".sidebar");
        if (sidebarEl && String(sidebarEl.getAttribute("data-sidebar-profile-render-key") || "").trim()) return;
        var renderKey = buildProfileRenderKey(s);

        var displayName = String(s.displayName || "Softora Premium");
        if (nameEl) nameEl.textContent = displayName;
        if (roleEl) roleEl.textContent = roleLabel(s.role);
        if (profileWrapEl) {
            profileWrapEl.setAttribute("aria-label", "Ingelogd als " + displayName);
        }
        if (avatarEl) {
            var url = String(s.avatarDataUrl || "").trim();
            avatarEl.innerHTML = "";
            if (url) {
                var img = document.createElement("img");
                img.src = url;
                img.alt = String(s.displayName || "Profielfoto");
                img.loading = "eager";
                img.setAttribute("decoding", "async");
                avatarEl.appendChild(img);
            } else {
                avatarEl.textContent = initialsFromSession(s);
            }
        }
        if (sidebarEl) {
            sidebarEl.setAttribute("data-sidebar-profile-render-key", renderKey);
        }
    } catch (_) {
        /* ignore */
    }
})();
