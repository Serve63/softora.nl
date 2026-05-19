(function () {
    var NAV_STATE_KEY = "softora_premium_sidebar_nav_state_v1";
    var NAV_STATE_MAX_AGE_SECONDS = 30;
    var CONTENT_FRAME_PARAM = "softora_sidebar_content";
    var CONTENT_FRAME_ID = "softoraPremiumContentFrame";
    var activeFrameNavigationUrl = "";

    function isPremiumPath() {
        return String(window.location.pathname || "").toLowerCase().indexOf("/premium-") === 0;
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

    function shouldUsePersistentSidebarShell(href, event) {
        if (!href || !isPremiumPath()) return false;
        if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1)) {
            return false;
        }
        try {
            var targetUrl = new URL(href, window.location.origin);
            if (targetUrl.origin !== window.location.origin) return false;
            var targetPath = String(targetUrl.pathname || "").toLowerCase();
            if (targetPath.indexOf("/premium-") !== 0) return false;
            if (targetPath.indexOf("/premium-personeel-login") === 0) return false;
            return true;
        } catch (_) {
            return false;
        }
    }

    function buildFrameUrl(href) {
        var targetUrl = new URL(normalizeTarget(href), window.location.origin);
        targetUrl.searchParams.set(CONTENT_FRAME_PARAM, "1");
        return targetUrl.pathname + targetUrl.search + targetUrl.hash;
    }

    function buildVisibleUrl(href) {
        var targetUrl = new URL(normalizeTarget(href), window.location.origin);
        targetUrl.searchParams.delete(CONTENT_FRAME_PARAM);
        return targetUrl.pathname + targetUrl.search + targetUrl.hash;
    }

    function resolveActiveSidebarKeyForPath(pathname, hash) {
        var p = String(pathname || "").toLowerCase();
        var h = String(hash || "").replace(/^#/, "").toLowerCase();
        if (p.indexOf("/premium-advertenties") === 0) {
            if (h === "google") return "ads_google";
            if (h === "facebook") return "ads_facebook";
            if (h === "pinterest") return "ads_pinterest";
            if (h === "linkedin") return "ads_linkedin";
            if (h === "twitter") return "ads_twitter";
            return "ads_trustoo";
        }
        if (p.indexOf("/premium-socialmedia") === 0) {
            if (h === "facebook") return "social_facebook";
            if (h === "linkedin") return "social_linkedin";
            if (h === "twitter") return "social_twitter";
            return "social_instagram";
        }
        if (p.indexOf("/premium-actieve-opdrachten") === 0 || p.indexOf("/premium-opdracht-dossier") === 0) return "active_orders";
        if (p.indexOf("/premium-personeel-agenda") === 0) return "agenda";
        if (p.indexOf("/premium-leads") === 0 || p.indexOf("/premium-ai-coldmailing") === 0) return "leads";
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

    function syncSidebarActiveStateForHref(href) {
        var sidebar = getSidebar();
        if (!sidebar || !href) return;
        try {
            var targetUrl = new URL(href, window.location.origin);
            var activeKey = resolveActiveSidebarKeyForPath(targetUrl.pathname, targetUrl.hash);
            sidebar.querySelectorAll(".sidebar-link[data-sidebar-key]").forEach(function (link) {
                var key = String(link.getAttribute("data-sidebar-key") || "").trim();
                link.classList.toggle("active", key === activeKey);
            });
            if (
                window.SoftoraPersonnelTheme &&
                typeof window.SoftoraPersonnelTheme.refreshPremiumStaticSidebarActiveState === "function"
            ) {
                window.SoftoraPersonnelTheme.refreshPremiumStaticSidebarActiveState();
            }
        } catch (_) {
            /* ignore invalid target */
        }
    }

    function setRouteChanging(isChanging) {
        document.documentElement.toggleAttribute("data-premium-sidebar-route-changing", Boolean(isChanging));
        document.documentElement.toggleAttribute("data-premium-sidebar-shell-active", Boolean(isChanging || getContentFrame()));
        if (document.body) {
            document.body.toggleAttribute("data-premium-sidebar-route-changing", Boolean(isChanging));
            document.body.toggleAttribute("data-premium-sidebar-shell-active", Boolean(isChanging || getContentFrame()));
        }
    }

    function getContentFrame() {
        return document.getElementById(CONTENT_FRAME_ID);
    }

    function ensureContentFrame() {
        var existing = getContentFrame();
        if (existing) return existing;
        var frame = document.createElement("iframe");
        frame.id = CONTENT_FRAME_ID;
        frame.className = "softora-premium-content-frame";
        frame.title = "Softora premium inhoud";
        frame.setAttribute("data-premium-sidebar-content-frame", "1");
        frame.setAttribute("loading", "eager");
        frame.setAttribute("aria-live", "polite");
        frame.addEventListener("load", function () {
            setRouteChanging(false);
            try {
                var frameTitle = frame.contentDocument && frame.contentDocument.title;
                if (frameTitle) document.title = frameTitle;
            } catch (_) {
                /* ignore title sync errors */
            }
        });
        document.body.appendChild(frame);
        setRouteChanging(false);
        return frame;
    }

    function navigatePersistentSidebarShell(href, options) {
        if (!shouldUsePersistentSidebarShell(href, options && options.event)) return false;
        var visibleUrl = buildVisibleUrl(href);
        if (isCurrentTarget(visibleUrl) && (!options || options.pushHistory !== false)) return false;
        var sidebar = getSidebar();
        if (!sidebar) return false;
        var frame = ensureContentFrame();
        activeFrameNavigationUrl = visibleUrl;
        markRouteChanging(sidebar, visibleUrl);
        if (!options || options.pushHistory !== false) {
            window.history.pushState({ softoraPremiumSidebarShell: true, href: visibleUrl }, "", visibleUrl);
        }
        syncSidebarActiveStateForHref(visibleUrl);
        frame.src = buildFrameUrl(visibleUrl);
        return true;
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
        if (navigatePersistentSidebarShell(href, { event: event })) {
            event.preventDefault();
            event.stopImmediatePropagation();
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
        window.addEventListener("popstate", function () {
            var frame = getContentFrame();
            if (!frame) return;
            var href = window.location.pathname + window.location.search + window.location.hash;
            if (href === activeFrameNavigationUrl) return;
            navigatePersistentSidebarShell(href, { pushHistory: false });
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bindSidebarStability, { once: true });
    } else {
        bindSidebarStability();
    }
})();
