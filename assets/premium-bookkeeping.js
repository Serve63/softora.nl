(function () {
    "use strict";

    var year = new Date().getFullYear();
    var openId = null;
    var REMOTE_UI_STATE_SCOPE = "premium_bookkeeping";
    var REMOTE_UI_STATE_KEY = "softora_premium_bookkeeping_state_v1";
    var st = {};
    var toastTimer = 0;

    function getUiStateClient() {
        if (!window.SoftoraUiStateClient) throw new Error("SoftoraUiStateClient ontbreekt");
        return window.SoftoraUiStateClient;
    }

    function parseRemoteState(raw) {
        if (!raw) return {};
        try {
            var parsed = JSON.parse(String(raw));
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    async function loadRemoteState() {
        try {
            var state = await getUiStateClient().get(REMOTE_UI_STATE_SCOPE);
            st = parseRemoteState(state && state.values && state.values[REMOTE_UI_STATE_KEY]);
        } catch (error) {
            console.error("Boekhouding laden via Supabase mislukt:", error);
            showToast("Boekhouding kon niet centraal laden");
            st = {};
        }
    }

    async function save() {
        try {
            await getUiStateClient().set(REMOTE_UI_STATE_SCOPE, {
                patch: {
                    [REMOTE_UI_STATE_KEY]: JSON.stringify(st)
                },
                source: "premium-boekhouding",
                actor: "browser"
            });
        } catch (error) {
            console.error("Boekhouding opslaan via Supabase mislukt:", error);
            showToast("Opslaan naar Supabase mislukt");
        }
    }

    function entry(id) {
        var raw = st[id];
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return { checked: false, files: [], notes: "" };
        }

        return {
            checked: Boolean(raw.checked),
            files: Array.isArray(raw.files) ? raw.files : [],
            notes: String(raw.notes || "")
        };
    }

    function upd(id, data) {
        if (!id) return;
        st[id] = Object.assign({}, entry(id), data);
        void save();
    }

    var BTW_DEADLINE_COUNT = 35;
    var INCOME_TAX_DEADLINE_COUNT = 35;
    var BTW_START_YEAR = 2026;
    var INCOME_TAX_START_YEAR = 2025;

    function buildBtwAangiftes() {
        var quarters = [
            { quarter: 1, label: "1e kwartaal", months: "jan - mrt", deadlineSuffix: "04-30", deadlineYearOffset: 0 },
            { quarter: 2, label: "2e kwartaal", months: "apr - jun", deadlineSuffix: "07-31", deadlineYearOffset: 0 },
            { quarter: 3, label: "3e kwartaal", months: "jul - sep", deadlineSuffix: "10-31", deadlineYearOffset: 0 },
            { quarter: 4, label: "4e kwartaal", months: "okt - dec", deadlineSuffix: "01-31", deadlineYearOffset: 1 }
        ];

        return Array.from({ length: BTW_DEADLINE_COUNT }, function (_, index) {
            var periodYear = BTW_START_YEAR + Math.floor(index / 4);
            var quarter = quarters[index % 4];
            var deadlineYear = periodYear + quarter.deadlineYearOffset;

            return {
                id: "btw" + quarter.quarter + "-" + periodYear,
                naam: "BTW Aangifte",
                period: quarter.label + " " + periodYear + " (" + quarter.months + ")",
                deadline: deadlineYear + "-" + quarter.deadlineSuffix,
                cat: "Omzetbelasting (BTW)"
            };
        });
    }

    function buildIncomeTaxAangiftes() {
        return Array.from({ length: INCOME_TAX_DEADLINE_COUNT }, function (_, index) {
            var taxYear = INCOME_TAX_START_YEAR + index;

            return {
                id: "ib-" + taxYear,
                naam: "Inkomstenbelasting",
                period: "Belastingjaar " + taxYear,
                deadline: (taxYear + 1) + "-05-01",
                cat: "Inkomstenbelasting"
            };
        });
    }

    var ALL_AANGIFTES = buildBtwAangiftes()
        .concat(buildIncomeTaxAangiftes())
        .sort(function (a, b) { return new Date(a.deadline) - new Date(b.deadline); });
    var AVAILABLE_YEARS = Array.from(new Set(ALL_AANGIFTES.map(function (a) {
        return Number(String(a.deadline).slice(0, 4));
    }))).sort(function (a, b) { return a - b; });

    function clampYear(nextYear) {
        return Math.max(AVAILABLE_YEARS[0], Math.min(AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1], nextYear));
    }

    year = clampYear(year);

    function aangiftes(y) {
        return ALL_AANGIFTES.filter(function (a) {
            return Number(String(a.deadline).slice(0, 4)) === y;
        });
    }

    function daysLeft(deadline) {
        var now = new Date();
        now.setHours(0, 0, 0, 0);
        var target = new Date(deadline);
        target.setHours(0, 0, 0, 0);
        return Math.round((target - now) / 86400000);
    }

    function fmtDate(value) {
        if (!value) return "-";
        var parts = value.split("-");
        var months = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
        return parseInt(parts[2], 10) + " " + months[parts[1] - 1] + " " + parts[0];
    }

    function fmtSize(bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / 1048576).toFixed(1) + " MB";
    }

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function badge(id, deadline) {
        var e = entry(id);
        if (e.checked) return { cls: "badge-done", txt: "Ingediend" };
        var days = daysLeft(deadline);
        if (days < 0) return { cls: "badge-urgent", txt: "Verlopen" };
        if (days <= 14) return { cls: "badge-urgent", txt: "Nog " + days + " dagen" };
        if (days <= 30) return { cls: "badge-soon", txt: "Nog " + days + " dagen" };
        return { cls: "badge-future", txt: "Nog " + days + " dagen" };
    }

    function rowClass(id, deadline) {
        var e = entry(id);
        if (e.checked) return "done";
        return "";
    }

    function renderList() {
        var label = document.getElementById("year-label");
        var wrap = document.getElementById("list-wrap");
        if (!label || !wrap) return;

        label.textContent = year;
        var all = aangiftes(year);
        var undone = all.filter(function (a) { return !entry(a.id).checked; })
            .sort(function (a, b) { return new Date(a.deadline) - new Date(b.deadline); });
        var done = all.filter(function (a) { return entry(a.id).checked; })
            .sort(function (a, b) { return new Date(a.deadline) - new Date(b.deadline); });
        var html = "";

        if (undone.length) {
            Array.from(new Set(undone.map(function (a) { return a.cat; }))).forEach(function (cat) {
                var items = undone.filter(function (a) { return a.cat === cat; });
                if (cat !== "Overige Opgaven") {
                    html += "<div class=\"section-label\">" + escapeHtml(cat) + "</div>";
                }
                html += "<div class=\"aangifte-list\">";
                html += items.map(function (a) { return row(a); }).join("");
                html += "</div>";
            });
        }

        if (done.length) {
            html += "<div class=\"section-label\">Ingediend</div><div class=\"aangifte-list\">";
            html += done.map(function (a) { return row(a); }).join("");
            html += "</div>";
        }

        wrap.innerHTML = html;
    }

    function row(a) {
        var e = entry(a.id);
        var fileCount = (e.files || []).length;
        var b = badge(a.id, a.deadline);
        var checkedLabel = e.checked ? "Terugzetten naar openstaand" : "Markeren als ingediend";

        return "<div class=\"aangifte-row " + escapeHtml(rowClass(a.id, a.deadline)) + "\">"
            + "<div class=\"check-cell\">"
            + "<button class=\"check-box " + (e.checked ? "checked" : "") + "\" type=\"button\" data-bookkeeping-action=\"toggle-check\" data-bookkeeping-id=\"" + escapeHtml(a.id) + "\" aria-label=\"" + escapeHtml(checkedLabel + ": " + a.naam + " " + a.period) + "\">"
            + "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\"><polyline points=\"20 6 9 17 4 12\"/></svg>"
            + "</button>"
            + "</div>"
            + "<div class=\"info-cell\">"
            + "<div class=\"row-name\">" + escapeHtml(a.naam) + "</div>"
            + "<div class=\"row-period\">" + escapeHtml(a.period) + "</div>"
            + "</div>"
            + "<div class=\"files-cell\"><strong>" + fileCount + "</strong>bestand" + (fileCount !== 1 ? "en" : "") + "</div>"
            + "<div class=\"deadline-cell\">"
            + "<div class=\"dl-label\">Deadline</div>"
            + "<div class=\"dl-date\">" + escapeHtml(fmtDate(a.deadline)) + "</div>"
            + "</div>"
            + "<div class=\"badge-cell\"><span class=\"badge " + escapeHtml(b.cls) + "\">" + escapeHtml(b.txt) + "</span></div>"
            + "</div>";
    }

    function toggleCheck(id) {
        var e = entry(id);
        upd(id, { checked: !e.checked });
        renderList();
        showToast(!e.checked ? "Gemarkeerd als ingediend" : "Teruggezet naar openstaand");
    }

    function changeYear(delta) {
        year = clampYear(year + delta);
        renderList();
    }

    function openMap(id) {
        openId = id;
        var a = ALL_AANGIFTES.find(function (item) { return item.id === id; });
        if (!a) return;
        var e = entry(id);

        document.getElementById("map-title").textContent = a.naam;
        document.getElementById("map-period").textContent = a.period || "";
        document.getElementById("notes-ta").value = e.notes || "";
        renderFiles();

        document.getElementById("screen-overzicht").classList.remove("active");
        document.getElementById("screen-map").classList.add("active");
        window.scrollTo(0, 0);
    }

    function renderFiles() {
        var e = entry(openId);
        var files = e.files || [];
        var grid = document.getElementById("files-grid");
        var count = document.getElementById("files-count");
        if (!grid || !count) return;

        count.textContent = files.length + " bestand" + (files.length !== 1 ? "en" : "");

        if (!files.length) {
            grid.innerHTML = "<div class=\"files-empty\" style=\"grid-column:1/-1\">"
                + "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\"><path d=\"M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z\"/><polyline points=\"14 2 14 8 20 8\"/></svg>"
                + "<p>Nog geen bestanden - sleep ze hierheen of klik op toevoegen</p>"
                + "</div>";
            return;
        }

        var extCol = { pdf: "#c0392b", xlsx: "#16733c", xls: "#16733c", csv: "#16733c", docx: "#1a5f8a", doc: "#1a5f8a", jpg: "#b45a00", jpeg: "#b45a00", png: "#b45a00", pptx: "#c0392b" };

        grid.innerHTML = files.map(function (file, index) {
            var name = String(file.name || "bestand");
            var ext = name.split(".").pop().toLowerCase();
            var col = extCol[ext] || "#888";

            return "<div class=\"file-tile\" data-bookkeeping-action=\"open-file\" data-file-index=\"" + index + "\" role=\"button\" tabindex=\"0\">"
                + "<button class=\"file-del\" type=\"button\" data-bookkeeping-action=\"delete-file\" data-file-index=\"" + index + "\" aria-label=\"" + escapeHtml("Verwijder " + name) + "\">"
                + "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/></svg>"
                + "</button>"
                + "<div class=\"file-doc\">"
                + "<svg class=\"doc-bg\" viewBox=\"0 0 40 48\" fill=\"none\">"
                + "<path d=\"M0 4C0 1.79086 1.79086 0 4 0H26L40 14V44C40 46.2091 38.2091 48 36 48H4C1.79086 48 0 46.2091 0 44V4Z\" fill=\"" + col + "15\" stroke=\"" + col + "35\" stroke-width=\"1.2\"/>"
                + "<path d=\"M26 0L40 14H30C27.7909 14 26 12.2091 26 10V0Z\" fill=\"" + col + "35\"/>"
                + "</svg>"
                + "<div class=\"file-doc-ext\">" + escapeHtml(ext) + "</div>"
                + "</div>"
                + "<div class=\"file-name\" title=\"" + escapeHtml(name) + "\">" + escapeHtml(name) + "</div>"
                + "<div class=\"file-size\">" + escapeHtml(file.size) + "</div>"
                + "</div>";
        }).join("");
    }

    function openFile(index) {
        var f = (entry(openId).files || [])[index];
        if (!f) return;
        if (f.url) {
            var link = document.createElement("a");
            link.href = f.url;
            link.download = f.name;
            link.click();
        }
        showToast("Bestand geopend: " + f.name);
    }

    function delFile(index) {
        var e = entry(openId);
        var files = (e.files || []).slice();
        var name = files[index] && files[index].name;
        files.splice(index, 1);
        upd(openId, { files: files });
        renderFiles();
        renderList();
        showToast((name || "Bestand") + " verwijderd");
    }

    function addFiles(list) {
        var e = entry(openId);
        var files = (e.files || []).slice();
        var addedCount = 0;
        var readers = Array.from(list || []).map(function (file) {
            return new Promise(function (resolve) {
                var reader = new FileReader();
                reader.onload = function (event) {
                    files.push({ name: file.name, size: fmtSize(file.size), url: event.target.result });
                    addedCount += 1;
                    resolve();
                };
                reader.onerror = function () {
                    resolve();
                };
                reader.readAsDataURL(file);
            });
        });

        Promise.all(readers).then(function () {
            upd(openId, { files: files });
            renderFiles();
            renderList();
            showToast(addedCount + " bestand" + (addedCount !== 1 ? "en" : "") + " toegevoegd");
        });
    }

    function saveNotes() {
        var notes = document.getElementById("notes-ta");
        upd(openId, { notes: notes ? notes.value : "" });
        showToast("Notities opgeslagen");
    }

    function goBack() {
        openId = null;
        document.getElementById("screen-map").classList.remove("active");
        document.getElementById("screen-overzicht").classList.add("active");
        renderList();
        window.scrollTo(0, 0);
    }

    function showToast(message) {
        var toast = document.getElementById("toast");
        if (!toast) return;
        window.clearTimeout(toastTimer);
        toast.textContent = message;
        toast.classList.add("show");
        toastTimer = window.setTimeout(function () { toast.classList.remove("show"); }, 2500);
    }

    function triggerUpload() {
        var input = document.getElementById("file-inp");
        if (input) input.click();
    }

    function handleAction(actionEl, event) {
        var action = actionEl.getAttribute("data-bookkeeping-action");
        switch (action) {
            case "year-prev":
                changeYear(-1);
                break;
            case "year-next":
                changeYear(1);
                break;
            case "back":
                goBack();
                break;
            case "upload":
                triggerUpload();
                break;
            case "save-notes":
                saveNotes();
                break;
            case "toggle-check":
                event.stopPropagation();
                toggleCheck(actionEl.getAttribute("data-bookkeeping-id"));
                break;
            case "open-file":
                openFile(Number(actionEl.getAttribute("data-file-index")));
                break;
            case "delete-file":
                event.stopPropagation();
                delFile(Number(actionEl.getAttribute("data-file-index")));
                break;
        }
    }

    function handleDocumentClick(event) {
        var actionEl = event.target && event.target.closest
            ? event.target.closest("[data-bookkeeping-action]")
            : null;
        if (!actionEl) return;
        handleAction(actionEl, event);
    }

    function handleDocumentKeydown(event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        var actionEl = event.target && event.target.closest
            ? event.target.closest("[data-bookkeeping-action][role=\"button\"]")
            : null;
        if (!actionEl) return;
        event.preventDefault();
        handleAction(actionEl, event);
    }

    function bindEvents() {
        document.addEventListener("click", handleDocumentClick);
        document.addEventListener("keydown", handleDocumentKeydown);

        var input = document.getElementById("file-inp");
        if (input) {
            input.addEventListener("change", function () {
                addFiles(input.files);
                input.value = "";
            });
        }
    }

    function finishPremiumShellBoot() {
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

    bindEvents();

    void (async function () {
        try {
            await loadRemoteState();
            renderList();
        } finally {
            finishPremiumShellBoot();
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", finishPremiumShellBoot, { once: true });
            }
        }
    })();
})();
