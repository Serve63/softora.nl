(function () {
    "use strict";

    var REMOTE_SCOPE = "premium_word";
    var REMOTE_KEY = "softora_premium_word_html_v1";
    var BACKUP_KEY = "softora_premium_word_html_backups_v1";
    var TITLE_KEY = "softora_premium_word_title_v1";
    var DEFAULT_TITLE = "Naamloos document";
    var editor = document.getElementById("wordEditor");
    var ribbon = document.getElementById("wordRibbon");
    var restoreBackupButton = document.getElementById("wordRestoreBackup");
    var wordStatus = document.getElementById("wordStatus");
    var forePick = document.getElementById("wordForeColor");
    var hilitePick = document.getElementById("wordHiliteColor");
    var titleInput = document.getElementById("wordTitle");
    var saveStateEl = document.getElementById("wordSaveState");
    var blockSelect = document.getElementById("wordBlockStyle");
    var fontSelect = document.getElementById("wordFontFamily");
    var sizeSelect = document.getElementById("wordFontSize");
    var lineSelect = document.getElementById("wordLineHeight");
    var saveTimer = 0;
    var reconnectTimer = 0;
    var reconnectDelayMs = 1600;
    var reconnectRunning = false;
    var remoteLoadComplete = false;
    var remoteLoadFailed = false;
    var isDirty = false;
    var wordBackups = [];
    var localDraftHtml = "";
    var localDraftSavedAt = "";
    var savedRange = null;
    var lastFontSizePt = 11;
    var plainPasteNext = false;
    var toolbarFrame = 0;
    var toastTimer = 0;
    var tools = null;
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");

    if (!editor || !ribbon) return;

    var allowedTags = {
        A: true,
        B: true,
        BLOCKQUOTE: true,
        BR: true,
        CAPTION: true,
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
        HR: true,
        I: true,
        LI: true,
        MARK: true,
        OL: true,
        P: true,
        PRE: true,
        S: true,
        SPAN: true,
        STRIKE: true,
        STRONG: true,
        SUB: true,
        SUP: true,
        TABLE: true,
        TBODY: true,
        TD: true,
        TFOOT: true,
        TH: true,
        THEAD: true,
        TR: true,
        U: true,
        UL: true
    };
    var blockedTags = { IFRAME: true, LINK: true, META: true, OBJECT: true, SCRIPT: true, STYLE: true };
    var safeStyleProperties = {
        "background-color": true,
        color: true,
        "font-family": true,
        "font-size": true,
        "font-style": true,
        "font-weight": true,
        "line-height": true,
        "margin-left": true,
        "padding-left": true,
        "text-align": true,
        "text-decoration": true,
        "text-indent": true
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

    function appendStyleRule(element, property, value) {
        var current = String(element.getAttribute("style") || "").trim();
        element.setAttribute("style", (current ? current.replace(/;?\s*$/, "; ") : "") + property + ": " + value);
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
        var commentWalker = document.createTreeWalker(template.content, NodeFilter.SHOW_COMMENT);
        var comments = [];
        while (commentWalker.nextNode()) comments.push(commentWalker.currentNode);
        comments.forEach(function (comment) {
            comment.remove();
        });
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
                    element.removeAttribute(attribute.name);
                    appendStyleRule(element, "color", value);
                } else if (tag === "FONT" && name === "face" && isSafeCssValue(value)) {
                    element.removeAttribute(attribute.name);
                    appendStyleRule(element, "font-family", value);
                } else if ((tag === "TD" || tag === "TH") && (name === "colspan" || name === "rowspan") && /^\d{1,2}$/.test(value)) {
                    return;
                } else {
                    element.removeAttribute(attribute.name);
                }
            });
        });
        return template.innerHTML;
    }

    /* ---------- Selectie en opdrachten ---------- */

    function closestElement(target, selector) {
        return target && typeof target.closest === "function" ? target.closest(selector) : null;
    }

    function selectionInEditor() {
        var selection = window.getSelection();
        if (!selection || !selection.rangeCount) return false;
        return editor.contains(selection.getRangeAt(0).commonAncestorContainer);
    }

    function selectionElement() {
        var selection = window.getSelection();
        if (!selection || !selection.rangeCount) return null;
        var node = selection.getRangeAt(0).startContainer;
        if (node && node.nodeType === 3) node = node.parentNode;
        return node && editor.contains(node) ? node : null;
    }

    function rememberSelection() {
        if (selectionInEditor()) savedRange = window.getSelection().getRangeAt(0).cloneRange();
    }

    function restoreSelection() {
        if (document.activeElement === editor && selectionInEditor()) return;
        editor.focus({ preventScroll: true });
        var selection = window.getSelection();
        if (savedRange && editor.contains(savedRange.startContainer) && editor.contains(savedRange.endContainer)) {
            selection.removeAllRanges();
            selection.addRange(savedRange);
        } else if (!selectionInEditor()) {
            var range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    function runCommand(cmd, value, useCss) {
        try {
            if (useCss) document.execCommand("styleWithCSS", false, true);
            document.execCommand(cmd, false, value === undefined ? null : value);
        } catch (err) {
            /* ignore unsupported editor commands */
        } finally {
            if (useCss) {
                try {
                    document.execCommand("styleWithCSS", false, false);
                } catch (err) {
                    /* ignore */
                }
            }
        }
    }

    function afterEdit() {
        normalizeFontSizes();
        rememberSelection();
        queueSave();
        if (tools) tools.refreshSoon();
        scheduleToolbarState();
    }

    function exec(cmd, value) {
        restoreSelection();
        runCommand(cmd, value, false);
        afterEdit();
    }

    function execStyled(cmd, value) {
        restoreSelection();
        runCommand(cmd, value, true);
        afterEdit();
    }

    function normalizeFontSizes() {
        Array.prototype.forEach.call(editor.querySelectorAll("font[size]"), function (font) {
            if (font.getAttribute("size") === "7") {
                Array.prototype.forEach.call(font.querySelectorAll("[style]"), function (child) {
                    child.style.fontSize = "";
                    if (!child.getAttribute("style")) child.removeAttribute("style");
                });
                font.style.fontSize = lastFontSizePt + "pt";
            }
            font.removeAttribute("size");
        });
    }

    function applyFontSize(pt) {
        lastFontSizePt = pt;
        exec("fontSize", "7");
    }

    function getSelectedBlocks() {
        var selection = window.getSelection();
        if (!selection || !selection.rangeCount) return [];
        var range = selection.getRangeAt(0);
        var selector = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, div";
        return Array.prototype.filter.call(editor.querySelectorAll(selector), function (block) {
            return range.intersectsNode(block) && !block.querySelector(selector);
        });
    }

    function applyLineHeight(value) {
        restoreSelection();
        var blocks = getSelectedBlocks();
        if (!blocks.length) {
            runCommand("formatBlock", "p", false);
            blocks = getSelectedBlocks();
        }
        blocks.forEach(function (block) {
            block.style.lineHeight = value;
        });
        afterEdit();
    }

    /* ---------- Werkbalkstatus ---------- */

    var stateCommands = [
        "bold", "italic", "underline", "strikeThrough", "superscript", "subscript",
        "insertUnorderedList", "insertOrderedList", "justifyLeft", "justifyCenter", "justifyRight", "justifyFull"
    ];

    function setButtonActive(cmd, active) {
        Array.prototype.forEach.call(ribbon.querySelectorAll('[data-cmd="' + cmd + '"]'), function (button) {
            button.classList.toggle("is-active", Boolean(active));
            button.setAttribute("aria-pressed", active ? "true" : "false");
        });
    }

    function matchSelectOption(select, predicate) {
        if (!select) return;
        var match = Array.prototype.find.call(select.options, predicate);
        select.value = match ? match.value : "";
    }

    function updateToolbarState() {
        toolbarFrame = 0;
        if (!selectionInEditor()) return;
        stateCommands.forEach(function (cmd) {
            var active = false;
            try {
                active = document.queryCommandState(cmd);
            } catch (err) {
                active = false;
            }
            setButtonActive(cmd, active);
        });
        var element = selectionElement() || editor;
        setButtonActive("link", Boolean(element.closest("a")));

        var block = "";
        try {
            block = String(document.queryCommandValue("formatBlock") || "").toLowerCase();
        } catch (err) {
            block = "";
        }
        if (blockSelect) blockSelect.value = /^(h[1-4]|blockquote|pre)$/.test(block) ? block : "p";

        var computed = window.getComputedStyle(element);
        var family = String(computed.fontFamily || "").split(",")[0].replace(/["']/g, "").trim().toLowerCase();
        matchSelectOption(fontSelect, function (option) {
            return option.value.split(",")[0].replace(/["']/g, "").trim().toLowerCase() === family;
        });
        var pt = Math.round(parseFloat(computed.fontSize) * 0.75 * 2) / 2;
        if (sizeSelect) {
            var custom = sizeSelect.querySelector("option[data-custom]");
            if (!Array.prototype.some.call(sizeSelect.options, function (option) { return Number(option.value) === pt && !option.hasAttribute("data-custom"); })) {
                if (!custom) {
                    custom = document.createElement("option");
                    custom.setAttribute("data-custom", "1");
                    custom.hidden = true;
                    sizeSelect.appendChild(custom);
                }
                custom.value = String(pt);
                custom.textContent = String(pt).replace(".", ",");
            }
            sizeSelect.value = String(pt);
        }
        var blockElement = element.closest("p, h1, h2, h3, h4, li, blockquote, pre, div");
        var lineHeight = blockElement && blockElement !== editor ? blockElement.style.lineHeight : "";
        matchSelectOption(lineSelect, function (option) {
            return option.value && option.value === lineHeight;
        });
        if (tools) tools.updateTableBar();
    }

    function scheduleToolbarState() {
        if (toolbarFrame) return;
        toolbarFrame = window.requestAnimationFrame(updateToolbarState);
    }

    function applyShortcutTitles() {
        Array.prototype.forEach.call(ribbon.querySelectorAll("[data-label]"), function (button) {
            var label = button.getAttribute("data-label");
            var shortcut = button.getAttribute("data-shortcut");
            if (shortcut) {
                shortcut = shortcut
                    .replace(/mod\+/g, isMac ? "⌘" : "Ctrl+")
                    .replace(/shift\+/g, isMac ? "⇧" : "Shift+");
                label += " (" + shortcut + ")";
            }
            button.title = label;
            button.setAttribute("aria-label", button.getAttribute("data-label"));
        });
    }

    /* ---------- Meldingen en opslagstatus ---------- */

    function setWordStatus(message, type) {
        if (!wordStatus) return;
        var text = String(message || "").trim();
        wordStatus.textContent = text;
        wordStatus.hidden = !text;
        wordStatus.className = "word-status" + (type ? " word-status--" + type : "");
    }

    function showToast(message) {
        var toast = document.getElementById("wordToast");
        if (!toast) return;
        toast.textContent = String(message || "");
        toast.classList.add("is-visible");
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(function () {
            toast.classList.remove("is-visible");
        }, 2600);
    }

    function setSaveState(state) {
        if (!saveStateEl) return;
        var labels = {
            loading: "Laden…",
            dirty: "Wijzigingen worden opgeslagen…",
            saving: "Opslaan…",
            saved: "Opgeslagen om " + new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }),
            offline: "Niet verbonden — tekst blijft in dit tabblad staan"
        };
        saveStateEl.setAttribute("data-state", state);
        saveStateEl.textContent = labels[state] || "";
    }

    function getDocTitle() {
        var title = titleInput ? String(titleInput.value || "").trim() : "";
        return title || DEFAULT_TITLE;
    }

    function applyRemoteTitle(state) {
        if (!titleInput) return;
        var remoteTitle = String(state && state.values && state.values[TITLE_KEY] || "").trim();
        titleInput.value = remoteTitle || DEFAULT_TITLE;
    }

    /* ---------- Versies ---------- */

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
            ? wordBackups.length + (wordBackups.length === 1 ? " eerdere versie bekijken" : " eerdere versies bekijken")
            : "Nog geen eerdere versies";
    }

    function refreshBackupsFromState(state) {
        wordBackups = mergeLocalDraftIntoBackups(parseWordBackups(state && state.values && state.values[BACKUP_KEY]));
        updateRestoreBackupButton();
    }

    function textFromHtml(html) {
        var template = document.createElement("template");
        template.innerHTML = sanitizeWordHtml(html);
        return String(template.content.textContent || "").replace(/\s+/g, " ").trim();
    }

    function formatBackupDate(value) {
        var date = new Date(value);
        if (!value || isNaN(date.getTime())) return "Onbekend tijdstip";
        return date.toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    }

    function renderBackupList() {
        var list = document.getElementById("wordBackupList");
        if (!list) return;
        list.textContent = "";
        if (!wordBackups.length) {
            var empty = document.createElement("li");
            empty.className = "word-version-empty";
            empty.textContent = "Er zijn nog geen eerdere versies.";
            list.appendChild(empty);
            return;
        }
        wordBackups.forEach(function (backup, index) {
            var item = document.createElement("li");
            item.className = "word-version";
            var meta = document.createElement("div");
            meta.className = "word-version-meta";
            var when = document.createElement("strong");
            when.textContent = formatBackupDate(backup.savedAt);
            var source = document.createElement("span");
            source.textContent = backup.source === "local-draft" ? "Lokale hersteltekst uit dit tabblad" : "Automatisch bewaarde versie";
            var preview = document.createElement("p");
            preview.textContent = textFromHtml(backup.html).slice(0, 220) || "(leeg document)";
            meta.appendChild(when);
            meta.appendChild(source);
            meta.appendChild(preview);
            var button = document.createElement("button");
            button.type = "button";
            button.className = "word-action";
            button.textContent = "Terugzetten";
            button.addEventListener("click", function () {
                void restoreBackup(index);
            });
            item.appendChild(meta);
            item.appendChild(button);
            list.appendChild(item);
        });
    }

    function openBackupDialog() {
        var dialog = document.getElementById("wordBackupDialog");
        if (!dialog || !wordBackups.length) return;
        renderBackupList();
        dialog.showModal();
    }

    async function restoreBackup(index) {
        var backup = wordBackups[index];
        if (!backup) return;
        var confirmed = window.confirm("Deze versie terugzetten? Je huidige tekst wordt eerst zelf als versie bewaard.");
        if (!confirmed) return;
        var dialog = document.getElementById("wordBackupDialog");
        if (dialog && dialog.open) dialog.close();
        editor.setAttribute("contenteditable", "true");
        editor.innerHTML = sanitizeWordHtml(backup.html);
        remoteLoadComplete = true;
        remoteLoadFailed = false;
        isDirty = true;
        window.clearTimeout(saveTimer);
        if (tools) tools.refreshNow();
        await save();
        showToast("Versie teruggezet");
    }

    /* ---------- Lokale hersteltekst en verbinding ---------- */

    function readLocalDraft() {
        var html = String(localDraftHtml || "");
        if (!html) return null;
        return {
            html: html,
            savedAt: String(localDraftSavedAt || "")
        };
    }

    function persistLocalDraft() {
        var html = sanitizeWordHtml(editor.innerHTML);
        localDraftHtml = html;
        localDraftSavedAt = html ? new Date().toISOString() : "";
    }

    function clearLocalDraft() {
        localDraftHtml = "";
        localDraftSavedAt = "";
    }

    function buildLocalDraftBackup() {
        var draft = readLocalDraft();
        if (!draft || !draft.html) return null;
        return {
            html: draft.html,
            savedAt: draft.savedAt,
            source: "local-draft",
            actor: "browser"
        };
    }

    function getSanitizedCompareHtml(html) {
        return sanitizeWordHtml(html).replace(/\s+/g, " ").trim();
    }

    function getCurrentEditorHtml() {
        return sanitizeWordHtml(editor.innerHTML);
    }

    function mergeLocalDraftIntoBackups(backups) {
        var safeBackups = Array.isArray(backups) ? backups.slice() : [];
        var localDraftBackup = buildLocalDraftBackup();
        if (!localDraftBackup) return safeBackups;
        var localHtml = getSanitizedCompareHtml(localDraftBackup.html);
        var alreadyPresent = safeBackups.some(function (backup) {
            return getSanitizedCompareHtml(backup && backup.html) === localHtml;
        });
        return alreadyPresent ? safeBackups : [localDraftBackup].concat(safeBackups);
    }

    function getLoadFailureMessage(error, restoredLocalDraft) {
        var text = String(error && (error.message || error) || "");
        if (/401|Niet ingelogd/i.test(text)) {
            return restoredLocalDraft
                ? "Je sessie is niet verbonden. Lokale hersteltekst is geladen; log opnieuw in om online op te slaan."
                : "Je sessie is niet verbonden. Je kunt tijdelijk in dit tabblad typen; log opnieuw in om online op te slaan.";
        }
        return restoredLocalDraft
            ? "Online opslag kon niet geladen worden. Hersteltekst is geladen en blijft beschikbaar zolang dit tabblad open blijft."
            : "Online opslag kon niet geladen worden. Je kunt tijdelijk typen; je tekst blijft staan zolang dit tabblad open blijft.";
    }

    function enableLocalFallback(error) {
        var localDraft = readLocalDraft();
        var restoredLocalDraft = Boolean(localDraft && localDraft.html);
        editor.setAttribute("contenteditable", "true");
        editor.setAttribute(
            "data-placeholder",
            "Online opslag is tijdelijk niet verbonden. Typ gerust door; laat dit tabblad open tot de opslag weer werkt."
        );
        if (restoredLocalDraft) editor.innerHTML = sanitizeWordHtml(localDraft.html);
        setWordStatus(getLoadFailureMessage(error, restoredLocalDraft), "warning");
        setSaveState("offline");
    }

    function resetReconnectDelay() {
        reconnectDelayMs = 1600;
    }

    function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = window.setTimeout(function () {
            reconnectTimer = 0;
            void retryOnlineConnection();
        }, reconnectDelayMs);
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, 12000);
    }

    async function retryOnlineConnection() {
        if (reconnectRunning) return;
        reconnectRunning = true;
        try {
            var state = await getUiStateClient().get(REMOTE_SCOPE);
            var remoteHtml = sanitizeWordHtml(String(state && state.values && state.values[REMOTE_KEY] || ""));
            var localDraft = readLocalDraft();
            var localHtml = localDraft && localDraft.html ? sanitizeWordHtml(localDraft.html) : "";
            var currentHtml = getCurrentEditorHtml();
            var hasUnsavedLocalText = Boolean(
                isDirty ||
                (localHtml && currentHtml && getSanitizedCompareHtml(currentHtml) !== getSanitizedCompareHtml(remoteHtml))
            );

            editor.setAttribute("contenteditable", "true");
            editor.setAttribute("data-placeholder", "Begin met typen…");
            refreshBackupsFromState(state);
            remoteLoadComplete = true;
            remoteLoadFailed = false;
            resetReconnectDelay();

            if (hasUnsavedLocalText) {
                if (getDocTitle() === DEFAULT_TITLE) applyRemoteTitle(state);
                editor.innerHTML = currentHtml;
                isDirty = true;
                setWordStatus("Online opslag hersteld. Je tekst wordt nu opgeslagen.", "warning");
                await save();
                return;
            }

            applyRemoteTitle(state);
            if (remoteHtml) {
                editor.innerHTML = remoteHtml;
                clearLocalDraft();
                isDirty = false;
            } else if (localHtml) {
                editor.innerHTML = localHtml;
                isDirty = true;
                setWordStatus("Online opslag hersteld. Lokale hersteltekst wordt nu opgeslagen.", "warning");
                await save();
                return;
            }

            setWordStatus("", "");
            setSaveState("saved");
            if (tools) tools.refreshNow();
        } catch (error) {
            remoteLoadComplete = false;
            remoteLoadFailed = true;
            scheduleReconnect();
            console.error("Word-document opnieuw verbinden mislukt:", error);
        } finally {
            reconnectRunning = false;
        }
    }

    function getUiStateClient() {
        if (!window.SoftoraUiStateClient) throw new Error("SoftoraUiStateClient ontbreekt");
        return window.SoftoraUiStateClient;
    }

    async function loadInitialValue() {
        try {
            var state = await getUiStateClient().get(REMOTE_SCOPE);
            var html = sanitizeWordHtml(String(state && state.values && state.values[REMOTE_KEY] || ""));
            var localDraft = readLocalDraft();
            var localHtml = localDraft && localDraft.html ? sanitizeWordHtml(localDraft.html) : "";
            editor.setAttribute("contenteditable", "true");
            applyRemoteTitle(state);
            if (html) {
                editor.innerHTML = html;
            } else if (localHtml) {
                editor.innerHTML = localHtml;
            }
            refreshBackupsFromState(state);
            remoteLoadComplete = true;
            remoteLoadFailed = false;
            isDirty = Boolean(!html && localHtml);
            setSaveState("saved");
            if (isDirty) {
                setWordStatus("Lokale hersteltekst is geladen. We proberen deze opnieuw online op te slaan.", "warning");
                await save();
            } else if (localHtml && getSanitizedCompareHtml(localHtml) !== getSanitizedCompareHtml(html)) {
                setWordStatus("Online document geladen. Er staat ook lokale hersteltekst klaar via Versies.", "warning");
            } else {
                clearLocalDraft();
                setWordStatus("", "");
            }
        } catch (error) {
            remoteLoadComplete = false;
            remoteLoadFailed = true;
            isDirty = false;
            wordBackups = [];
            updateRestoreBackupButton();
            enableLocalFallback(error);
            scheduleReconnect();
            console.error("Word-document laden mislukt:", error);
        }
    }

    async function save() {
        if (!remoteLoadComplete || remoteLoadFailed || !isDirty) return;
        setSaveState("saving");
        try {
            var patch = {};
            patch[REMOTE_KEY] = sanitizeWordHtml(editor.innerHTML);
            patch[TITLE_KEY] = getDocTitle();
            persistLocalDraft();
            var state = await getUiStateClient().set(REMOTE_SCOPE, {
                patch: patch,
                source: "premium-word",
                actor: "browser"
            });
            isDirty = false;
            clearLocalDraft();
            refreshBackupsFromState(state);
            setWordStatus("", "");
            setSaveState("saved");
        } catch (error) {
            remoteLoadComplete = false;
            remoteLoadFailed = true;
            persistLocalDraft();
            setWordStatus(
                "Online opslaan lukt nu niet. Je tekst blijft in dit tabblad staan; we proberen automatisch opnieuw te verbinden.",
                "warning"
            );
            setSaveState("offline");
            scheduleReconnect();
            console.error("Word-document opslaan mislukt:", error);
        }
    }

    function queueSave() {
        isDirty = true;
        persistLocalDraft();
        if (!remoteLoadComplete || remoteLoadFailed) {
            setSaveState("offline");
            scheduleReconnect();
            return;
        }
        setSaveState("dirty");
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(function () {
            void save();
        }, 600);
    }

    async function saveNow() {
        window.clearTimeout(saveTimer);
        if (!isDirty) {
            showToast("Alles is opgeslagen");
            return;
        }
        await save();
        if (!isDirty) showToast("Opgeslagen");
    }

    /* ---------- Werkbalk, menu's en documentacties ---------- */

    function handleCommand(cmd) {
        if (cmd === "link" && tools) return tools.openLinkDialog();
        if (cmd === "table" && tools) return tools.toggleTablePicker();
        exec(cmd);
    }

    function bindRibbon() {
        ribbon.addEventListener("mousedown", function (event) {
            if (closestElement(event.target, ".ribbon-btn")) event.preventDefault();
        });

        ribbon.addEventListener("click", function (event) {
            var btn = closestElement(event.target, ".ribbon-btn");
            if (!btn) return;
            event.preventDefault();
            var cmd = btn.getAttribute("data-cmd");
            if (cmd) handleCommand(cmd);
        });

        if (blockSelect) {
            blockSelect.addEventListener("change", function () {
                exec("formatBlock", "<" + blockSelect.value + ">");
            });
        }
        if (fontSelect) {
            fontSelect.addEventListener("change", function () {
                if (fontSelect.value) execStyled("fontName", fontSelect.value);
            });
        }
        if (sizeSelect) {
            sizeSelect.addEventListener("change", function () {
                var pt = Number(sizeSelect.value);
                if (pt) applyFontSize(pt);
            });
        }
        if (lineSelect) {
            lineSelect.addEventListener("change", function () {
                if (lineSelect.value) applyLineHeight(lineSelect.value);
            });
        }
        if (forePick) {
            forePick.addEventListener("input", function () {
                forePick.parentNode.style.color = forePick.value;
                execStyled("foreColor", forePick.value);
            });
        }
        if (hilitePick) {
            hilitePick.addEventListener("input", function () {
                hilitePick.parentNode.style.color = hilitePick.value;
                execStyled("hiliteColor", hilitePick.value);
            });
        }
        // Een klik op het kleurvak past de laatst gekozen kleur direct opnieuw toe.
        [forePick, hilitePick].forEach(function (picker) {
            if (!picker) return;
            picker.addEventListener("mousedown", rememberSelection);
        });
    }

    function closeExportMenu() {
        var menu = document.getElementById("wordExportMenu");
        var button = document.getElementById("wordExportButton");
        if (menu) menu.hidden = true;
        if (button) button.setAttribute("aria-expanded", "false");
    }

    async function importSelectedFile(file) {
        if (!file || !tools) return;
        try {
            var html = sanitizeWordHtml(await tools.importFile(file));
            if (editor.textContent.trim()) {
                var confirmed = window.confirm("\"" + file.name + "\" openen? Dit vervangt de huidige tekst. De huidige versie blijft bewaard onder Versies.");
                if (!confirmed) return;
            }
            editor.innerHTML = html;
            if (titleInput) titleInput.value = String(file.name || "").replace(/\.[^.]+$/, "").trim() || DEFAULT_TITLE;
            queueSave();
            tools.refreshNow();
            showToast("\"" + file.name + "\" geopend");
        } catch (error) {
            showToast(String(error && error.message || "Bestand openen mislukt."));
            console.error("Word-bestand openen mislukt:", error);
        }
    }

    function startNewDocument() {
        if (editor.textContent.trim()) {
            var confirmed = window.confirm("Nieuw leeg document starten? Het huidige document blijft terug te vinden onder Versies.");
            if (!confirmed) return;
        }
        editor.innerHTML = "";
        if (titleInput) titleInput.value = DEFAULT_TITLE;
        queueSave();
        if (tools) tools.refreshNow();
        editor.focus();
        if (titleInput) titleInput.select();
    }

    function setOutlineVisible(visible) {
        var outline = document.getElementById("wordOutline");
        var toggle = document.getElementById("wordToggleOutline");
        if (!outline) return;
        outline.hidden = !visible;
        if (toggle) toggle.setAttribute("aria-pressed", visible ? "true" : "false");
    }

    function bindDocumentActions() {
        var exportButton = document.getElementById("wordExportButton");
        var exportMenu = document.getElementById("wordExportMenu");
        var importButton = document.getElementById("wordImport");
        var importInput = document.getElementById("wordImportFile");
        var outlineToggle = document.getElementById("wordToggleOutline");
        var findOpen = document.getElementById("wordFindOpen");
        var newButton = document.getElementById("wordNew");
        var backupClose = document.getElementById("wordBackupClose");

        if (restoreBackupButton) restoreBackupButton.addEventListener("click", openBackupDialog);
        if (backupClose) backupClose.addEventListener("click", function () {
            document.getElementById("wordBackupDialog").close();
        });
        if (exportButton && exportMenu) {
            exportButton.addEventListener("click", function () {
                var open = exportMenu.hidden;
                exportMenu.hidden = !open;
                exportButton.setAttribute("aria-expanded", open ? "true" : "false");
                if (open) {
                    var first = exportMenu.querySelector(".word-menu-item");
                    if (first) first.focus();
                }
            });
            exportMenu.addEventListener("click", function (event) {
                var item = closestElement(event.target, "[data-export]");
                if (!item || !tools) return;
                closeExportMenu();
                tools.exportAs(item.getAttribute("data-export"));
            });
        }
        if (importButton && importInput) {
            importButton.addEventListener("click", function () {
                importInput.click();
            });
            importInput.addEventListener("change", function () {
                var file = importInput.files && importInput.files[0];
                importInput.value = "";
                void importSelectedFile(file);
            });
        }
        if (outlineToggle) {
            outlineToggle.addEventListener("click", function () {
                setOutlineVisible(outlineToggle.getAttribute("aria-pressed") !== "true");
            });
        }
        if (findOpen) findOpen.addEventListener("click", function () {
            if (tools) tools.openFind(false);
        });
        if (newButton) newButton.addEventListener("click", startNewDocument);
        if (titleInput) {
            titleInput.addEventListener("input", queueSave);
            titleInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    restoreSelection();
                }
            });
            titleInput.addEventListener("blur", function () {
                if (!titleInput.value.trim()) titleInput.value = DEFAULT_TITLE;
            });
        }

        document.addEventListener("click", function (event) {
            if (!closestElement(event.target, ".word-menu-wrap")) closeExportMenu();
            if (!closestElement(event.target, "#wordTablePicker, #wordTableButton")) if (tools) tools.closeTablePicker();
        });
    }

    /* ---------- Toetsenbord en plakken ---------- */

    function handleTab(event) {
        if (tools && tools.getCurrentCell()) {
            event.preventDefault();
            tools.moveCell(event.shiftKey);
            return;
        }
        var element = selectionElement();
        event.preventDefault();
        if (element && element.closest("li")) {
            exec(event.shiftKey ? "outdent" : "indent");
            return;
        }
        if (!event.shiftKey) exec("insertText", "    ");
    }

    function bindKeyboard() {
        document.addEventListener("keydown", function (event) {
            var mod = event.metaKey || event.ctrlKey;
            var key = String(event.key || "").toLowerCase();
            var inEditor = editor.contains(event.target);

            if (event.key === "Escape") {
                closeExportMenu();
                if (tools) tools.closeTablePicker();
                if (tools && tools.closeFind()) event.preventDefault();
                return;
            }
            if (!mod) {
                if (event.key === "Tab" && inEditor) handleTab(event);
                return;
            }
            if (key === "s") {
                event.preventDefault();
                void saveNow();
                return;
            }
            if (key === "p" && !event.shiftKey && tools) {
                event.preventDefault();
                tools.exportAs("pdf");
                return;
            }
            if (key === "f" && !event.shiftKey && tools) {
                event.preventDefault();
                tools.openFind(false);
                return;
            }
            if (key === "h" && event.ctrlKey && !event.metaKey && tools) {
                event.preventDefault();
                tools.openFind(true);
                return;
            }
            if (!inEditor) return;
            if (key === "k") {
                event.preventDefault();
                if (tools) tools.openLinkDialog();
            } else if (event.altKey && /^Digit[0-4]$/.test(event.code)) {
                event.preventDefault();
                var level = event.code.slice(-1);
                exec("formatBlock", level === "0" ? "<p>" : "<h" + level + ">");
            } else if (event.shiftKey && event.code === "Digit7") {
                event.preventDefault();
                exec("insertOrderedList");
            } else if (event.shiftKey && event.code === "Digit8") {
                event.preventDefault();
                exec("insertUnorderedList");
            } else if (event.code === "Backslash") {
                event.preventDefault();
                handleCommand("removeFormat");
            } else if (event.shiftKey && key === "v") {
                plainPasteNext = true;
            }
        });

        editor.addEventListener("paste", function (event) {
            var clipboard = event.clipboardData;
            if (!clipboard) return;
            var html = clipboard.getData("text/html");
            var text = clipboard.getData("text/plain");
            var plain = plainPasteNext;
            plainPasteNext = false;
            event.preventDefault();
            if (plain || !html) {
                if (text) runCommand("insertText", text, false);
            } else {
                runCommand("insertHTML", sanitizeWordHtml(html), false);
            }
            afterEdit();
        });

        editor.addEventListener("click", function (event) {
            var anchor = closestElement(event.target, "a[href]");
            if (anchor && (event.metaKey || event.ctrlKey) && isSafeHref(anchor.getAttribute("href"))) {
                event.preventDefault();
                window.open(anchor.getAttribute("href"), "_blank", "noopener");
            }
        });
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

    if (window.SoftoraWordTools) {
        tools = window.SoftoraWordTools.create({
            editor: editor,
            exec: exec,
            getHtml: getCurrentEditorHtml,
            getTitle: getDocTitle,
            afterEdit: afterEdit,
            isSafeHref: isSafeHref,
            notify: showToast,
            onChange: queueSave,
            rememberSelection: rememberSelection,
            restoreSelection: restoreSelection,
            selectionInEditor: selectionInEditor
        });
    }

    try {
        document.execCommand("defaultParagraphSeparator", false, "p");
    } catch (err) {
        /* ignore */
    }
    applyShortcutTitles();
    bindRibbon();
    bindDocumentActions();
    bindKeyboard();
    setOutlineVisible(window.innerWidth >= 1280);
    editor.addEventListener("focus", function () {
        if (editor.innerHTML.trim()) return;
        editor.innerHTML = "<p><br></p>";
        var range = document.createRange();
        range.setStart(editor.firstChild, 0);
        range.collapse(true);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
    });
    editor.addEventListener("input", function () {
        normalizeFontSizes();
        queueSave();
        if (tools) tools.refreshSoon();
    });
    document.addEventListener("selectionchange", function () {
        rememberSelection();
        scheduleToolbarState();
    });

    window.addEventListener("beforeunload", function (event) {
        window.clearTimeout(saveTimer);
        if (isDirty) void save();
        if (isDirty && (remoteLoadFailed || !remoteLoadComplete)) {
            event.preventDefault();
            event.returnValue = "";
        }
    });

    void (async function () {
        try {
            await loadInitialValue();
        } finally {
            if (tools) tools.refreshNow();
            finishPremiumBootShell();
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", finishPremiumBootShell, { once: true });
            }
        }
    })();
})();
