(function () {
    const CHAT_SELECTOR = "#dashboardAiChat, .dashboard-ai-chat";
    const STYLE_ID = "softora-dashboard-ai-chat-scope-style";
    const root = document.documentElement;
    let scopeFrame = 0;

    function normalizePath(path) {
        return String(path || "").toLowerCase().split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
    }

    function isDashboardPath(path) {
        const normalized = normalizePath(path);
        return normalized === "/premium-personeel-dashboard" || normalized === "/premium-personeel-dashboard.html";
    }

    function ensureScopeStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = [
            'html[data-dashboard-ai-chat-page="0"] #dashboardAiChat,',
            'html[data-dashboard-ai-chat-page="0"] .dashboard-ai-chat{',
            "display:none !important;",
            "visibility:hidden !important;",
            "pointer-events:none !important;",
            "}",
        ].join("");
        (document.head || document.documentElement).appendChild(style);
    }

    function removeOutOfScopeChat() {
        document.querySelectorAll(CHAT_SELECTOR).forEach(function (element) {
            if (element && element.parentNode) element.parentNode.removeChild(element);
        });
    }

    function enforceDashboardAiChatScope() {
        const isAllowedPage = isDashboardPath(window.location && window.location.pathname);
        root.setAttribute("data-dashboard-ai-chat-page", isAllowedPage ? "1" : "0");
        if (isAllowedPage) return;
        ensureScopeStyle();
        removeOutOfScopeChat();
    }

    function scheduleDashboardAiChatScope() {
        if (scopeFrame) return;
        const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : window.setTimeout;
        scopeFrame = schedule(function () {
            scopeFrame = 0;
            enforceDashboardAiChatScope();
        });
    }

    enforceDashboardAiChatScope();

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", enforceDashboardAiChatScope, { once: true });
    } else {
        scheduleDashboardAiChatScope();
    }

    window.addEventListener("pageshow", scheduleDashboardAiChatScope);
    window.addEventListener("popstate", scheduleDashboardAiChatScope);
    window.addEventListener("hashchange", scheduleDashboardAiChatScope);

    if (typeof MutationObserver === "function") {
        const initObserver = function () {
            if (!document.body || root.dataset.dashboardAiChatScopeObserver === "1") return;
            root.dataset.dashboardAiChatScopeObserver = "1";
            const observer = new MutationObserver(scheduleDashboardAiChatScope);
            observer.observe(document.body, { childList: true, subtree: true });
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", initObserver, { once: true });
        } else {
            initObserver();
        }
    }

    window.SoftoraDashboardAiChatScope = {
        enforce: enforceDashboardAiChatScope,
        isDashboardPath,
    };
})();
