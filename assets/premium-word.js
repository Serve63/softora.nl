(function () {
    "use strict";

    var REMOTE_SCOPE = "premium_word";
    var REMOTE_KEY = "softora_premium_word_html_v1";
    var BACKUP_KEY = "softora_premium_word_html_backups_v1";
    var editor = document.getElementById("wordEditor");
    var ribbon = document.getElementById("wordRibbon");
    var restoreBackupButton = document.getElementById("wordRestoreBackup");
    var forePick = document.getElementById("wordForeColor");
    var hilitePick = document.getElementById("wordHiliteColor");
    var saveTimer = 0;
    var remoteLoadComplete = false;
    var remoteLoadFailed = false;
    var isDirty = false;
    var wordBackups = [];

    if (!editor || !ribbon) return;

    var allowedTags = {
        A: true,
        B: true,
        BLOCKQUOTE: true,
        BR: true,
        CODE: true,
        DIV: true,
        EM: true,
        FONT: true,
        H1: true,
        H2: true,
        H3: true,
        H4: true,
        H5: true,
        H6: true,
        I: true,
        LI: true,
        OL: true,
        P: true,
        PRE: true,
        S: true,
        SPAN: true,
        STRIKE: true,
        STRONG: true,
        SUB: true,
        SUP: true,
        U: true,
        UL: true
    };
    var blockedTags = { IFRAME: true, LINK: true, META: true, OBJECT: true, SCRIPT: true, STYLE: true };
    var safeStyleProperties = {
        "background-color": true,
        color: true,
        "font-style": true,
        "font-weight": true,
        "text-align": true,
        "text-decoration": true
    };

    function isSafeCssValue(value) {
        var text = String(value || "").toLowerCase();
        return text.indexOf("expression") === -1
            && text.indexOf("javascript:") === -1
            && text.indexOf("url(") === -1
            && text.indexOf("<") === -1
            && text.indexOf(">") === -1;
    }

    function isSafeHref(value) {
        var href = String(value || "").trim();
        return href === ""
            || href.charAt(0) === "#"
            || /^https?:\/\//i.test(href)
            || /^mailto:/i.test(href)
            || /^tel:/i.test(href);
    }

    function sanitizeStyleAttribute(element) {
        var style = element.getAttribute("style");
        if (!style) return;
        var safeRules = [];
        style.split(";").forEach(function (rule) {
            var parts = rule.split(":");
            var property = String(parts.shift() || "").trim().toLowerCase();
            var value = parts.join(":").trim();
            if (!safeStyleProperties[property] || !value || !isSafeCssValue(value)) return;
            safeRules.push(property + ": " + value);
        });
        if (safeRules.length) {
            element.setAttribute("style", safeRules.join("; "));
        } else {
            element.removeAttribute("style");
        }
    }

    function unwrapElement(element) {
        var parent = element.parentNode;
        if (!parent) return;
        while (element.firstChild) {
            parent.insertBefore(element.firstChild, element);
        }
        parent.removeChild(element);
    }

    function sanitizeWordHtml(html) {
        var template = document.createElement("template");
        template.innerHTML = String(html || "");
        Array.prototype.slice.call(template.content.querySelectorAll("*")).forEach(function (element) {
            if (!element.parentNode) return;
            var tag = element.tagName;
            if (blockedTags[tag]) {
                element.remove();
                return;
            }
            if (!allowedTags[tag]) {
                unwrapElement(element);
                return;
            }

            Array.prototype.slice.call(element.attributes).forEach(function (attribute) {
                var name = attribute.name.toLowerCase();
                var value = attribute.value;
                if (name.indexOf("on") === 0) {
                    element.removeAttribute(attribute.name);
                } else if (name === "style") {
                    sanitizeStyleAttribute(element);
                } else if (tag === "A" && name === "href" && isSafeHref(value)) {
                    element.setAttribute("rel", "noopener noreferrer");
                } else if (tag === "A" && (name === "target" || name === "rel")) {
                    element.removeAttribute(attribute.name);
                } else if (tag === "FONT" && name === "color" && isSafeCssValue(value)) {
                    element.setAttribute("style", "color: " + value);
                    element.removeAttribute(attribute.name);
                } else {
                    element.removeAttribute(attribute.name);
                }
            });
        });
        return template.innerHTML;
    }

    function exec(cmd, value) {
        editor.focus();
        try {
            document.execCommand(cmd, false, value === undefined ? null : value);
        } catch (err) {
            /* ignore unsupported editor commands */
        }
    }

    function closestElement(target, selector) {
        return target && typeof target.closest === "function" ? target.closest(selector) : null;
    }

    function parseWordBackups(value) {
        var raw = value;
        if (typeof raw === "string") {
            try {
                raw = JSON.parse(raw);
            } catch (error) {
                raw = [];
            }
        }
        if (!Array.isArray(raw)) return [];
        return raw.map(function (item) {
            if (!item || typeof item !== "object") return null;
            var html = String(item.html || "");
            if (!html) return null;
            return {
                html: html,
                savedAt: String(item.savedAt || ""),
                source: String(item.source || ""),
                actor: String(item.actor || "")
            };
        }).filter(Boolean);
    }

    function updateRestoreBackupButton() {
        if (!restoreBackupButton) return;
        restoreBackupButton.disabled = !wordBackups.length;
        restoreBackupButton.title = wordBackups.length
            ? "Laatste Word-backup terugzetten"
            : "Nog geen Word-backup beschikbaar";
    }

    function refreshBackupsFromState(state) {
        wordBackups = parseWordBackups(state && state.values && state.values[BACKUP_KEY]);
        updateRestoreBackupButton();
    }

    async function restoreLatestBackup() {
        if (!wordBackups.length || !restoreBackupButton || restoreBackupButton.disabled) return;
        var latestBackup = wordBackups[0];
        var confirmed = window.confirm("Laatste Word-backup terugzetten? Je huidige tekst wordt eerst als backup bewaard.");
        if (!confirmed) return;
        editor.setAttribute("contenteditable", "true");
        editor.innerHTML = sanitizeWordHtml(latestBackup.html);
        remoteLoadComplete = true;
        remoteLoadFailed = false;
        isDirty = true;
        window.clearTimeout(saveTimer);
        await save();
    }

    function bindRibbon() {
        ribbon.addEventListener("mousedown", function (event) {
            if (closestElement(event.target, ".ribbon-btn")) event.preventDefault();
        });

        ribbon.addEventListener("click", function (event) {
            var btn = closestElement(event.target, ".ribbon-btn");
            if (!btn) return;
            event.preventDefault();
            if (btn === restoreBackupButton) {
                void restoreLatestBackup();
                return;
            }
            var cmd = btn.getAttribute("data-cmd");
            var val = btn.getAttribute("data-val");
            if (cmd === "formatBlock" && val) {
                exec("formatBlock", val);
                return;
            }
            if (cmd) exec(cmd, null);
        });

        if (forePick) {
            forePick.addEventListener("input", function () {
                exec("foreColor", forePick.value);
            });
        }
        if (hilitePick) {
            hilitePick.addEventListener("input", function () {
                exec("hiliteColor", hilitePick.value);
            });
        }
    }

    function getUiStateClient() {
        if (!window.SoftoraUiStateClient) throw new Error("SoftoraUiStateClient ontbreekt");
        return window.SoftoraUiStateClient;
    }

    async function loadInitialValue() {
        try {
            var state = await getUiStateClient().get(REMOTE_SCOPE);
            var html = String(state && state.values && state.values[REMOTE_KEY] || "");
            editor.setAttribute("contenteditable", "true");
            if (html) editor.innerHTML = sanitizeWordHtml(html);
            refreshBackupsFromState(state);
            remoteLoadComplete = true;
            remoteLoadFailed = false;
            isDirty = false;
        } catch (error) {
            remoteLoadComplete = false;
            remoteLoadFailed = true;
            isDirty = false;
            wordBackups = [];
            updateRestoreBackupButton();
            editor.setAttribute("contenteditable", "false");
            editor.setAttribute("data-placeholder", "Document kon niet geladen worden. Vernieuw de pagina.");
            console.error("Word-document laden mislukt:", error);
        }
    }

    async function save() {
        if (!remoteLoadComplete || remoteLoadFailed || !isDirty) return;
        try {
            var patch = {};
            patch[REMOTE_KEY] = sanitizeWordHtml(editor.innerHTML);
            var state = await getUiStateClient().set(REMOTE_SCOPE, {
                patch: patch,
                source: "premium-word",
                actor: "browser"
            });
            refreshBackupsFromState(state);
            isDirty = false;
        } catch (error) {
            console.error("Word-document opslaan mislukt:", error);
        }
    }

    function queueSave() {
        if (!remoteLoadComplete || remoteLoadFailed) return;
        isDirty = true;
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(function () {
            void save();
        }, 280);
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

    bindRibbon();
    editor.addEventListener("input", queueSave);

    window.addEventListener("beforeunload", function () {
        window.clearTimeout(saveTimer);
        if (isDirty) void save();
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
