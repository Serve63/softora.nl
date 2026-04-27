(function (global) {
    "use strict";

    const STATUS_LABELS = {
        pending: "Wacht",
        active: "Bezig",
        done: "Klaar"
    };
    const USD_TO_EUR_RATE = 0.93;
    const ESTIMATED_BATCH_PRICING = {
        inputTokens: 6000,
        outputTokens: 16000,
        webSearchCalls: 1,
        inputUsdPerMillion: 30,
        outputUsdPerMillion: 180,
        webSearchUsdPerCall: 0.01
    };
    const DEFAULT_TARGET_TEXT = [
        "Nederland | Noord-Brabant | Altena | Almkerk",
        "Nederland | Noord-Brabant | Altena | Andel",
        "Nederland | Noord-Brabant | Altena | Babyloniënbroek",
        "Nederland | Noord-Brabant | Altena | Drongelen",
        "Nederland | Noord-Brabant | Altena | Dussen",
        "Nederland | Noord-Brabant | Altena | Eethen",
        "Nederland | Noord-Brabant | Altena | Genderen",
        "Nederland | Noord-Brabant | Altena | Giessen",
        "Nederland | Noord-Brabant | Altena | Hank",
        "Nederland | Noord-Brabant | Altena | Meeuwen",
        "Nederland | Noord-Brabant | Altena | Nieuwendijk",
        "Nederland | Noord-Brabant | Altena | Rijswijk",
        "Nederland | Noord-Brabant | Altena | Sleeuwijk",
        "Nederland | Noord-Brabant | Altena | Uitwijk",
        "Nederland | Noord-Brabant | Altena | Veen",
        "Nederland | Noord-Brabant | Altena | Waardhuizen",
        "Nederland | Noord-Brabant | Altena | Werkendam",
        "Nederland | Noord-Brabant | Altena | Wijk en Aalburg",
        "Nederland | Noord-Brabant | Altena | Woudrichem",
        "Nederland | Noord-Brabant | Asten | Asten",
        "Nederland | Noord-Brabant | Asten | Heusden",
        "Nederland | Noord-Brabant | Asten | Ommel",
        "Nederland | Noord-Brabant | Baarle-Nassau | Baarle-Nassau",
        "Nederland | Noord-Brabant | Baarle-Nassau | Castelré",
        "Nederland | Noord-Brabant | Baarle-Nassau | Ulicoten",
        "Nederland | Noord-Brabant | Bergeijk | Bergeijk",
        "Nederland | Noord-Brabant | Bergeijk | Luyksgestel",
        "Nederland | Noord-Brabant | Bergeijk | Riethoven",
        "Nederland | Noord-Brabant | Bergeijk | Westerhoven",
        "Nederland | Noord-Brabant | Bergen op Zoom | Bergen op Zoom",
        "Nederland | Noord-Brabant | Bergen op Zoom | Halsteren",
        "Nederland | Noord-Brabant | Bergen op Zoom | Lepelstraat",
        "Nederland | Noord-Brabant | Bernheze | Heesch",
        "Nederland | Noord-Brabant | Bernheze | Heeswijk-Dinther",
        "Nederland | Noord-Brabant | Bernheze | Loosbroek",
        "Nederland | Noord-Brabant | Bernheze | Nistelrode",
        "Nederland | Noord-Brabant | Bernheze | Vinkel",
        "Nederland | Noord-Brabant | Bernheze | Vorstenbosch",
        "Nederland | Noord-Brabant | Best | Best",
        "Nederland | Noord-Brabant | Bladel | Bladel",
        "Nederland | Noord-Brabant | Bladel | Casteren",
        "Nederland | Noord-Brabant | Bladel | Hapert",
        "Nederland | Noord-Brabant | Bladel | Hoogeloon",
        "Nederland | Noord-Brabant | Bladel | Netersel",
        "Nederland | Noord-Brabant | Boekel | Boekel",
        "Nederland | Noord-Brabant | Boekel | Venhorst",
        "Nederland | Noord-Brabant | Boxtel | Boxtel",
        "Nederland | Noord-Brabant | Boxtel | Esch",
        "Nederland | Noord-Brabant | Boxtel | Liempde",
        "Nederland | Noord-Brabant | Breda | Bavel",
        "Nederland | Noord-Brabant | Breda | Breda",
        "Nederland | Noord-Brabant | Breda | Prinsenbeek",
        "Nederland | Noord-Brabant | Breda | Teteringen",
        "Nederland | Noord-Brabant | Breda | Ulvenhout",
        "Nederland | Noord-Brabant | Cranendonck | Budel",
        "Nederland | Noord-Brabant | Cranendonck | Budel-Dorplein",
        "Nederland | Noord-Brabant | Cranendonck | Budel-Schoot",
        "Nederland | Noord-Brabant | Cranendonck | Gastel",
        "Nederland | Noord-Brabant | Cranendonck | Maarheeze",
        "Nederland | Noord-Brabant | Cranendonck | Soerendonk",
        "Nederland | Noord-Brabant | Deurne | Deurne",
        "Nederland | Noord-Brabant | Deurne | Helenaveen",
        "Nederland | Noord-Brabant | Deurne | Liessel",
        "Nederland | Noord-Brabant | Deurne | Neerkant",
        "Nederland | Noord-Brabant | Deurne | Vlierden",
        "Nederland | Noord-Brabant | Dongen | Dongen",
        "Nederland | Noord-Brabant | Dongen | s Gravenmoer",
        "Nederland | Noord-Brabant | Drimmelen | Drimmelen",
        "Nederland | Noord-Brabant | Drimmelen | Hooge Zwaluwe",
        "Nederland | Noord-Brabant | Drimmelen | Lage Zwaluwe",
        "Nederland | Noord-Brabant | Drimmelen | Made",
        "Nederland | Noord-Brabant | Drimmelen | Terheijden",
        "Nederland | Noord-Brabant | Drimmelen | Wagenberg",
        "Nederland | Noord-Brabant | Drimmelen | Zevenbergschen Hoek",
        "Nederland | Noord-Brabant | Eersel | Duizel",
        "Nederland | Noord-Brabant | Eersel | Eersel",
        "Nederland | Noord-Brabant | Eersel | Knegsel",
        "Nederland | Noord-Brabant | Eersel | Steensel",
        "Nederland | Noord-Brabant | Eersel | Vessem",
        "Nederland | Noord-Brabant | Eersel | Wintelre",
        "Nederland | Noord-Brabant | Eindhoven | Eindhoven",
        "Nederland | Noord-Brabant | Etten-Leur | Etten-Leur",
        "Nederland | Zeeland | Borsele | Baarland",
        "Nederland | Zeeland | Borsele | Borssele",
        "Nederland | Zeeland | Goes | Goes",
        "Nederland | Limburg | Maastricht | Maastricht",
        "Nederland | Gelderland | Arnhem | Arnhem",
        "Nederland | Utrecht | Utrecht | Utrecht",
        "Nederland | Overijssel | Zwolle | Zwolle",
        "Nederland | Flevoland | Almere | Almere",
        "Nederland | Drenthe | Assen | Assen",
        "Nederland | Friesland | Leeuwarden | Leeuwarden",
        "Nederland | Groningen | Groningen | Groningen",
        "Nederland | Noord-Holland | Amsterdam | Amsterdam",
        "Nederland | Zuid-Holland | Rotterdam | Rotterdam",
        "Nederland | Zuid-Holland | s-Gravenhage | s-Gravenhage"
    ].join("\n");

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function normalizeKey(value) {
        return normalizeString(value)
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function escapeHtml(value) {
        return normalizeString(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function parseTargetLines(raw) {
        const seen = new Set();
        return String(raw || "")
            .split(/\r?\n/)
            .map(function (line) {
                return normalizeString(line)
                    .replace(/^\s*(?:[-*•]+|\d+[.)]?)\s*/, "")
                    .replace(/\s+/g, " ");
            })
            .filter(function (line) {
                const key = normalizeKey(line);
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    function getDefaultTargetLabels() {
        return parseTargetLines(DEFAULT_TARGET_TEXT);
    }

    function estimateBatchUsd() {
        return ((ESTIMATED_BATCH_PRICING.inputTokens / 1000000) * ESTIMATED_BATCH_PRICING.inputUsdPerMillion)
            + ((ESTIMATED_BATCH_PRICING.outputTokens / 1000000) * ESTIMATED_BATCH_PRICING.outputUsdPerMillion)
            + (ESTIMATED_BATCH_PRICING.webSearchCalls * ESTIMATED_BATCH_PRICING.webSearchUsdPerCall);
    }

    function usdToEur(value) {
        return Math.max(0, Number(value || 0) || 0) * USD_TO_EUR_RATE;
    }

    function formatEuro(value) {
        const amount = Math.max(0, Number(value || 0) || 0);
        const visibleAmount = amount > 0 && amount < 0.01 ? 0.01 : amount;
        return "€" + visibleAmount.toLocaleString("nl-NL", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function formatUsdAsEuro(value) {
        return formatEuro(usdToEur(value));
    }

    function safeParseJson(raw) {
        try {
            const parsed = JSON.parse(String(raw || "{}"));
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    function uniqueStrings(values, maxItems) {
        const seen = new Set();
        const result = [];
        (values || []).forEach(function (value) {
            const normalized = normalizeString(value);
            const key = normalizeKey(normalized);
            if (!normalized || !key || seen.has(key)) return;
            seen.add(key);
            result.push(normalized.slice(0, 180));
        });
        return result.slice(0, maxItems || 180);
    }

    function createTarget(label, index) {
        return {
            id: "deep-" + normalizeKey(label).replace(/[^a-z0-9]+/g, "-").slice(0, 60) + "-" + index,
            label: normalizeString(label),
            status: index === 0 ? "active" : "pending",
            batches: 0,
            found: 0,
            added: 0,
            costUsd: 0,
            seen: [],
            lastSources: [],
            updatedAt: ""
        };
    }

    function normalizeTarget(raw, index) {
        const label = normalizeString(raw && (raw.label || raw.name || raw.target || raw));
        if (!label) return null;
        const status = ["pending", "active", "done"].indexOf(normalizeString(raw && raw.status)) !== -1
            ? normalizeString(raw.status)
            : (index === 0 ? "active" : "pending");
        return {
            id: normalizeString(raw && raw.id) || createTarget(label, index).id,
            label: label,
            status: status,
            batches: Math.max(0, Number(raw && raw.batches) || 0),
            found: Math.max(0, Number(raw && raw.found) || 0),
            added: Math.max(0, Number(raw && raw.added) || 0),
            costUsd: Math.max(0, Number(raw && raw.costUsd) || 0),
            seen: uniqueStrings(raw && raw.seen, 180),
            lastSources: Array.isArray(raw && raw.lastSources) ? raw.lastSources.slice(0, 40) : [],
            updatedAt: normalizeString(raw && raw.updatedAt)
        };
    }

    function applyDefaultTargets(targets) {
        const previousByKey = new Map();
        (targets || []).forEach(function (target) {
            previousByKey.set(normalizeKey(target.label), target);
        });
        const defaults = getDefaultTargetLabels().map(function (label, index) {
            return previousByKey.get(normalizeKey(label)) || createTarget(label, index);
        });
        (targets || []).forEach(function (target) {
            if (!previousByKey.has(normalizeKey(target.label))) return;
            if (defaults.some(function (item) { return normalizeKey(item.label) === normalizeKey(target.label); })) return;
            defaults.push(target);
        });
        return defaults;
    }

    function normalizeState(raw) {
        const parsed = typeof raw === "string" ? safeParseJson(raw) : (raw || {});
        const loadedTargets = Array.isArray(parsed.targets)
            ? parsed.targets.map(normalizeTarget).filter(Boolean)
            : [];
        const targets = applyDefaultTargets(loadedTargets);
        let activeIndex = Math.max(0, Math.min(targets.length - 1, Number(parsed.activeIndex) || 0));
        const activeFromStatus = targets.findIndex(function (target) {
            return target.status === "active";
        });
        if (activeFromStatus !== -1) activeIndex = activeFromStatus;
        if (targets.length && targets.every(function (target) { return target.status !== "active"; })) {
            const nextPending = targets.findIndex(function (target) { return target.status !== "done"; });
            activeIndex = nextPending === -1 ? targets.length - 1 : nextPending;
            if (targets[activeIndex].status !== "done") targets[activeIndex].status = "active";
        }
        return {
            targets: targets,
            activeIndex: targets.length ? activeIndex : 0,
            totalCostUsd: targets.reduce(function (sum, target) {
                return sum + Math.max(0, Number(target.costUsd) || 0);
            }, 0),
            updatedAt: normalizeString(parsed.updatedAt)
        };
    }

    function readDeepSearchRows(payload) {
        return fetch("/api/premium-database/deep-search-businesses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload || {})
        }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (body) {
                if (!response.ok || !body.ok) throw new Error(body.error || "AI zoeklijst ophalen mislukt.");
                if (!Array.isArray(body.rows)) throw new Error("Geen bruikbare bedrijven ontvangen.");
                return body;
            });
        });
    }

    function createController(options) {
        const nodes = options.nodes || {};
        const getUiState = options.getUiState;
        const setUiState = options.setUiState;
        const scope = normalizeString(options.scope);
        const stateKey = normalizeString(options.stateKey);
        const importRows = options.importRows;
        const getCustomers = options.getCustomers || function () { return []; };
        const setStatusMessage = options.setStatusMessage || function () {};
        const toast = options.toast || function () {};
        let state = normalizeState({});
        let busy = false;
        let bound = false;

        function getCurrentTarget() {
            return state.targets[state.activeIndex] || null;
        }

        function serializeState() {
            return JSON.stringify({
                targets: state.targets,
                activeIndex: state.activeIndex,
                totalCostUsd: state.totalCostUsd,
                updatedAt: new Date().toISOString()
            });
        }

        function persistState() {
            if (!setUiState || !scope || !stateKey) return Promise.resolve({ ok: true });
            return setUiState(scope, {
                patch: {
                    [stateKey]: serializeState()
                },
                source: "premium-database-deep-search",
                actor: "Premium database"
            }).catch(function (error) {
                console.error("AI zoeklijst opslaan mislukt:", error);
                return { ok: false, error: error };
            });
        }

        function loadState() {
            if (!getUiState || !scope || !stateKey) {
                render();
                return Promise.resolve(state);
            }
            return getUiState(scope).then(function (remoteState) {
                const values = remoteState && remoteState.values && typeof remoteState.values === "object"
                    ? remoteState.values
                    : {};
                state = normalizeState(values[stateKey]);
                render();
                return state;
            }).catch(function () {
                render();
                return state;
            });
        }

        function setBusy(nextBusy) {
            busy = Boolean(nextBusy);
            [
                nodes.deepSearchStartButton,
                nodes.deepSearchDoneButton,
                nodes.deepSearchResetButton
            ].forEach(function (button) {
                if (button) button.disabled = busy;
            });
            if (nodes.deepSearchStartButton) {
                nodes.deepSearchStartButton.textContent = busy ? "Zoeken..." : "100 bedrijven toevoegen";
            }
        }

        function getStats() {
            const done = state.targets.filter(function (target) { return target.status === "done"; }).length;
            const active = state.targets.filter(function (target) { return target.status === "active"; }).length;
            const pending = Math.max(0, state.targets.length - done - active);
            return { done: done, active: active, pending: pending };
        }

        function renderSources(target) {
            if (!nodes.deepSearchSources) return;
            const sources = Array.isArray(target && target.lastSources) ? target.lastSources : [];
            if (!sources.length) {
                nodes.deepSearchSources.innerHTML = "<div class=\"deep-search-empty\">Nog geen bronnen voor deze plek.</div>";
                return;
            }
            nodes.deepSearchSources.innerHTML = sources.slice(0, 10).map(function (source) {
                const url = normalizeString(source && source.url || source);
                const title = normalizeString(source && source.title) || url;
                return "<a href=\"" + escapeHtml(url) + "\" target=\"_blank\" rel=\"noopener\">" + escapeHtml(title) + "</a>";
            }).join("");
        }

        function render() {
            const stats = getStats();
            const target = getCurrentTarget();
            if (nodes.deepSearchStats) {
                nodes.deepSearchStats.textContent = state.targets.length
                    ? stats.done + " klaar · " + stats.pending + " in wachtrij · " + state.targets.length + " totaal · " + formatUsdAsEuro(state.totalCostUsd) + " API"
                    : "Geen vaste volgorde";
            }
            if (nodes.deepSearchCurrent) {
                nodes.deepSearchCurrent.textContent = target
                    ? "Nu: " + target.label + " · " + target.batches + " batch(es) · " + target.added + " nieuw"
                    : "Geen huidige plek";
            }
            if (nodes.deepSearchCost) {
                const batchEstimate = formatEuro(usdToEur(estimateBatchUsd()));
                nodes.deepSearchCost.textContent = target
                    ? "Geschatte API-kosten: ± " + batchEstimate + " voor deze klik · " + formatUsdAsEuro(target.costUsd) + " gebruikt voor deze plek · " + formatUsdAsEuro(state.totalCostUsd) + " totaal"
                    : "Geschatte API-kosten: ± " + batchEstimate + " per klik";
            }
            if (nodes.deepSearchList) {
                nodes.deepSearchList.innerHTML = state.targets.length
                    ? state.targets.map(function (item, index) {
                        const activeClass = index === state.activeIndex ? " is-active" : "";
                        const statusClass = " is-" + item.status;
                        return "<button class=\"deep-search-target" + activeClass + statusClass + "\" type=\"button\" data-deep-target-index=\"" + index + "\">"
                            + "<span>" + (index + 1) + ". " + escapeHtml(item.label) + "</span>"
                            + "<strong>" + escapeHtml(STATUS_LABELS[item.status] || "Wacht") + " · " + item.batches + "x · " + item.added + " nieuw</strong>"
                            + "</button>";
                    }).join("")
                    : "<div class=\"deep-search-empty\">Geen vaste volgorde gevonden.</div>";
            }
            renderSources(target);
            if (nodes.deepSearchDoneButton) nodes.deepSearchDoneButton.disabled = busy || !target;
            if (nodes.deepSearchStartButton) nodes.deepSearchStartButton.disabled = busy || !target;
        }

        function collectExistingKeys() {
            const customers = Array.isArray(getCustomers()) ? getCustomers() : [];
            return customers.map(function (customer) {
                return [
                    customer && customer.bedrijf,
                    customer && customer.email,
                    customer && (customer.website || customer.dom),
                    customer && customer.stad
                ].map(normalizeString).filter(Boolean).join(" | ");
            }).filter(Boolean).slice(-120);
        }

        function updateTargetAfterSearch(target, body, addedCount) {
            const businesses = Array.isArray(body.businesses) ? body.businesses : [];
            const costUsd = Math.max(0, Number(body && body.cost && body.cost.estimatedUsd) || 0);
            target.batches += 1;
            target.found += Math.max(0, Number(body.found) || 0);
            target.added += Math.max(0, Number(addedCount) || 0);
            target.costUsd = Math.max(0, Number(target.costUsd) || 0) + costUsd;
            state.totalCostUsd = Math.max(0, Number(state.totalCostUsd) || 0) + costUsd;
            target.updatedAt = new Date().toISOString();
            target.lastSources = Array.isArray(body.sources) ? body.sources.slice(0, 40) : [];
            target.seen = uniqueStrings(target.seen.concat(businesses.map(function (business) {
                return [
                    business && business.bedrijfsnaam,
                    business && business.email,
                    business && business.website
                ].map(normalizeString).filter(Boolean).join(" | ");
            })), 180);
        }

        function runCurrentSearch() {
            if (busy) return Promise.resolve(false);
            const target = getCurrentTarget();
            if (!target) {
                setStatusMessage("Plak eerst je zoeklijst en sla die op.", "error");
                return Promise.resolve(false);
            }
            setBusy(true);
            target.status = "active";
            render();
            setStatusMessage("AI zoekt complete bedrijven voor " + target.label + "...", "info");
            const beforeCount = Array.isArray(getCustomers()) ? getCustomers().length : 0;
            return readDeepSearchRows({
                target: target.label,
                count: 100,
                batchNumber: target.batches + 1,
                exclude: uniqueStrings(target.seen.concat(collectExistingKeys()), 180)
            }).then(function (body) {
                return Promise.resolve(importRows(body.rows)).then(function () {
                    const afterCount = Array.isArray(getCustomers()) ? getCustomers().length : beforeCount;
                    const addedCount = Math.max(0, afterCount - beforeCount);
                    updateTargetAfterSearch(target, body, addedCount);
                    render();
                    return persistState().then(function () {
                        setStatusMessage(
                            "AI vond " + Number(body.found || 0) + " complete bedrijven voor " + target.label + ". " + addedCount + " nieuw toegevoegd. API-kosten: " + formatUsdAsEuro(body && body.cost && body.cost.estimatedUsd) + ".",
                            "success",
                            true
                        );
                        if (addedCount) toast("+" + addedCount + " bedrijven");
                        return true;
                    });
                });
            }).catch(function (error) {
                console.error("AI zoeklijst mislukt:", error);
                setStatusMessage("AI zoeklijst mislukt: " + String(error.message || "controleer de instellingen"), "error");
                return false;
            }).finally(function () {
                setBusy(false);
                render();
            });
        }

        function markCurrentDone() {
            const target = getCurrentTarget();
            if (!target) return Promise.resolve(false);
            target.status = "done";
            target.updatedAt = new Date().toISOString();
            const nextIndex = state.targets.findIndex(function (item, index) {
                return index > state.activeIndex && item.status !== "done";
            });
            const fallbackIndex = state.targets.findIndex(function (item) {
                return item.status !== "done";
            });
            state.activeIndex = nextIndex !== -1 ? nextIndex : (fallbackIndex !== -1 ? fallbackIndex : state.activeIndex);
            state.targets.forEach(function (item, index) {
                if (item.status !== "done") item.status = index === state.activeIndex ? "active" : "pending";
            });
            render();
            return persistState().then(function () {
                setStatusMessage("Plek afgerond. Volgende staat klaar.", "success", true);
                return true;
            });
        }

        function setActiveIndex(index) {
            const targetIndex = Math.max(0, Math.min(state.targets.length - 1, Number(index) || 0));
            state.activeIndex = targetIndex;
            state.targets.forEach(function (target, itemIndex) {
                if (target.status !== "done") target.status = itemIndex === targetIndex ? "active" : "pending";
            });
            render();
            void persistState();
        }

        function resetState() {
            if (!window.confirm("Voortgang van de vaste AI-zoeklijst wissen?")) return;
            state = normalizeState({});
            render();
            void persistState();
        }

        function open() {
            if (!nodes.deepSearchModal) return;
            nodes.deepSearchModal.classList.add("on");
            nodes.deepSearchModal.setAttribute("aria-hidden", "false");
            void loadState();
        }

        function close() {
            if (!nodes.deepSearchModal) return;
            nodes.deepSearchModal.classList.remove("on");
            nodes.deepSearchModal.setAttribute("aria-hidden", "true");
        }

        function bind() {
            if (bound) return;
            bound = true;
            if (nodes.deepSearchStartButton) {
                nodes.deepSearchStartButton.addEventListener("click", function () {
                    void runCurrentSearch();
                });
            }
            if (nodes.deepSearchDoneButton) {
                nodes.deepSearchDoneButton.addEventListener("click", function () {
                    void markCurrentDone();
                });
            }
            if (nodes.deepSearchResetButton) nodes.deepSearchResetButton.addEventListener("click", resetState);
            if (nodes.closeDeepSearchButton) nodes.closeDeepSearchButton.addEventListener("click", close);
            if (nodes.deepSearchModal) {
                nodes.deepSearchModal.addEventListener("click", function (event) {
                    if (event.target === nodes.deepSearchModal) close();
                });
            }
            if (nodes.deepSearchList) {
                nodes.deepSearchList.addEventListener("click", function (event) {
                    const button = event.target.closest("[data-deep-target-index]");
                    if (!button) return;
                    setActiveIndex(button.getAttribute("data-deep-target-index"));
                });
            }
        }

        return {
            bind: bind,
            close: close,
            open: open,
            parseTargetLines: parseTargetLines,
            readDeepSearchRows: readDeepSearchRows,
            runCurrentSearch: runCurrentSearch
        };
    }

    global.SoftoraDatabaseDeepSearch = {
        createController: createController,
        parseTargetLines: parseTargetLines,
        readDeepSearchRows: readDeepSearchRows
    };
})(window);
