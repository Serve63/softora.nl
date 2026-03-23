(function () {
    const pathname = (window.location.pathname || "").toLowerCase();
    const isPremiumPersonnelContext = pathname.indexOf("/premium-") !== -1;
    const personnelStorageKey = isPremiumPersonnelContext
        ? "softora_premium_personnel_theme_mode"
        : "softora_software_personnel_theme_mode";
    const publicStorageKey = "softora_premium_public_theme_mode";
    const publicFallbackStorageKey = "softora_public_theme_mode";
    const root = document.documentElement;
    const themeButtons = document.querySelectorAll(".theme-switch-btn[data-theme-value]");

    window.SoftoraAI = window.SoftoraAI || {};

    if (typeof window.SoftoraAI.summarizeText !== "function") {
        window.SoftoraAI.summarizeText = async function summarizeText(input, options) {
            const opts = (typeof input === "object" && input && !Array.isArray(input))
                ? { ...input }
                : { ...(options || {}), text: input };
            const response = await fetch("/api/ai/summarize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    text: String(opts.text || ""),
                    style: opts.style || "medium",
                    language: opts.language || "nl",
                    maxSentences: opts.maxSentences,
                    extraInstructions: opts.extraInstructions || "",
                }),
                signal: opts.signal,
            });

            const data = await response.json().catch(function () {
                return {};
            });

            if (!response.ok || !data || data.ok === false) {
                throw new Error(String((data && (data.detail || data.error)) || "AI samenvatting mislukt"));
            }

            return data;
        };
    }

    function releaseLoadingState() {
        root.removeAttribute("data-personnel-loading");
    }

    if (document.readyState === "complete") {
        requestAnimationFrame(releaseLoadingState);
    } else {
        window.addEventListener("load", function () {
            requestAnimationFrame(releaseLoadingState);
        }, { once: true });
    }

    function placeSidebarLogoutNextToRole() {
        document.querySelectorAll(".sidebar-footer .sidebar-user").forEach(function (user) {
            const info = user.querySelector(".sidebar-user-info");
            const role = info && info.querySelector(".sidebar-user-role");
            const logout = user.querySelector(".logout-btn");

            if (!role || !logout) return;
            if (logout.parentElement === role) return;

            role.appendChild(logout);
        });
    }

    function forceLightTheme() {
        root.setAttribute("data-theme-mode", "light");
        root.setAttribute("data-theme", "light");

        try {
            localStorage.setItem(personnelStorageKey, "light");
        } catch (error) {
            /* ignore storage errors */
        }

        if (isPremiumPersonnelContext) {
            try {
                localStorage.setItem(publicStorageKey, "light");
                localStorage.setItem(publicFallbackStorageKey, "light");
            } catch (error) {
                /* ignore storage errors */
            }
        }
    }

    function syncThemeButtonsToLight() {
        themeButtons.forEach(function (button) {
            const value = String(button.dataset.themeValue || "").toLowerCase();
            if (value === "dark") {
                button.remove();
                return;
            }

            const isLight = value === "light";
            button.classList.toggle("is-active", isLight);
            button.setAttribute("aria-pressed", isLight ? "true" : "false");
            button.addEventListener("click", function () {
                forceLightTheme();
            });
        });
    }

    window.SoftoraPersonnelTheme = window.SoftoraPersonnelTheme || {};
    window.SoftoraPersonnelTheme.getMode = function getMode() {
        return "light";
    };

    window.SoftoraPersonnelTheme.applyMode = function applyMode() {
        forceLightTheme();
        return Promise.resolve(true);
    };

    forceLightTheme();
    syncThemeButtonsToLight();
    placeSidebarLogoutNextToRole();
})();
