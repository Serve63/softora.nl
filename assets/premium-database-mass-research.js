(function (global) {
    "use strict";

    const DEFAULT_LOCATIONS = [
        "bedrijven in Oisterwijk",
        "bedrijven in Tilburg",
        "bedrijven in Vught",
        "bedrijven in Boxtel"
    ].join("\n");

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function parseLocations(value) {
        return Array.from(new Set(normalizeString(value).split(/\r?\n|,/).map(normalizeString).filter(Boolean))).slice(0, 80);
    }

    function parsePositiveInt(value, fallback, min, max) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(min, Math.min(max, Math.floor(parsed)));
    }

    function requestJson(url, options) {
        return fetch(url, {
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            ...(options || {})
        }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (body) {
                if (!response.ok || body.ok === false) throw new Error(body.error || "Massaal zoeken mislukt.");
                return body;
            });
        });
    }

    function ensureStyles() {
        if (document.getElementById("softora-mass-research-style")) return;
        const style = document.createElement("style");
        style.id = "softora-mass-research-style";
        style.textContent = [
            ".mass-research-modal{width:min(760px,calc(100vw - 24px));max-height:calc(100vh - 34px);overflow:auto}",
            ".mass-research-grid{display:grid;gap:12px}",
            ".mass-research-row{display:grid;grid-template-columns:1fr 150px;gap:10px}",
            ".mass-research-row input,.mass-research-grid textarea{width:100%}",
            ".mass-research-grid textarea{min-height:136px;resize:vertical}",
            ".mass-research-actions{display:flex;gap:10px;flex-wrap:wrap}",
            ".mass-research-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}",
            ".mass-research-stat{border:1px solid var(--line);border-radius:8px;padding:10px;background:#fff}",
            ".mass-research-stat strong{display:block;font-size:18px;color:var(--dark)}",
            ".mass-research-stat span{font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase}",
            ".mass-research-status{min-height:22px;font-size:13px;color:var(--muted)}",
            "@media(max-width:720px){.mass-research-row,.mass-research-stats{grid-template-columns:1fr}}"
        ].join("\n");
        document.head.appendChild(style);
    }

    function createModal() {
        ensureStyles();
        const wrapper = document.createElement("div");
        wrapper.className = "modal-bg";
        wrapper.id = "massResearchModal";
        wrapper.setAttribute("aria-hidden", "true");
        wrapper.innerHTML = [
            "<div class=\"modal mass-research-modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"massResearchTitle\">",
            "<button class=\"deep-search-close\" id=\"massResearchClose\" type=\"button\" aria-label=\"Sluit massaal zoeken\">×</button>",
            "<div class=\"deep-search-head\"><div class=\"mtitle\" id=\"massResearchTitle\">Massaal zoeken</div><p class=\"msub\">Parallel bedrijven vinden, verrijken en veilig opslaan.</p></div>",
            "<div class=\"mass-research-grid\">",
            "<label class=\"mlabel\" for=\"massResearchLocations\">Zoeklocaties of zoektermen</label>",
            "<textarea class=\"minput\" id=\"massResearchLocations\"></textarea>",
            "<div class=\"mass-research-row\"><div><label class=\"mlabel\" for=\"massResearchCount\">Gewenst aantal</label><input class=\"minput\" id=\"massResearchCount\" type=\"number\" min=\"1\" max=\"5000\" value=\"500\"></div><div><label class=\"mlabel\" for=\"massResearchConcurrency\">Parallel</label><input class=\"minput\" id=\"massResearchConcurrency\" type=\"number\" min=\"1\" max=\"100\" value=\"50\"></div></div>",
            "<div class=\"mass-research-actions\"><button class=\"mbtn s\" id=\"massResearchStart\" type=\"button\">Start massaal zoeken</button><button class=\"mbtn ghost\" id=\"massResearchCancel\" type=\"button\" disabled>Stop</button><button class=\"mbtn ghost\" id=\"massResearchReload\" type=\"button\">Database verversen</button></div>",
            "<div class=\"mass-research-stats\" id=\"massResearchStats\"></div>",
            "<div class=\"mass-research-status\" id=\"massResearchStatus\"></div>",
            "</div>",
            "</div>"
        ].join("");
        document.body.appendChild(wrapper);
        wrapper.querySelector("#massResearchLocations").value = DEFAULT_LOCATIONS;
        return wrapper;
    }

    function createController() {
        const menu = document.getElementById("addActionsMenu");
        if (!menu || document.getElementById("massResearchButton")) return null;
        const button = document.createElement("button");
        button.className = "add-actions-item";
        button.id = "massResearchButton";
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.innerHTML = "<span class=\"add-actions-item-title\">Massaal zoeken</span><span class=\"add-actions-item-sub\">Honderden bedrijven parallel verrijken</span>";
        menu.insertBefore(button, menu.firstChild);

        const modal = createModal();
        const nodes = {
            button: button,
            modal: modal,
            close: modal.querySelector("#massResearchClose"),
            locations: modal.querySelector("#massResearchLocations"),
            count: modal.querySelector("#massResearchCount"),
            concurrency: modal.querySelector("#massResearchConcurrency"),
            start: modal.querySelector("#massResearchStart"),
            cancel: modal.querySelector("#massResearchCancel"),
            reload: modal.querySelector("#massResearchReload"),
            stats: modal.querySelector("#massResearchStats"),
            status: modal.querySelector("#massResearchStatus")
        };
        let currentJobId = "";
        let running = false;

        function renderStats(job) {
            const stats = job && job.stats ? job.stats : {};
            const items = [
                ["Kandidaten", job && job.taskCount],
                ["Verrijkt", stats.enriched],
                ["Nieuw", stats.inserted],
                ["Duplicates", stats.duplicates],
                ["E-mails", stats.emailsFound],
                ["Fouten", stats.failed],
                ["Per uur", job && job.perHour],
                ["Status", job && job.status]
            ];
            nodes.stats.innerHTML = items.map(function (item) {
                return "<div class=\"mass-research-stat\"><strong>" + String(item[1] || 0) + "</strong><span>" + item[0] + "</span></div>";
            }).join("");
        }

        function setStatus(message) {
            nodes.status.textContent = normalizeString(message);
        }

        function setRunning(value) {
            running = Boolean(value);
            nodes.start.disabled = running;
            nodes.cancel.disabled = !running || !currentJobId;
        }

        function open() {
            modal.classList.add("show");
            modal.setAttribute("aria-hidden", "false");
            renderStats(null);
            setStatus("");
        }

        function close() {
            if (running) return;
            modal.classList.remove("show");
            modal.setAttribute("aria-hidden", "true");
        }

        function runLoop(jobId) {
            if (!running) return Promise.resolve();
            return requestJson("/api/premium-database/mass-research-jobs/" + encodeURIComponent(jobId) + "/run", {
                method: "POST",
                body: JSON.stringify({ maxRunMs: 25000, maxTasks: 250 })
            }).then(function (job) {
                renderStats(job);
                if (job.status === "done" || job.status === "cancelled" || job.status === "error") {
                    setRunning(false);
                    setStatus(job.status === "done" ? "Klaar. Ververs de database om alles te zien." : "Gestopt: " + job.status);
                    return;
                }
                setStatus("Bezig... " + Number(job.stats && job.stats.enriched || 0) + " bedrijven verrijkt.");
                return new Promise(function (resolve) { setTimeout(resolve, 500); }).then(function () {
                    return runLoop(jobId);
                });
            }).catch(function (error) {
                setRunning(false);
                setStatus(error.message || "Massaal zoeken mislukt.");
            });
        }

        function start() {
            const queries = parseLocations(nodes.locations.value);
            if (!queries.length) {
                setStatus("Vul minimaal één zoeklocatie in.");
                return;
            }
            setRunning(true);
            setStatus("Job aanmaken...");
            requestJson("/api/premium-database/mass-research-jobs", {
                method: "POST",
                body: JSON.stringify({
                    queries: queries,
                    desiredCount: parsePositiveInt(nodes.count.value, 500, 1, 5000),
                    enrichmentConcurrency: parsePositiveInt(nodes.concurrency.value, 50, 1, 100)
                })
            }).then(function (job) {
                currentJobId = job.id;
                renderStats(job);
                setStatus("Parallelle motor gestart.");
                return runLoop(job.id);
            }).catch(function (error) {
                setRunning(false);
                setStatus(error.message || "Massaal zoeken kon niet starten.");
            });
        }

        function cancel() {
            if (!currentJobId) return;
            setStatus("Stoppen...");
            requestJson("/api/premium-database/mass-research-jobs/" + encodeURIComponent(currentJobId) + "/cancel", {
                method: "POST",
                body: "{}"
            }).then(function (job) {
                renderStats(job);
                setRunning(false);
                setStatus("Gestopt. Opgeslagen resultaten blijven bewaard.");
            }).catch(function (error) {
                setStatus(error.message || "Stoppen mislukt.");
            });
        }

        button.addEventListener("click", open);
        nodes.close.addEventListener("click", close);
        nodes.start.addEventListener("click", start);
        nodes.cancel.addEventListener("click", cancel);
        nodes.reload.addEventListener("click", function () { global.location.reload(); });

        return { open: open, close: close };
    }

    function init() {
        const controller = createController();
        if (controller) global.SoftoraDatabaseMassResearch = controller;
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})(window);
