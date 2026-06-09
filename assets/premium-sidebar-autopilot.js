(function () {
    const AUTOPILOT_KEY = "coldmailing";
    const BADGE_CLASS = "sidebar-autopilot-badge";
    let pendingFrame = 0;

    function decorateColdmailingAutopilotLink(root) {
        const scope = root && typeof root.querySelectorAll === "function" ? root : document;
        scope.querySelectorAll('.sidebar [data-sidebar-key="' + AUTOPILOT_KEY + '"]').forEach(function (link) {
            link.classList.add("sidebar-link--autopilot");
            link.removeAttribute("href");
            link.setAttribute("role", "link");
            link.setAttribute("aria-disabled", "true");
            link.setAttribute("tabindex", "-1");

            if (!link.querySelector("." + BADGE_CLASS)) {
                const badge = document.createElement("span");
                badge.className = BADGE_CLASS;
                badge.setAttribute("aria-hidden", "true");
                badge.textContent = "autopilot";
                link.appendChild(badge);
            }
        });
    }

    function scheduleDecorate() {
        if (pendingFrame) return;
        pendingFrame = requestAnimationFrame(function () {
            pendingFrame = 0;
            decorateColdmailingAutopilotLink(document);
        });
    }

    document.addEventListener("click", function (event) {
        const target = event.target && event.target.closest
            ? event.target.closest('.sidebar [data-sidebar-key="' + AUTOPILOT_KEY + '"]')
            : null;
        if (!target) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);

    document.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        const target = event.target && event.target.closest
            ? event.target.closest('.sidebar [data-sidebar-key="' + AUTOPILOT_KEY + '"]')
            : null;
        if (!target) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", scheduleDecorate, { once: true });
    } else {
        scheduleDecorate();
    }

    if (typeof MutationObserver === "function") {
        const observer = new MutationObserver(scheduleDecorate);
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        } else {
            document.addEventListener("DOMContentLoaded", function () {
                observer.observe(document.body, { childList: true, subtree: true });
            }, { once: true });
        }
    }

    window.SoftoraPremiumSidebarAutopilot = {
        decorate: decorateColdmailingAutopilotLink,
    };
})();
