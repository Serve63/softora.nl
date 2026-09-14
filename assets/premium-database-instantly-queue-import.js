(function (global) {
    "use strict";

    const ENDPOINT = "/api/outreach/provider-queue/register";
    const BATCH_SIZE = 200;
    const SOURCE_ID = "database-vondsten-20260914";
    const EXPECTED_HEADERS = ["bedrijf", "adres", "website", "e-mail", "telefoon"];
    const COMPLETION_PARAM = "instantlyQueueRegistered";

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function normalizeHeader(value) {
        return normalizeString(value).toLowerCase().replace(/^\uFEFF/, "");
    }

    function parseCsv(text) {
        const parsed = [];
        let row = [];
        let cell = "";
        let quoted = false;
        const source = String(text || "");
        for (let index = 0; index < source.length; index += 1) {
            const char = source[index];
            const next = source[index + 1];
            if (char === "\"") {
                if (quoted && next === "\"") {
                    cell += "\"";
                    index += 1;
                } else {
                    quoted = !quoted;
                }
                continue;
            }
            if (char === "," && !quoted) {
                row.push(cell);
                cell = "";
                continue;
            }
            if ((char === "\n" || char === "\r") && !quoted) {
                if (char === "\r" && next === "\n") index += 1;
                row.push(cell);
                if (row.some(function (value) { return normalizeString(value); })) parsed.push(row);
                row = [];
                cell = "";
                continue;
            }
            cell += char;
        }
        row.push(cell);
        if (row.some(function (value) { return normalizeString(value); })) parsed.push(row);
        return parsed;
    }

    function mapRows(parsed) {
        const header = (parsed.shift() || []).map(normalizeHeader);
        if (header.length < EXPECTED_HEADERS.length || EXPECTED_HEADERS.some(function (value, index) { return header[index] !== value; })) {
            throw new Error("Gebruik de kolommen Bedrijf, Adres, Website, E-mail en Telefoon in deze volgorde.");
        }
        const emails = new Set();
        return parsed.map(function (values, index) {
            const lead = {
                sheetRow: index + 2,
                bedrijf: normalizeString(values[0]),
                adres: normalizeString(values[1]),
                website: normalizeString(values[2]),
                email: normalizeString(values[3]).toLowerCase(),
                telefoon: normalizeString(values[4])
            };
            const missing = Object.keys(lead).filter(function (key) { return key !== "sheetRow" && !normalizeString(lead[key]); });
            if (missing.length) throw new Error("Sheetregel " + lead.sheetRow + " is niet compleet.");
            if (emails.has(lead.email)) throw new Error("Dubbel e-mailadres in de sheet: " + lead.email + ".");
            emails.add(lead.email);
            return lead;
        });
    }

    async function sha256(text) {
        const digest = await global.crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text || "")));
        return Array.from(new Uint8Array(digest), function (value) {
            return value.toString(16).padStart(2, "0");
        }).join("");
    }

    function createControls() {
        const instantlyButton = document.querySelector('.status-filter-group--sent [data-s="instantly"]');
        const pills = document.querySelector('.status-filter-group--shared .status-filter-pills');
        if (!pills || !instantlyButton || document.getElementById("instantlyQueueImportButton")) return null;
        const button = document.createElement("button");
        button.id = "instantlyQueueImportButton";
        button.type = "button";
        button.className = "sf-btn";
        button.textContent = "Uploaden";
        const input = document.createElement("input");
        input.id = "instantlyQueueImportFile";
        input.type = "file";
        input.accept = ".csv,text/csv";
        input.hidden = true;
        const status = document.createElement("span");
        status.id = "instantlyQueueImportStatus";
        status.setAttribute("aria-live", "polite");
        pills.append(button, input, status);
        return { button: button, input: input, status: status, instantlyButton: instantlyButton };
    }

    function setProgress(controls, text, failed) {
        controls.status.textContent = text;
        controls.status.style.color = failed ? "#b42318" : "";
    }

    async function postBatch(rows, metadata) {
        const response = await fetch(ENDPOINT, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ ...metadata, rows: rows })
        });
        const body = await response.json().catch(function () { return {}; });
        if (!response.ok || body.ok !== true) {
            const conflict = Array.isArray(body.conflicts) && body.conflicts[0];
            const conflictText = conflict && conflict.email ? " Conflict: " + conflict.email + "." : "";
            throw new Error(normalizeString(body.message || body.error) || ("Registratiebatch mislukt (" + response.status + ").") + conflictText);
        }
        return body;
    }

    async function registerFile(file, controls) {
        const text = await file.text();
        const rows = mapRows(parseCsv(text));
        if (!rows.length) throw new Error("Het CSV-bestand bevat geen bedrijven.");
        const fileDigest = await sha256(text);
        const batchCount = Math.ceil(rows.length / BATCH_SIZE);
        const totals = { processed: 0, registered: 0, inserted: 0, updated: 0, alreadyTransferred: 0 };
        for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
            const batchRows = rows.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);
            setProgress(controls, "Registreren " + Math.min(rows.length, batchIndex * BATCH_SIZE + batchRows.length).toLocaleString("nl-NL") + " / " + rows.length.toLocaleString("nl-NL") + "...", false);
            const result = await postBatch(batchRows, {
                sourceId: SOURCE_ID,
                fileDigest: fileDigest,
                totalRows: rows.length,
                batchIndex: batchIndex,
                batchCount: batchCount
            });
            Object.keys(totals).forEach(function (key) { totals[key] += Number(result[key]) || 0; });
        }
        const nextUrl = new URL(global.location.href);
        nextUrl.searchParams.set(COMPLETION_PARAM, String(rows.length));
        global.location.assign(nextUrl.toString());
    }

    function bind() {
        const controls = createControls();
        if (!controls) return;
        const currentUrl = new URL(global.location.href);
        const completedRows = Number.parseInt(currentUrl.searchParams.get(COMPLETION_PARAM) || "", 10);
        if (Number.isInteger(completedRows) && completedRows > 0) {
            setProgress(controls, completedRows.toLocaleString("nl-NL") + " sheetbedrijven geregistreerd.", false);
            controls.instantlyButton.click();
            currentUrl.searchParams.delete(COMPLETION_PARAM);
            global.history.replaceState(null, "", currentUrl.toString());
        }
        controls.button.addEventListener("click", function () {
            if (!controls.button.disabled) controls.input.click();
        });
        controls.input.addEventListener("change", function () {
            const file = controls.input.files && controls.input.files[0];
            if (!file) return;
            controls.button.disabled = true;
            controls.button.textContent = "Registreren...";
            registerFile(file, controls).catch(function (error) {
                setProgress(controls, normalizeString(error && error.message) || "Registreren mislukt.", true);
                controls.button.disabled = false;
                controls.button.textContent = "Uploaden";
                controls.input.value = "";
            });
        });
    }

    if (typeof document !== "undefined") {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
        else bind();
    }

    if (typeof module !== "undefined" && module.exports) {
        module.exports = { BATCH_SIZE: BATCH_SIZE, EXPECTED_HEADERS: EXPECTED_HEADERS, mapRows: mapRows, parseCsv: parseCsv };
    }
})(typeof window !== "undefined" ? window : globalThis);
