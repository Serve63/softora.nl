(function () {
    "use strict";

    var REMOTE_SCOPE = "premium_notepad";
    var REMOTE_TEXT_KEY = "softora_premium_notepad_text_v1";
    var LEGACY_REMOTE_HTML_KEY = "softora_premium_notepad_html_v1";
    var editor = document.getElementById("notepadEditor");
    var statusEl = document.getElementById("notepadStatus");
    var saveTimer = 0;
    var loadReady = false;
    var dirty = false;

    if (!editor) return;
    editor.setAttribute("contenteditable", "false");

    function normalizeString(value) {
        return String(value == null ? "" : value);
    }

    function setStatus(message, type) {
        if (!statusEl) return;
        statusEl.textContent = normalizeString(message);
        statusEl.classList.toggle("is-error", type === "error");
    }

    function wait(ms) {
        return new Promise(function (resolve) {
            window.setTimeout(resolve, ms);
        });
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

    async function loadRemoteStateWithRetry() {
        var lastError = null;
        for (var attempt = 1; attempt <= 3; attempt += 1) {
            try {
                return await getUiStateClient().get(REMOTE_SCOPE);
            } catch (error) {
                lastError = error;
                if (attempt < 3) await wait(attempt * 450);
            }
        }
        throw lastError || new Error("Kladblok laden mislukt");
    }

    async function loadInitialValue() {
        var bootstrappedState = getUiStateClient().peek && getUiStateClient().peek(REMOTE_SCOPE);
        if (!bootstrappedState) setStatus("Notities laden...", "");
        try {
            var state = await loadRemoteStateWithRetry();
            var values = state && state.values ? state.values : {};
            var text = normalizeString(values[REMOTE_TEXT_KEY]);

            if (!text && values[LEGACY_REMOTE_HTML_KEY]) {
                text = legacyHtmlToText(values[LEGACY_REMOTE_HTML_KEY]);
            }

            if (text) editor.textContent = text;
            loadReady = true;
            dirty = false;
            editor.setAttribute("contenteditable", "true");
            setStatus(text ? "Notities geladen." : "Kladblok is leeg.", "");
        } catch (error) {
            console.error("Kladblok laden via Supabase mislukt:", error);
            loadReady = false;
            editor.setAttribute("contenteditable", "false");
            setStatus("Notities konden niet geladen worden. Niets is overschreven; herlaad de pagina of log opnieuw in.", "error");
        }
    }

    async function save() {
        if (!loadReady || !dirty) return;
        try {
            await getUiStateClient().set(REMOTE_SCOPE, {
                patch: {
                    [REMOTE_TEXT_KEY]: normalizeString(editor.innerText || editor.textContent)
                },
                source: "premium-kladblok",
                actor: "browser"
            });
            dirty = false;
            setStatus("Opgeslagen.", "");
        } catch (error) {
            console.error("Kladblok opslaan via Supabase mislukt:", error);
            setStatus("Opslaan is nog niet gelukt. Je tekst blijft op dit scherm staan; probeer zo opnieuw.", "error");
        }
    }

    function queueSave() {
        if (!loadReady) return;
        dirty = true;
        setStatus("Opslaan...", "");
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
        if (loadReady && dirty) void save();
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
