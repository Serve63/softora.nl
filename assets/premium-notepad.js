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

    async function fetchUiStateGet(scope) {
        var encodedScope = encodeURIComponent(String(scope || ""));
        var urls = [
            "/api/ui-state-get?scope=" + encodedScope,
            "/api/ui-state/" + encodedScope
        ];
        var lastError = null;

        for (var index = 0; index < urls.length; index += 1) {
            try {
                var res = await fetch(urls[index], { method: "GET", cache: "no-store" });
                if (!res.ok) throw new Error("UI-state GET mislukt (" + res.status + ")");
                return await res.json().catch(function () { return {}; });
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error("UI-state GET mislukt");
    }

    async function fetchUiStateSet(scope, body) {
        var encodedScope = encodeURIComponent(String(scope || ""));
        var urls = [
            "/api/ui-state-set?scope=" + encodedScope,
            "/api/ui-state/" + encodedScope
        ];
        var lastError = null;

        for (var index = 0; index < urls.length; index += 1) {
            try {
                var res = await fetch(urls[index], {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body || {})
                });
                if (!res.ok) throw new Error("UI-state POST mislukt (" + res.status + ")");
                return await res.json().catch(function () { return {}; });
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error("UI-state POST mislukt");
    }

    async function loadInitialValue() {
        try {
            var state = await fetchUiStateGet(REMOTE_SCOPE);
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
            await fetchUiStateSet(REMOTE_SCOPE, {
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
