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

    function createController(deps) {
        const input = deps.input;
        const setStatusMessage = deps.setStatusMessage;
        const importRows = deps.importRows;

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

        return {
            handleFileChange: handleFileChange
        };
    }

    global.SoftoraDatabaseImport = {
        createController: createController,
        detectDelimitedSeparator: detectDelimitedSeparator,
        parseDelimitedRows: parseDelimitedRows,
        pickRecordValue: pickRecordValue
    };
})(window);
