/**
 * Synchroon direct na </aside> laden: zet actieve sidebar-state en profiel uit de opgeslagen sessie vóór deferred
 * personnel-theme.js, zodat de sidebar niet eerst op een oude alias/hash staat en daarna springt.
 * Moet dezelfde sleutel en velden gebruiken als personnel-theme.js (PREMIUM_SIDEBAR_SESSION_STORAGE_KEY).
 */
(function () {
    var STORAGE_KEY = "softora_premium_sidebar_session_v1";
    var NAV_STATE_KEY = "softora_premium_sidebar_nav_state_v1";
    var NAV_STATE_TTL_MS = 1000 * 30;
    var persistedSessionSnapshot = null;

    function readCookieValue(name) {
        var needle = String(name || "").trim() + "=";
        if (!needle) return "";
        var parts = String(document.cookie || "").split(";");
        for (var i = 0; i < parts.length; i += 1) {
            var part = String(parts[i] || "").trim();
            if (part.indexOf(needle) === 0) {
                return decodeURIComponent(part.slice(needle.length));
            }
        }
        return "";
    }

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

    function prefillPremiumSidebarScrollState() {
        var sidebar = document.querySelector(".sidebar[data-static-sidebar='1']");
        if (!sidebar) return;
        var nav = sidebar.querySelector(".sidebar-nav");
        if (!nav) return;
        try {
            var raw = readCookieValue(NAV_STATE_KEY);
            if (!raw) return;
            var state = JSON.parse(raw);
            var savedAt = Number(state && state.savedAt);
            var scrollTop = Number(state && state.scrollTop);
            if (!Number.isFinite(savedAt) || Date.now() - savedAt > NAV_STATE_TTL_MS) return;
            if (!Number.isFinite(scrollTop) || scrollTop < 0) return;
            nav.scrollTop = Math.max(0, scrollTop);
            sidebar.setAttribute("data-sidebar-scroll-prefilled", "1");
        } catch (_) {
            /* ignore */
        }
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

    function countDisplayNameWords(value) {
        return String(value || "").trim().split(/\s+/).filter(Boolean).length;
    }

    function buildDisplayNameFromParts(firstName, lastName, fallbackValue) {
        return [firstName, lastName]
            .map(function (part) { return String(part || "").trim(); })
            .filter(Boolean)
            .join(" ")
            || String(fallbackValue || "").trim();
    }

    function chooseRicherDisplayName(primaryValue, fallbackValue) {
        var primary = String(primaryValue || "").trim();
        var fallback = String(fallbackValue || "").trim();
        if (!primary) return fallback;
        if (!fallback) return primary;
        var primaryWords = countDisplayNameWords(primary);
        var fallbackWords = countDisplayNameWords(fallback);
        if (fallbackWords > primaryWords) return fallback;
        if (fallbackWords === primaryWords && fallback.length > primary.length) return fallback;
        return primary;
    }

    function normalizeSessionCandidate(sessionLike) {
        if (!sessionLike || typeof sessionLike !== "object" || !sessionLike.authenticated) return null;
        return {
            authenticated: true,
            email: String(sessionLike.email || "").trim().toLowerCase(),
            userId: String(sessionLike.userId || "").trim(),
            displayName: String(sessionLike.displayName || "").trim(),
            firstName: String(sessionLike.firstName || "").trim(),
            lastName: String(sessionLike.lastName || "").trim(),
            avatarDataUrl: String(sessionLike.avatarDataUrl || "").trim(),
            role: String(sessionLike.role || "").trim(),
        };
    }

    function mergeSessions(primarySession, fallbackSession) {
        var primary = normalizeSessionCandidate(primarySession);
        var fallback = normalizeSessionCandidate(fallbackSession);
        if (!primary) return fallback;
        if (!fallback) return primary;
        var sameUser =
            (primary.userId && fallback.userId && primary.userId === fallback.userId) ||
            (primary.email && fallback.email && primary.email === fallback.email);
        if (!sameUser) return primary;
        return {
            ...fallbackSession,
            ...primarySession,
            displayName: chooseRicherDisplayName(primary.displayName, fallback.displayName),
            firstName: primary.firstName || fallback.firstName || "",
            lastName: primary.lastName || fallback.lastName || "",
            avatarDataUrl: primary.avatarDataUrl || fallback.avatarDataUrl || "",
        };
    }

    function shouldEnrichSession(sessionLike) {
        var normalized = normalizeSessionCandidate(sessionLike);
        if (!normalized) return false;
        if (!normalized.avatarDataUrl) return true;
        return countDisplayNameWords(normalized.displayName) < 2;
    }

    async function enrichSession(sessionLike, fetchJsonNoStore) {
        var merged = mergeSessions(sessionLike, persistedSessionSnapshot);
        if (!shouldEnrichSession(merged) || typeof fetchJsonNoStore !== "function") {
            return merged;
        }
        var profilePayload = await fetchJsonNoStore("/api/auth/profile");
        var profileUser = profilePayload && profilePayload.ok && profilePayload.user && typeof profilePayload.user === "object"
            ? profilePayload.user
            : null;
        var profileSession = profilePayload && profilePayload.ok && profilePayload.session && typeof profilePayload.session === "object"
            ? profilePayload.session
            : null;
        if (!profileUser && !profileSession) return merged;
        var firstName = String(
            (profileSession && (profileSession.firstName || profileSession.voornaam)) ||
            (profileUser && (profileUser.firstName || profileUser.voornaam)) ||
            (merged && merged.firstName) ||
            ""
        ).trim();
        var lastName = String(
            (profileSession && (profileSession.lastName || profileSession.achternaam)) ||
            (profileUser && (profileUser.lastName || profileUser.achternaam)) ||
            (merged && merged.lastName) ||
            ""
        ).trim();
        var displayName = String(
            (profileSession && profileSession.displayName) ||
            (profileUser && profileUser.displayName) ||
            buildDisplayNameFromParts(firstName, lastName, "") ||
            (merged && merged.displayName) ||
            ""
        ).trim();
        return mergeSessions({
            ...merged,
            displayName: displayName,
            firstName: firstName,
            lastName: lastName,
            avatarDataUrl: String(
                (profileSession && profileSession.avatarDataUrl) ||
                (profileUser && profileUser.avatarDataUrl) ||
                (merged && merged.avatarDataUrl) ||
                ""
            ).trim(),
        }, merged);
    }

    try {
        prefillPremiumSidebarActiveState();
        prefillPremiumSidebarScrollState();

        var raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw) {
            var s = JSON.parse(raw);
            if (s && typeof s === "object" && s.authenticated) {
                persistedSessionSnapshot = s;

                var nameEl = document.querySelector("[data-sidebar-user-name]");
                var roleEl = document.querySelector("[data-sidebar-user-role]");
                var avatarEl = document.querySelector("[data-sidebar-avatar]");
                var profileWrapEl = document.querySelector(".sidebar-user .sidebar-user-trigger");
                var sidebarEl = document.querySelector(".sidebar");
                var hasServerRenderedProfile = sidebarEl && String(sidebarEl.getAttribute("data-sidebar-profile-render-key") || "").trim();
                if (!hasServerRenderedProfile) {
                    var renderKey = buildProfileRenderKey(s);

                    var displayName = String(s.displayName || "Softora Premium");
                    if (nameEl) nameEl.textContent = displayName;
                    if (roleEl) roleEl.textContent = roleLabel(s.role);
                    if (profileWrapEl) {
                        profileWrapEl.setAttribute("aria-label", "Ingelogd als " + displayName);
                    }
                    if (avatarEl) {
                        var url = String(s.avatarDataUrl || "").trim();
                        avatarEl.replaceChildren();
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
                }
            }
        }
    } catch (_) {
        /* ignore */
    }

    window.SoftoraPremiumSidebarProfileSession = {
        enrichSession: enrichSession,
        mergeSessions: mergeSessions,
        shouldEnrichSession: shouldEnrichSession
    };
})();
