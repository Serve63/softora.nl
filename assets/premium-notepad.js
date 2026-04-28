(function () {
    "use strict";

    var REMOTE_SCOPE = "premium_notepad";
    var REMOTE_TEXT_KEY = "softora_premium_notepad_text_v1";
    var LEGACY_REMOTE_HTML_KEY = "softora_premium_notepad_html_v1";
    var editor = document.getElementById("notepadEditor");
    var saveTimer = 0;

    if (!editor) return;

    function normalizeString(value) {
        return String(value == null ? "" : value);
    }

    function legacyHtmlToText(html) {
        var template = document.createElement("template");
        var normalizedHtml = normalizeString(html)
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(div|p|li|h[1-6])>/gi, "\n");
        template.innerHTML = normalizedHtml;
        return (template.content.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
    }

    function getUiStateClient() {
        if (!window.SoftoraUiStateClient) throw new Error("SoftoraUiStateClient ontbreekt");
        return window.SoftoraUiStateClient;
    }

    async function loadInitialValue() {
        try {
            var state = await getUiStateClient().get(REMOTE_SCOPE);
            var values = state && state.values ? state.values : {};
            var text = normalizeString(values[REMOTE_TEXT_KEY]);

            if (!text && values[LEGACY_REMOTE_HTML_KEY]) {
                text = legacyHtmlToText(values[LEGACY_REMOTE_HTML_KEY]);
            }

            if (text) editor.textContent = text;
        } catch (error) {
            console.error("Kladblok laden via Supabase mislukt:", error);
        }
    }

    async function save() {
        try {
            await getUiStateClient().set(REMOTE_SCOPE, {
                patch: {
                    [REMOTE_TEXT_KEY]: normalizeString(editor.innerText || editor.textContent)
                },
                source: "premium-kladblok",
                actor: "browser"
            });
        } catch (error) {
            console.error("Kladblok opslaan via Supabase mislukt:", error);
        }
    }

    function queueSave() {
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(function () {
            void save();
        }, 240);
    }

    function finishPremiumBootShell() {
        if (window.SoftoraPremiumBoot && typeof window.SoftoraPremiumBoot.setShellBooting === "function") {
            window.SoftoraPremiumBoot.setShellBooting(false);
            return;
        }
        var main = document.querySelector("main.is-premium-boot-host");
        if (!main) return;
        var shell = main.querySelector(".premium-boot-shell");
        var loader = main.querySelector(".premium-boot-loader");
        if (shell) {
            shell.classList.remove("is-booting");
            shell.setAttribute("aria-busy", "false");
        }
        if (loader) loader.classList.add("is-hidden");
    }

    editor.addEventListener("input", queueSave);

    window.addEventListener("beforeunload", function () {
        window.clearTimeout(saveTimer);
        void save();
    });

    void (async function () {
        try {
            await loadInitialValue();
        } finally {
            finishPremiumBootShell();
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", finishPremiumBootShell, { once: true });
            }
        }
    })();
})();
