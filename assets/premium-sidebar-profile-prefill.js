/**
 * Synchroon direct na </aside> laden: vult profiel uit sessionStorage vóór deferred * personnel-theme.js, zodat het footer-blok niet eerst "Softora Premium" toont en dan springt.
 * Moet dezelfde sleutel en velden gebruiken als personnel-theme.js (PREMIUM_SIDEBAR_SESSION_STORAGE_KEY).
 */
(function () {
    var STORAGE_KEY = "softora_premium_sidebar_session_v1";

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
