(function (global) {
    "use strict";

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function detectDelimitedSeparator(text, preferredSeparator) {
        if (preferredSeparator === "\t") return "\t";
        const sample = String(text || "").split(/\r?\n/).find(function (line) {
            return normalizeString(line) !== "";
        }) || "";
        const scores = { ",": 0, ";": 0, "\t": 0 };
        let inQuotes = false;

        for (let index = 0; index < sample.length; index += 1) {
            const char = sample[index];
            const next = sample[index + 1];
            if (char === "\"") {
                if (inQuotes && next === "\"") {
                    index += 1;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }
            if (!inQuotes && Object.prototype.hasOwnProperty.call(scores, char)) {
                scores[char] += 1;
            }
        }

        return Object.keys(scores).sort(function (left, right) {
            return scores[right] - scores[left];
        })[0] || preferredSeparator || ",";
    }

    function parseDelimitedRows(raw, preferredSeparator) {
        const text = String(raw || "").replace(/^\uFEFF/, "");
        const separator = detectDelimitedSeparator(text, preferredSeparator);
        const rows = [];
        let current = "";
        let row = [];
        let inQuotes = false;

        for (let index = 0; index < text.length; index += 1) {
            const char = text[index];
            const next = text[index + 1];

            if (char === "\"") {
                if (inQuotes && next === "\"") {
                    current += "\"";
                    index += 1;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }

            if (char === separator && !inQuotes) {
                row.push(current);
                current = "";
                continue;
            }

            if ((char === "\n" || char === "\r") && !inQuotes) {
                if (char === "\r" && next === "\n") index += 1;
                row.push(current);
                if (row.some(function (cell) { return normalizeString(cell) !== ""; })) {
                    rows.push(row);
                }
                row = [];
                current = "";
                continue;
            }

            current += char;
        }

        row.push(current);
        if (row.some(function (cell) { return normalizeString(cell) !== ""; })) {
            rows.push(row);
        }
        return rows;
    }

    function pickRecordValue(record, keys) {
        for (let index = 0; index < keys.length; index += 1) {
            const value = normalizeString(record[keys[index]]);
            if (value) return value;
        }
        return "";
    }

    function isExcelImportFile(file) {
        return /\.xlsx$/i.test(normalizeString(file && file.name))
            || normalizeString(file && file.type) === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }

    function readLinkedSpreadsheetRows(sourceUrl) {
        return fetch("/api/premium-database/sync-spreadsheet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceUrl: normalizeString(sourceUrl) })
        }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (body) {
                if (!response.ok || !body.ok) throw new Error(body.error || "Google Sheet synchroniseren mislukt.");
                return Array.isArray(body.rows) ? body.rows : [];
            });
        });
    }

    function readRealBusinessRows(query) {
        return fetch("/api/premium-database/add-real-businesses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: normalizeString(query),
                count: 100,
                enrichEmails: true
            })
        }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (body) {
                if (!response.ok || !body.ok) throw new Error(body.error || "Echte bedrijven ophalen mislukt.");
                if (!Array.isArray(body.rows)) throw new Error("Geen bruikbare bedrijven ontvangen.");
                return body;
            });
        });
    }

    function readExcelRows(file) {
        return new Promise(function (resolve, reject) {
            if (file.size > 5 * 1024 * 1024) {
                reject(new Error("Het Excel-bestand is te groot. Gebruik maximaal 5 MB."));
                return;
            }

            const reader = new FileReader();
            reader.onload = function () {
                const base64 = normalizeString(reader.result).split(",").pop();
                fetch("/api/premium-database/import-spreadsheet", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ fileName: file.name || "database.xlsx", dataBase64: base64 })
                }).then(function (response) {
                    return response.json().catch(function () { return {}; }).then(function (body) {
                        if (!response.ok || !body.ok) throw new Error(body.error || "Spreadsheet importeren mislukt.");
                        resolve(Array.isArray(body.rows) ? body.rows : []);
                    });
                }).catch(reject);
            };
            reader.onerror = function () {
                reject(new Error("Bestand lezen mislukt."));
            };
            reader.readAsDataURL(file);
        });
    }

    function readDelimitedRows(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function () {
                const preferred = /\.tsv$/i.test(file.name || "") ? "\t" : "";
                resolve(parseDelimitedRows(reader.result, preferred));
            };
            reader.onerror = function () {
                reject(new Error("Bestand lezen mislukt."));
            };
            reader.readAsText(file);
        });
    }

    function normalizeSyncText(value) {
        return normalizeString(value).toLowerCase();
    }

    function normalizeSyncDomain(value) {
        return normalizeSyncText(value)
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "")
            .replace(/\/.*$/, "")
            .trim();
    }

    function normalizeSyncPhone(value) {
        return normalizeString(value).replace(/\D+/g, "");
    }

    function collectCustomerSyncKeys(customer) {
        const keys = [];
        const email = normalizeSyncText(customer && customer.email);
        const domain = normalizeSyncDomain((customer && (customer.website || customer.dom)) || "");
        const phone = normalizeSyncPhone(customer && customer.tel);
        const company = normalizeSyncText(customer && customer.bedrijf);
        const address = normalizeSyncText(customer && customer.stad);

        if (email && email !== "—") keys.push("email:" + email);
        if (domain && domain !== "onbekend.nl") keys.push("domain:" + domain);
        if (phone.length >= 7) keys.push("phone:" + phone);
        if (company && address && address !== "onbekend") keys.push("company-address:" + company + "|" + address);
        return keys;
    }

    function indexCustomersBySyncKeys(customers) {
        const index = new Map();
        (customers || []).forEach(function (customer, customerIndex) {
            addCustomerSyncKeysToIndex(index, customer, customerIndex);
        });
        return index;
    }

    function addCustomerSyncKeysToIndex(index, customer, customerIndex) {
        collectCustomerSyncKeys(customer).forEach(function (key) {
            if (!index.has(key)) index.set(key, customerIndex);
        });
    }

    function findExistingCustomerIndex(index, customer) {
        const keys = collectCustomerSyncKeys(customer);
        for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
            if (index.has(keys[keyIndex])) return index.get(keys[keyIndex]);
        }
        return -1;
    }

    function hasFieldChanges(current, incoming) {
        return [
            "bedrijf",
            "dom",
            "tel",
            "email",
            "stad",
            "website"
        ].some(function (key) {
            return normalizeString(current && current[key]) !== normalizeString(incoming && incoming[key]);
        });
    }

    function mergeCustomerForSync(current, incoming) {
        const merged = {
            ...current,
            bedrijf: incoming.bedrijf || current.bedrijf,
            dom: incoming.website ? incoming.dom : current.dom,
            tel: incoming.tel && incoming.tel !== "—" ? incoming.tel : current.tel,
            email: incoming.email || current.email,
            stad: incoming.stad || current.stad,
            website: incoming.website || current.website
        };
        return hasFieldChanges(current, merged) ? merged : current;
    }

    function mergeCustomers(existingCustomers, importedCustomers, options) {
        const updateExisting = Boolean(options && options.updateExisting);
        const mergedCustomers = (existingCustomers || []).slice();
        const keyIndex = indexCustomersBySyncKeys(mergedCustomers);
        let addedCount = 0;
        let updatedCount = 0;

        (importedCustomers || []).forEach(function (customer) {
            const existingIndex = findExistingCustomerIndex(keyIndex, customer);
            if (existingIndex === -1) {
                const newIndex = mergedCustomers.length;
                mergedCustomers.push(customer);
                addCustomerSyncKeysToIndex(keyIndex, customer, newIndex);
                addedCount += 1;
                return;
            }

            if (!updateExisting) return;
            const updated = mergeCustomerForSync(mergedCustomers[existingIndex], customer);
            if (updated !== mergedCustomers[existingIndex]) {
                mergedCustomers[existingIndex] = updated;
                addCustomerSyncKeysToIndex(keyIndex, updated, existingIndex);
                updatedCount += 1;
            }
        });

        return {
            customers: mergedCustomers,
            addedCount: addedCount,
            updatedCount: updatedCount
        };
    }

    function parseSyncConfig(raw) {
        try {
            const parsed = JSON.parse(String(raw || "{}"));
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    function createController(deps) {
        const input = deps.input;
        const setStatusMessage = deps.setStatusMessage;
        const importRows = deps.importRows;
        const syncRows = deps.syncRows;
        const getUiState = deps.getUiState;
        const setUiState = deps.setUiState;
        const syncScope = deps.syncScope;
        const syncKey = deps.syncKey;
        const syncIntervalMs = Math.max(60 * 1000, Number(deps.syncIntervalMs) || 10 * 60 * 1000);
        const realBusinessButton = deps.realBusinessButton;
        let syncSourceUrl = "";
        let syncTimer = null;

        function resetInput() {
            if (input) input.value = "";
        }

        function handleFileChange(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            setStatusMessage(isExcelImportFile(file) ? "Spreadsheet verwerken..." : "Bestand verwerken...", "info");
            (isExcelImportFile(file) ? readExcelRows(file) : readDelimitedRows(file))
                .then(importRows)
                .catch(function (error) {
                    console.error("Database upload mislukt:", error);
                    setStatusMessage("Uploaden mislukt: " + String(error.message || "ongeldig bestand"), "error");
                })
                .finally(resetInput);
        }

        function loadSyncConfig() {
            if (!getUiState || !syncScope || !syncKey) return Promise.resolve({});
            return getUiState(syncScope).then(function (state) {
                const values = state && state.values && typeof state.values === "object" ? state.values : {};
                return parseSyncConfig(values[syncKey]);
            }).catch(function () {
                return {};
            });
        }

        function saveSyncConfig(sourceUrl) {
            syncSourceUrl = normalizeString(sourceUrl);
            if (!setUiState || !syncScope || !syncKey) return Promise.resolve();
            return setUiState(syncScope, {
                patch: {
                    [syncKey]: JSON.stringify({
                        sourceUrl: syncSourceUrl,
                        updatedAt: new Date().toISOString()
                    })
                },
                source: "premium-database-sync",
                actor: "Premium database"
            });
        }

        function syncFromSource(sourceUrl, options) {
            const silent = Boolean(options && options.silent);
            if (!syncRows) return Promise.resolve(false);
            if (!silent) setStatusMessage("Google Sheet synchroniseren...", "info");
            return readLinkedSpreadsheetRows(sourceUrl).then(function (rows) {
                return syncRows(rows, { silent: silent });
            }).catch(function (error) {
                console.error("Database sync mislukt:", error);
                if (!silent) {
                    setStatusMessage("Synchroniseren mislukt: " + String(error.message || "controleer de Google Sheets-link"), "error");
                }
                return false;
            });
        }

        function scheduleAutoSync() {
            if (syncTimer) window.clearInterval(syncTimer);
            if (!syncSourceUrl) return;
            syncTimer = window.setInterval(function () {
                void syncFromSource(syncSourceUrl, { silent: true });
            }, syncIntervalMs);
        }

        function handleSyncConnect() {
            const current = syncSourceUrl || "";
            const nextUrl = window.prompt("Plak hier de deelbare Google Sheets-link. Zet delen op: iedereen met de link kan bekijken.", current);
            if (!normalizeString(nextUrl)) return;
            saveSyncConfig(nextUrl).then(function () {
                scheduleAutoSync();
                return syncFromSource(nextUrl, { silent: false });
            }).catch(function (error) {
                setStatusMessage("Koppelen mislukt: " + String(error.message || "onbekende fout"), "error");
            });
        }

        function handleRealBusinessAdd() {
            const query = window.prompt(
                "Waar wil je 100 echte bedrijven zoeken? Bijvoorbeeld: bedrijven in Breda, horeca in Tilburg of bedrijven in Noord-Brabant.",
                "bedrijven in Noord-Brabant"
            );
            if (!normalizeString(query)) return Promise.resolve(false);

            if (realBusinessButton) realBusinessButton.disabled = true;
            setStatusMessage("100 echte bedrijven zoeken...", "info");

            return readRealBusinessRows(query).then(function (body) {
                return importRows(body.rows).then(function (imported) {
                    if (imported) {
                        setStatusMessage(
                            "Google Places heeft " + Number(body.found || 0) + " bedrijven opgehaald. " + Number(body.emailFound || 0) + " met publiek e-mailadres.",
                            "success",
                            true
                        );
                    }
                    return imported;
                });
            }).catch(function (error) {
                console.error("Echte bedrijven toevoegen mislukt:", error);
                setStatusMessage("Echte bedrijven toevoegen mislukt: " + String(error.message || "controleer de bron"), "error");
                return false;
            }).finally(function () {
                if (realBusinessButton) realBusinessButton.disabled = false;
            });
        }

        function startAutoSync() {
            return loadSyncConfig().then(function (config) {
                syncSourceUrl = normalizeString(config && config.sourceUrl);
                if (!syncSourceUrl) return false;
                scheduleAutoSync();
                return syncFromSource(syncSourceUrl, { silent: true });
            });
        }

        return {
            handleFileChange: handleFileChange,
            handleRealBusinessAdd: handleRealBusinessAdd,
            handleSyncConnect: handleSyncConnect,
            startAutoSync: startAutoSync
        };
    }

    global.SoftoraDatabaseImport = {
        createController: createController,
        detectDelimitedSeparator: detectDelimitedSeparator,
        mergeCustomers: mergeCustomers,
        parseDelimitedRows: parseDelimitedRows,
        pickRecordValue: pickRecordValue,
        readRealBusinessRows: readRealBusinessRows,
        readLinkedSpreadsheetRows: readLinkedSpreadsheetRows
    };
})(window);
