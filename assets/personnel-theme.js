(function () {
    const pathname = (window.location.pathname || "").toLowerCase();
    const isPremiumPersonnelContext = pathname.indexOf("/premium-") !== -1;
    const personnelStorageKey = isPremiumPersonnelContext
        ? "softora_premium_personnel_theme_mode"
        : "softora_software_personnel_theme_mode";
    const publicStorageKey = "softora_premium_public_theme_mode";
    const root = document.documentElement;
    const themeButtons = document.querySelectorAll(".theme-switch-btn[data-theme-value]");
    let activeScopeModal = null;

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

    if (!themeButtons.length) return;

    function normalizeThemeMode(mode) {
        if (mode === "dark" || mode === "light") return mode;
        return null;
    }

    function readThemeMode() {
        try {
            return normalizeThemeMode(localStorage.getItem(personnelStorageKey));
        } catch (error) {
            return null;
        }
    }

    function persistThemeMode(key, mode) {
        try {
            localStorage.setItem(key, mode);
        } catch (error) {
            /* ignore storage errors */
        }
    }

    function parseRgbColor(value) {
        const hex = value.trim().toLowerCase();
        if (hex.startsWith("#")) {
            const raw = hex.slice(1);
            if (raw.length === 3) {
                return {
                    r: parseInt(raw[0] + raw[0], 16),
                    g: parseInt(raw[1] + raw[1], 16),
                    b: parseInt(raw[2] + raw[2], 16),
                };
            }
            if (raw.length === 6) {
                return {
                    r: parseInt(raw.slice(0, 2), 16),
                    g: parseInt(raw.slice(2, 4), 16),
                    b: parseInt(raw.slice(4, 6), 16),
                };
            }
        }

        const rgbMatch = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (rgbMatch) {
            return {
                r: Number(rgbMatch[1]),
                g: Number(rgbMatch[2]),
                b: Number(rgbMatch[3]),
            };
        }

        return null;
    }

    function inferBaseTheme() {
        const bgColor = getComputedStyle(root).getPropertyValue("--bg-primary").trim();
        const rgb = parseRgbColor(bgColor);

        if (!rgb) return "dark";

        const luminance =
            (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;

        return luminance > 0.52 ? "light" : "dark";
    }

    function syncButtonState(mode) {
        themeButtons.forEach(function (button) {
            const isActive = button.dataset.themeValue === mode;
            button.classList.toggle("is-active", isActive);
            button.setAttribute("aria-pressed", isActive ? "true" : "false");
        });
    }

    function applyTheme(mode, persist) {
        const nextMode = normalizeThemeMode(mode);
        if (!nextMode) return;

        root.setAttribute("data-theme-mode", nextMode);
        root.setAttribute("data-theme", nextMode);
        syncButtonState(nextMode);

        if (persist) {
            persistThemeMode(personnelStorageKey, nextMode);
        }
    }

    function persistPublicTheme(mode) {
        if (!isPremiumPersonnelContext) return;
        const nextMode = normalizeThemeMode(mode);
        if (!nextMode) return;
        persistThemeMode(publicStorageKey, nextMode);
    }

    function removeScopeModal() {
        if (!activeScopeModal) return;
        window.removeEventListener("keydown", activeScopeModal.onKeydown);
        document.body.style.removeProperty("overflow");
        activeScopeModal.node.remove();
        activeScopeModal = null;
    }

    function askThemeScope(mode) {
        return new Promise(function (resolve) {
            const nextMode = normalizeThemeMode(mode);
            if (!nextMode || !document.body) {
                resolve(null);
                return;
            }

            removeScopeModal();

            const modeLabel = nextMode === "dark" ? "donkere" : "lichte";
            const scopeText = isPremiumPersonnelContext
                ? "Je kiest nu het " + modeLabel + " thema. Voor wie wil je dit toepassen?"
                : "Je kiest nu het " + modeLabel + " thema. Dit geldt alleen voor de software-personeelomgeving.";
            const visitorsOption = isPremiumPersonnelContext
                ? '<button type="button" class="theme-scope-btn is-primary" data-scope-choice="both">Personeel + bezoekers</button>'
                : "";
            const modal = document.createElement("div");
            modal.className = "theme-scope-modal";
            modal.innerHTML =
                '<div class="theme-scope-backdrop" data-scope-choice="cancel"></div>' +
                '<div class="theme-scope-dialog" role="dialog" aria-modal="true" aria-labelledby="themeScopeTitle">' +
                    '<h3 id="themeScopeTitle" class="theme-scope-title">Thema toepassen</h3>' +
                    '<p class="theme-scope-text">' + scopeText + '</p>' +
                    '<div class="theme-scope-actions">' +
                        '<button type="button" class="theme-scope-btn is-primary" data-scope-choice="personnel">Alleen personeel</button>' +
                        visitorsOption +
                        '<button type="button" class="theme-scope-btn is-cancel" data-scope-choice="cancel">Annuleren</button>' +
                    '</div>' +
                '</div>';

            function finish(choice) {
                removeScopeModal();
                resolve(choice);
            }

            function onKeydown(event) {
                if (event.key === "Escape") {
                    event.preventDefault();
                    finish(null);
                }
            }

            activeScopeModal = { node: modal, onKeydown: onKeydown };

            modal.addEventListener("click", function (event) {
                const target = event.target.closest("[data-scope-choice]");
                if (!target) return;
                const choice = target.getAttribute("data-scope-choice");
                if (choice === "personnel") {
                    finish("personnel");
                    return;
                }
                if (choice === "both") {
                    finish("both");
                    return;
                }
                finish(null);
            });

            document.body.style.overflow = "hidden";
            document.body.appendChild(modal);
            window.addEventListener("keydown", onKeydown);

            const firstButton = modal.querySelector('[data-scope-choice="personnel"]');
            if (firstButton) firstButton.focus();
        });
    }

    themeButtons.forEach(function (button) {
        button.addEventListener("click", function () {
            const requestedMode = normalizeThemeMode(button.dataset.themeValue);
            if (!requestedMode) return;

            askThemeScope(requestedMode).then(function (scope) {
                if (!scope) return;
                applyTheme(requestedMode, true);
                if (scope === "both") {
                    persistPublicTheme(requestedMode);
                }
            });
        });
    });

    const savedMode = readThemeMode();
    if (savedMode) {
        applyTheme(savedMode, false);
    } else {
        syncButtonState(inferBaseTheme());
    }
})();
