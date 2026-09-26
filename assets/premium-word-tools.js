(function () {
    "use strict";

    // Losse editorhulpmiddelen voor Softora Word: tabellen, zoeken & vervangen,
    // navigatie, telling, zoom, import en export. Opslag zit in premium-word.js.
    var MAMMOTH_SRC = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js";
    var PAGE_CONTENT_HEIGHT = 931;
    var FIND_HIGHLIGHT = "softora-word-find";
    var FIND_CURRENT_HIGHLIGHT = "softora-word-find-current";
    var EXPORT_STYLES = [
        "body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5;color:#111827;}",
        "h1{font-size:20pt;margin:12pt 0 6pt;}h2{font-size:15pt;margin:12pt 0 4pt;}",
        "h3{font-size:12.5pt;margin:10pt 0 4pt;}h4{font-size:11pt;margin:10pt 0 4pt;}",
        "p{margin:0 0 8pt;}ul,ol{margin:0 0 8pt;}",
        "blockquote{margin:0 0 8pt;padding-left:12pt;border-left:3px solid #cbd5e1;color:#475569;}",
        "pre{font-family:Consolas,monospace;font-size:10pt;background:#f3f4f6;padding:8pt;white-space:pre-wrap;}",
        "table{border-collapse:collapse;width:100%;margin:0 0 8pt;}",
        "td,th{border:1px solid #94a3b8;padding:4pt 6pt;vertical-align:top;}th{background:#f1f5f9;text-align:left;}",
        "hr{border:0;border-top:1px solid #cbd5e1;}a{color:#2563eb;}"
    ].join("");

    function byId(id) {
        return document.getElementById(id);
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function textToHtml(text) {
        var blocks = String(text || "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
        return blocks
            .map(function (block) {
                var lines = block.split("\n").map(escapeHtml).join("<br>");
                return lines.trim() ? "<p>" + lines + "</p>" : "";
            })
            .join("");
    }

    function safeFileName(title) {
        var name = String(title || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
        return (name || "document").slice(0, 100);
    }

    function downloadBlob(blob, fileName) {
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 4000);
    }

    function loadMammoth() {
        if (window.mammoth) return Promise.resolve(window.mammoth);
        return new Promise(function (resolve, reject) {
            var script = document.createElement("script");
            script.src = MAMMOTH_SRC;
            script.async = true;
            script.onload = function () {
                if (window.mammoth) resolve(window.mammoth);
                else reject(new Error("Word-lezer kon niet starten."));
            };
            script.onerror = function () {
                reject(new Error("Word-lezer kon niet geladen worden. Controleer je internetverbinding."));
            };
            document.head.appendChild(script);
        });
    }

    function create(options) {
        var editor = options.editor;
        var page = byId("wordPage");
        var onChange = options.onChange || function () {};
        var getTitle = options.getTitle || function () { return "document"; };
        var getHtml = options.getHtml || function () { return editor.innerHTML; };
        var exec = options.exec;
        var notify = options.notify || function () {};
        var restoreSelection = options.restoreSelection;
        var rememberSelection = options.rememberSelection;
        var selectionInEditor = options.selectionInEditor;
        var afterEdit = options.afterEdit;
        var isSafeHref = options.isSafeHref;

        var tableBar = byId("wordTableBar");
        var findBar = byId("wordFindBar");
        var findInput = byId("wordFindInput");
        var replaceInput = byId("wordReplaceInput");
        var findCase = byId("wordFindCase");
        var findCount = byId("wordFindCount");
        var outlineList = byId("wordOutlineList");
        var countsEl = byId("wordCounts");
        var pagesEl = byId("wordPages");
        var zoomInput = byId("wordZoom");
        var zoomLabel = byId("wordZoomLabel");
        var refreshTimer = 0;
        var zoomFactor = 1;
        var findMatches = [];
        var findIndex = -1;

        function selectionElement() {
            var selection = window.getSelection();
            if (!selection || !selection.rangeCount) return null;
            var node = selection.getRangeAt(0).startContainer;
            if (node && node.nodeType === 3) node = node.parentNode;
            return node && editor.contains(node) ? node : null;
        }

        function placeCaret(element, atEnd) {
            if (!element) return;
            var range = document.createRange();
            range.selectNodeContents(element);
            range.collapse(!atEnd);
            var selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }

        function emptyCell(tagName) {
            var cell = document.createElement(tagName || "td");
            cell.appendChild(document.createElement("br"));
            return cell;
        }

        /* ---------- Tabellen ---------- */

        function getCurrentCell() {
            var element = selectionElement();
            var cell = element && element.closest("td, th");
            return cell && editor.contains(cell) ? cell : null;
        }

        function buildTableHtml(rows, cols) {
            var html = "<table><tbody>";
            for (var r = 0; r < rows; r += 1) {
                html += "<tr>";
                for (var c = 0; c < cols; c += 1) html += "<td><br></td>";
                html += "</tr>";
            }
            return html + "</tbody></table><p><br></p>";
        }

        function insertTable(rows, cols) {
            exec("insertHTML", buildTableHtml(rows, cols));
            refreshNow();
        }

        function swapCellTag(cell, tagName) {
            var next = document.createElement(tagName);
            while (cell.firstChild) next.appendChild(cell.firstChild);
            if (cell.getAttribute("style")) next.setAttribute("style", cell.getAttribute("style"));
            cell.replaceWith(next);
            return next;
        }

        function tableAction(action) {
            var cell = getCurrentCell();
            if (!cell) return;
            var row = cell.parentNode;
            var table = cell.closest("table");
            var rows = Array.prototype.slice.call(table.rows);
            var index = cell.cellIndex;
            var focusCell = null;

            if (action === "row-above" || action === "row-below") {
                var newRow = document.createElement("tr");
                Array.prototype.forEach.call(row.cells, function () {
                    newRow.appendChild(emptyCell("td"));
                });
                row.parentNode.insertBefore(newRow, action === "row-above" ? row : row.nextSibling);
                focusCell = newRow.cells[Math.min(index, newRow.cells.length - 1)];
            } else if (action === "col-left" || action === "col-right") {
                rows.forEach(function (tableRow) {
                    var reference = tableRow.cells[index];
                    var tag = reference ? reference.tagName.toLowerCase() : "td";
                    var added = emptyCell(tag);
                    if (!reference) tableRow.appendChild(added);
                    else tableRow.insertBefore(added, action === "col-left" ? reference : reference.nextSibling);
                    if (tableRow === row) focusCell = added;
                });
            } else if (action === "row-delete") {
                if (rows.length <= 1) return tableAction("table-delete");
                var sibling = row.nextElementSibling || row.previousElementSibling;
                row.remove();
                focusCell = sibling && sibling.cells[Math.min(index, sibling.cells.length - 1)];
            } else if (action === "col-delete") {
                if (row.cells.length <= 1) return tableAction("table-delete");
                rows.forEach(function (tableRow) {
                    if (tableRow.cells[index]) tableRow.cells[index].remove();
                });
                focusCell = row.cells[Math.max(0, index - 1)];
            } else if (action === "header") {
                var firstRow = table.rows[0];
                var makeHeader = firstRow.cells[0] && firstRow.cells[0].tagName !== "TH";
                Array.prototype.slice.call(firstRow.cells).forEach(function (headerCell) {
                    var swapped = swapCellTag(headerCell, makeHeader ? "th" : "td");
                    if (headerCell === cell) focusCell = swapped;
                });
                if (!focusCell) focusCell = cell;
            } else if (action === "table-delete") {
                var after = document.createElement("p");
                after.appendChild(document.createElement("br"));
                table.replaceWith(after);
                placeCaret(after, false);
            }

            if (focusCell) placeCaret(focusCell, true);
            onChange();
            refreshNow();
        }

        function moveCell(backwards) {
            var cell = getCurrentCell();
            if (!cell) return false;
            var table = cell.closest("table");
            var cells = Array.prototype.slice.call(table.querySelectorAll("td, th"));
            var next = cells[cells.indexOf(cell) + (backwards ? -1 : 1)];
            if (!next && !backwards) {
                tableAction("row-below");
                return true;
            }
            if (next) placeCaret(next, true);
            return true;
        }

        function bindTableBar() {
            if (!tableBar) return;
            tableBar.addEventListener("mousedown", function (event) {
                if (event.target.closest("[data-table-action]")) event.preventDefault();
            });
            tableBar.addEventListener("click", function (event) {
                var button = event.target.closest("[data-table-action]");
                if (button) tableAction(button.getAttribute("data-table-action"));
            });
        }

        function updateTableBar() {
            if (tableBar) tableBar.hidden = !getCurrentCell();
        }

        /* ---------- Zoeken en vervangen ---------- */

        function supportsHighlights() {
            return Boolean(window.CSS && CSS.highlights && typeof window.Highlight === "function");
        }

        function setHighlights() {
            if (!supportsHighlights()) return;
            CSS.highlights.delete(FIND_HIGHLIGHT);
            CSS.highlights.delete(FIND_CURRENT_HIGHLIGHT);
            if (!findMatches.length) return;
            var all = new window.Highlight();
            findMatches.forEach(function (range) {
                all.add(range);
            });
            CSS.highlights.set(FIND_HIGHLIGHT, all);
            if (findMatches[findIndex]) {
                var current = new window.Highlight();
                current.add(findMatches[findIndex]);
                CSS.highlights.set(FIND_CURRENT_HIGHLIGHT, current);
            }
        }

        function computeMatches() {
            findMatches = [];
            var query = findInput ? findInput.value : "";
            if (query) {
                var caseSensitive = Boolean(findCase && findCase.checked);
                var needle = caseSensitive ? query : query.toLowerCase();
                var walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
                var node = walker.nextNode();
                while (node) {
                    var haystack = caseSensitive ? node.nodeValue : node.nodeValue.toLowerCase();
                    var from = 0;
                    var position = haystack.indexOf(needle, from);
                    while (position !== -1) {
                        var range = document.createRange();
                        range.setStart(node, position);
                        range.setEnd(node, position + needle.length);
                        findMatches.push(range);
                        from = position + needle.length;
                        position = haystack.indexOf(needle, from);
                    }
                    node = walker.nextNode();
                }
            }
            if (findIndex >= findMatches.length) findIndex = findMatches.length ? 0 : -1;
            if (findIndex < 0 && findMatches.length) findIndex = 0;
            updateFindUi();
        }

        function updateFindUi() {
            if (findCount) {
                var query = findInput ? findInput.value : "";
                findCount.textContent = !query
                    ? ""
                    : findMatches.length
                        ? (findIndex + 1) + " van " + findMatches.length
                        : "Geen resultaten";
            }
            setHighlights();
        }

        function revealMatch() {
            var range = findMatches[findIndex];
            if (!range) return;
            var element = range.startContainer.parentElement;
            if (element && typeof element.scrollIntoView === "function") {
                element.scrollIntoView({ block: "center", behavior: "smooth" });
            }
        }

        function stepFind(backwards) {
            if (!findMatches.length) computeMatches();
            if (!findMatches.length) return;
            findIndex = (findIndex + (backwards ? -1 : 1) + findMatches.length) % findMatches.length;
            updateFindUi();
            revealMatch();
        }

        function replaceRange(range, replacement) {
            range.deleteContents();
            if (replacement) range.insertNode(document.createTextNode(replacement));
        }

        function replaceCurrent() {
            if (!findMatches[findIndex]) return;
            replaceRange(findMatches[findIndex], replaceInput ? replaceInput.value : "");
            editor.normalize();
            onChange();
            var keepIndex = findIndex;
            computeMatches();
            findIndex = findMatches.length ? Math.min(keepIndex, findMatches.length - 1) : -1;
            updateFindUi();
            revealMatch();
            refreshNow();
        }

        function replaceAll() {
            if (!findMatches.length) computeMatches();
            var total = findMatches.length;
            if (!total) return;
            var replacement = replaceInput ? replaceInput.value : "";
            for (var i = findMatches.length - 1; i >= 0; i -= 1) replaceRange(findMatches[i], replacement);
            editor.normalize();
            onChange();
            computeMatches();
            refreshNow();
            notify(total + " keer vervangen");
        }

        function openFind(focusReplace) {
            if (!findBar) return;
            findBar.hidden = false;
            var selection = window.getSelection();
            var selected = selection && selection.rangeCount && editor.contains(selection.anchorNode)
                ? selection.toString()
                : "";
            if (selected && selected.length < 120 && selected.indexOf("\n") === -1) findInput.value = selected;
            computeMatches();
            var target = focusReplace ? replaceInput : findInput;
            target.focus();
            target.select();
        }

        function closeFind() {
            if (!findBar || findBar.hidden) return false;
            var current = findMatches[findIndex];
            findBar.hidden = true;
            findMatches = [];
            findIndex = -1;
            if (supportsHighlights()) {
                CSS.highlights.delete(FIND_HIGHLIGHT);
                CSS.highlights.delete(FIND_CURRENT_HIGHLIGHT);
            }
            editor.focus({ preventScroll: true });
            if (current && editor.contains(current.startContainer)) {
                var selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(current);
            }
            return true;
        }

        function bindFind() {
            if (!findBar) return;
            findInput.addEventListener("input", function () {
                findIndex = 0;
                computeMatches();
                revealMatch();
            });
            findInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    stepFind(event.shiftKey);
                }
            });
            replaceInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    replaceCurrent();
                }
            });
            if (findCase) findCase.addEventListener("change", computeMatches);
            byId("wordFindNext").addEventListener("click", function () { stepFind(false); });
            byId("wordFindPrev").addEventListener("click", function () { stepFind(true); });
            byId("wordReplaceOne").addEventListener("click", replaceCurrent);
            byId("wordReplaceAll").addEventListener("click", replaceAll);
            byId("wordFindClose").addEventListener("click", closeFind);
        }

        /* ---------- Navigatie, telling en zoom ---------- */

        function renderOutline() {
            if (!outlineList) return;
            var headings = editor.querySelectorAll("h1, h2, h3, h4");
            outlineList.textContent = "";
            if (!headings.length) {
                var empty = document.createElement("li");
                empty.className = "word-outline-empty";
                empty.textContent = "Geef tekst de stijl Kop 1, 2 of 3; die koppen verschijnen hier als inhoudsopgave.";
                outlineList.appendChild(empty);
                return;
            }
            Array.prototype.forEach.call(headings, function (heading) {
                var item = document.createElement("li");
                var button = document.createElement("button");
                button.type = "button";
                button.className = "word-outline-item";
                button.setAttribute("data-level", heading.tagName.charAt(1));
                button.textContent = heading.textContent.trim() || "(lege kop)";
                button.title = button.textContent;
                button.addEventListener("click", function () {
                    heading.scrollIntoView({ block: "start", behavior: "smooth" });
                    editor.focus({ preventScroll: true });
                    placeCaret(heading, true);
                });
                item.appendChild(button);
                outlineList.appendChild(item);
            });
        }

        function updateCounts() {
            var text = editor.innerText || "";
            var words = (text.match(/\S+/g) || []).length;
            var chars = text.replace(/\n/g, "").length;
            if (countsEl) {
                countsEl.textContent = words.toLocaleString("nl-NL") + (words === 1 ? " woord" : " woorden")
                    + " · " + chars.toLocaleString("nl-NL") + " tekens";
            }
            if (pagesEl) {
                var height = editor.getBoundingClientRect().height / (zoomFactor || 1);
                var pages = Math.max(1, Math.ceil((height - 4) / PAGE_CONTENT_HEIGHT));
                pagesEl.textContent = pages === 1 ? "1 pagina" : "± " + pages + " pagina's";
            }
            editor.classList.toggle("is-empty", !text.trim() && !editor.querySelector("table, hr, li"));
        }

        function setZoom(percent) {
            var value = Math.max(50, Math.min(200, Math.round(Number(percent) / 10) * 10 || 100));
            zoomFactor = value / 100;
            if (page) page.style.zoom = String(zoomFactor);
            if (zoomInput) zoomInput.value = String(value);
            if (zoomLabel) zoomLabel.textContent = value + "%";
        }

        function bindZoom() {
            if (zoomInput) zoomInput.addEventListener("input", function () { setZoom(zoomInput.value); });
            var zoomOut = byId("wordZoomOut");
            var zoomIn = byId("wordZoomIn");
            if (zoomOut) zoomOut.addEventListener("click", function () { setZoom(zoomFactor * 100 - 10); });
            if (zoomIn) zoomIn.addEventListener("click", function () { setZoom(zoomFactor * 100 + 10); });
        }

        function refreshNow() {
            window.clearTimeout(refreshTimer);
            renderOutline();
            updateCounts();
            updateTableBar();
            if (findBar && !findBar.hidden) computeMatches();
        }

        function refreshSoon() {
            window.clearTimeout(refreshTimer);
            refreshTimer = window.setTimeout(refreshNow, 180);
        }

        /* ---------- Import en export ---------- */

        async function importFile(file) {
            var name = String(file && file.name || "").toLowerCase();
            if (/\.docx$/.test(name)) {
                var mammoth = await loadMammoth();
                var result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
                return String(result && result.value || "");
            }
            if (/\.html?$/.test(name)) {
                // Ruwe HTML; premium-word.js haalt alles door sanitizeWordHtml voordat het in de editor komt.
                return await file.text();
            }
            if (/\.(txt|md|markdown)$/.test(name) || /^text\/plain/.test(file.type)) {
                return textToHtml(await file.text());
            }
            if (/\.doc$/.test(name)) {
                throw new Error("Oude .doc-bestanden worden niet ondersteund. Sla het bestand in Word op als .docx.");
            }
            throw new Error("Dit bestandstype wordt niet ondersteund. Gebruik .docx, .html of .txt.");
        }

        function buildExportDocument(forWord) {
            var title = escapeHtml(getTitle());
            var body = getHtml();
            if (forWord) {
                return "<html xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:w=\"urn:schemas-microsoft-com:office:word\" xmlns=\"http://www.w3.org/TR/REC-html40\">"
                    + "<head><meta charset=\"utf-8\"><title>" + title + "</title>"
                    + "<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->"
                    + "<style>@page{size:21cm 29.7cm;margin:2.5cm;}" + EXPORT_STYLES + "</style></head><body>" + body + "</body></html>";
            }
            return "<!DOCTYPE html><html lang=\"nl\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
                + "<title>" + title + "</title><style>body{max-width:720px;margin:48px auto;padding:0 24px;}" + EXPORT_STYLES + "</style></head><body>"
                + body + "</body></html>";
        }

        function printDocument() {
            var previousTitle = document.title;
            document.title = safeFileName(getTitle());
            window.addEventListener("afterprint", function restoreTitle() {
                document.title = previousTitle;
                window.removeEventListener("afterprint", restoreTitle);
            });
            window.print();
        }

        function exportAs(kind) {
            var fileName = safeFileName(getTitle());
            if (kind === "pdf") {
                printDocument();
                return;
            }
            if (kind === "doc") {
                downloadBlob(new Blob(["﻿", buildExportDocument(true)], { type: "application/msword" }), fileName + ".doc");
            } else if (kind === "html") {
                downloadBlob(new Blob([buildExportDocument(false)], { type: "text/html;charset=utf-8" }), fileName + ".html");
            } else if (kind === "txt") {
                downloadBlob(new Blob([editor.innerText || ""], { type: "text/plain;charset=utf-8" }), fileName + ".txt");
            } else {
                return;
            }
            notify("Download gestart: " + fileName);
        }

        /* ---------- Links ---------- */

        var linkAnchor = null;

        function normalizeLinkUrl(value) {
            var url = String(value || "").trim();
            if (!url) return "";
            if (/^(https?:\/\/|mailto:|tel:|#)/i.test(url)) return url;
            if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(url)) return "mailto:" + url;
            if (/^\+?[\d\s()-]{6,}$/.test(url)) return "tel:" + url.replace(/[^\d+]/g, "");
            return "https://" + url.replace(/^\/+/, "");
        }

        function openLinkDialog() {
            var dialog = document.getElementById("wordLinkDialog");
            if (!dialog) return;
            rememberSelection();
            var element = selectionElement();
            linkAnchor = element ? element.closest("a") : null;
            var selection = window.getSelection();
            document.getElementById("wordLinkText").value = linkAnchor
                ? linkAnchor.textContent
                : (selectionInEditor() ? selection.toString() : "");
            document.getElementById("wordLinkUrl").value = linkAnchor ? String(linkAnchor.getAttribute("href") || "") : "";
            document.getElementById("wordLinkError").textContent = "";
            document.getElementById("wordLinkRemove").hidden = !linkAnchor;
            document.getElementById("wordLinkDialogTitle").textContent = linkAnchor ? "Link bewerken" : "Link invoegen";
            dialog.showModal();
            document.getElementById("wordLinkUrl").focus();
        }

        function submitLink(event) {
            event.preventDefault();
            var dialog = document.getElementById("wordLinkDialog");
            var url = normalizeLinkUrl(document.getElementById("wordLinkUrl").value);
            var text = String(document.getElementById("wordLinkText").value || "").trim();
            var errorEl = document.getElementById("wordLinkError");
            if (!url || !isSafeHref(url)) {
                errorEl.textContent = "Vul een geldig webadres, e-mailadres of telefoonnummer in.";
                return;
            }
            dialog.close();
            restoreSelection();
            if (linkAnchor && editor.contains(linkAnchor)) {
                linkAnchor.setAttribute("href", url);
                if (text && text !== linkAnchor.textContent) linkAnchor.textContent = text;
                afterEdit();
            } else {
                var selection = window.getSelection();
                var selectedText = selection ? selection.toString() : "";
                if (!selectedText || (text && text !== selectedText)) {
                    exec("insertHTML", '<a href="' + escapeHtml(url) + '">' + escapeHtml(text || url.replace(/^(mailto:|tel:)/, "")) + "</a>&nbsp;");
                } else {
                    exec("createLink", url);
                }
            }
            linkAnchor = null;
        }

        function removeLink() {
            var dialog = document.getElementById("wordLinkDialog");
            if (dialog) dialog.close();
            if (linkAnchor && editor.contains(linkAnchor)) {
                while (linkAnchor.firstChild) linkAnchor.parentNode.insertBefore(linkAnchor.firstChild, linkAnchor);
                linkAnchor.remove();
            }
            linkAnchor = null;
            restoreSelection();
            afterEdit();
        }

        function bindLinkDialog() {
            var form = document.getElementById("wordLinkForm");
            if (!form) return;
            form.addEventListener("submit", submitLink);
            document.getElementById("wordLinkCancel").addEventListener("click", function () {
                document.getElementById("wordLinkDialog").close();
                restoreSelection();
            });
            document.getElementById("wordLinkRemove").addEventListener("click", removeLink);
        }

        /* ---------- Tabelkiezer ---------- */

        function bindTablePicker() {
            var picker = document.getElementById("wordTablePicker");
            var grid = document.getElementById("wordTableGrid");
            var label = document.getElementById("wordTableLabel");
            var button = document.getElementById("wordTableButton");
            if (!picker || !grid || !button) return;
            for (var r = 1; r <= 8; r += 1) {
                for (var c = 1; c <= 8; c += 1) {
                    var cell = document.createElement("button");
                    cell.type = "button";
                    cell.className = "word-table-cell";
                    cell.setAttribute("data-rows", String(r));
                    cell.setAttribute("data-cols", String(c));
                    cell.setAttribute("aria-label", r + " bij " + c + " tabel");
                    grid.appendChild(cell);
                }
            }
            grid.addEventListener("mouseover", function (event) {
                var target = (event.target.closest ? event.target.closest(".word-table-cell") : null);
                if (!target) return;
                var rows = Number(target.getAttribute("data-rows"));
                var cols = Number(target.getAttribute("data-cols"));
                Array.prototype.forEach.call(grid.children, function (item) {
                    item.classList.toggle("is-on", Number(item.getAttribute("data-rows")) <= rows && Number(item.getAttribute("data-cols")) <= cols);
                });
                label.textContent = rows + " × " + cols + " tabel";
            });
            grid.addEventListener("mousedown", function (event) {
                event.preventDefault();
            });
            grid.addEventListener("click", function (event) {
                var target = (event.target.closest ? event.target.closest(".word-table-cell") : null);
                if (!target) return;
                closeTablePicker();
                insertTable(Number(target.getAttribute("data-rows")), Number(target.getAttribute("data-cols")));
            });
        }

        function toggleTablePicker() {
            var picker = document.getElementById("wordTablePicker");
            var button = document.getElementById("wordTableButton");
            var app = document.getElementById("wordApp");
            if (!picker || !button || !app) return;
            if (!picker.hidden) {
                closeTablePicker();
                return;
            }
            var buttonRect = button.getBoundingClientRect();
            var appRect = app.getBoundingClientRect();
            picker.style.left = Math.max(8, buttonRect.left - appRect.left - 60) + "px";
            picker.style.top = (buttonRect.bottom - appRect.top + 6) + "px";
            picker.hidden = false;
            button.setAttribute("aria-expanded", "true");
        }

        function closeTablePicker() {
            var picker = document.getElementById("wordTablePicker");
            var button = document.getElementById("wordTableButton");
            if (picker) picker.hidden = true;
            if (button) button.setAttribute("aria-expanded", "false");
        }

        bindFind();
        bindTableBar();
        bindZoom();
        bindLinkDialog();
        bindTablePicker();
        setZoom(100);

        return {
            closeFind: closeFind,
            closeTablePicker: closeTablePicker,
            openLinkDialog: openLinkDialog,
            toggleTablePicker: toggleTablePicker,
            exportAs: exportAs,
            getCurrentCell: getCurrentCell,
            importFile: importFile,
            insertTable: insertTable,
            moveCell: moveCell,
            openFind: openFind,
            refreshNow: refreshNow,
            refreshSoon: refreshSoon,
            tableAction: tableAction,
            updateTableBar: updateTableBar
        };
    }

    window.SoftoraWordTools = { create: create };
})();
