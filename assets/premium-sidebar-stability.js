(function () {
    var NAV_STATE_KEY = "softora_premium_sidebar_nav_state_v1";
    var NAV_STATE_MAX_AGE_SECONDS = 30;
    function isPremiumPath() {
        var path = String(window.location.pathname || "").toLowerCase();
        return path.indexOf("/premium-") === 0 || path === "/mailbox" || path === "/live-momentum" || path === "/live-momentum.html";
    }

    function getSidebar() {
        return document.querySelector(".sidebar[data-static-sidebar='1']");
    }

    function getSidebarNav(sidebar) {
        return sidebar && sidebar.querySelector ? sidebar.querySelector(".sidebar-nav") : null;
    }

    function writeCookieValue(name, value, maxAgeSeconds) {
        var safeName = String(name || "").trim();
        if (!safeName) return;
        var safeMaxAge = Math.max(0, Math.floor(Number(maxAgeSeconds) || 0));
        var encodedValue = safeMaxAge > 0 ? encodeURIComponent(String(value || "")) : "";
        document.cookie = safeName + "=" + encodedValue + "; path=/; max-age=" + safeMaxAge + "; SameSite=Lax";
    }

    function persistSidebarNavState(sidebar, targetHref) {
        var nav = getSidebarNav(sidebar);
        if (!nav) return;
        writeCookieValue(NAV_STATE_KEY, JSON.stringify({
            scrollTop: Math.max(0, Number(nav.scrollTop) || 0),
            targetHref: String(targetHref || ""),
            savedAt: Date.now(),
        }), NAV_STATE_MAX_AGE_SECONDS);
    }

    function normalizeTarget(url) {
        var href = String(url || "").trim();
        if (!href) return "";
        return href === "/premium-ai-coldmailing" ? "/premium-leads" : href;
    }

    function getAnchorTarget(anchor) {
        if (!anchor) return "";
        return normalizeTarget(anchor.getAttribute("data-sidebar-href") || anchor.getAttribute("href"));
    }

    function setRouteChanging(isChanging) {
        document.documentElement.toggleAttribute("data-premium-sidebar-route-changing", Boolean(isChanging));
        if (document.body) {
            document.body.toggleAttribute("data-premium-sidebar-route-changing", Boolean(isChanging));
        }
    }

    function isCurrentTarget(href) {
        if (!href) return false;
        try {
            var targetUrl = new URL(href, window.location.origin);
            return targetUrl.origin === window.location.origin &&
                targetUrl.pathname === window.location.pathname &&
                targetUrl.hash === window.location.hash;
        } catch (_) {
            return false;
        }
    }

    function markRouteChanging(sidebar, href) {
        persistSidebarNavState(sidebar, href);
        setRouteChanging(true);
    }

    function handleSidebarNavigationStart(event) {
        if (!isPremiumPath()) return;
        var sidebar = getSidebar();
        if (!sidebar || !event.target) return;
        var anchor = event.target.closest && event.target.closest(".sidebar a.sidebar-logo, .sidebar a.sidebar-link, .sidebar-footer a.logout-btn");
        if (!anchor || !sidebar.contains(anchor)) return;
        if (anchor.getAttribute("aria-disabled") === "true") {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        var href = getAnchorTarget(anchor);
        if (!href) return;
        if (isCurrentTarget(href)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        if (anchor.classList && anchor.classList.contains("logout-btn")) {
            markRouteChanging(sidebar, href);
            return;
        }
        markRouteChanging(sidebar, href);
    }

    function bindSidebarStability() {
        if (!isPremiumPath() || document.documentElement.dataset.premiumSidebarPersistentNav === "1") return;
        document.documentElement.dataset.premiumSidebarPersistentNav = "1";
        document.addEventListener("click", handleSidebarNavigationStart, true);
        document.addEventListener("keydown", function (event) {
            if (event.key !== "Enter" && event.key !== " ") return;
            handleSidebarNavigationStart(event);
        }, true);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bindSidebarStability, { once: true });
    } else {
        bindSidebarStability();
    }
})();
