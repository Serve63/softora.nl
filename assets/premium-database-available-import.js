(function (global) {
    "use strict";

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function createElement(tagName, className) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        return element;
    }

    function isDatabaseImportFile(file) {
        const name = normalizeString(file && file.name).toLowerCase();
        const type = normalizeString(file && file.type).toLowerCase();
        return /\.csv$|\.tsv$|\.xlsx$/.test(name)
            || type === "text/csv"
            || type === "text/tab-separated-values"
            || type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            || type === "application/vnd.ms-excel";
    }

    function getDatabaseImportFile(dataTransfer) {
        const files = dataTransfer && dataTransfer.files ? Array.from(dataTransfer.files) : [];
        return files.find(isDatabaseImportFile) || null;
    }

    function hasDatabaseImportDrag(dataTransfer) {
        const items = dataTransfer && dataTransfer.items ? Array.from(dataTransfer.items) : [];
        if (!items.length) return false;
        return items.some(function (item) {
            const type = normalizeString(item && item.type).toLowerCase();
            return type === "text/csv"
                || type === "text/tab-separated-values"
                || type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                || type === "application/vnd.ms-excel"
                || type === "";
        });
    }

    function isPhotoDropDragTarget(target) {
        return Boolean(target && target.closest && target.closest(".photo-drop[data-photo-id]"));
    }

    function createImportActions() {
        const actions = createElement("div", "database-import-actions");
        actions.id = "databaseImportActions";
        actions.hidden = true;

        const button = createElement("button", "database-import-button");
        button.id = "databaseImportButton";
        button.type = "button";
        button.textContent = "CSV uploaden";

        actions.append(button);
        return { actions: actions, button: button };
    }

    function findAvailablePills() {
        const availableButton = document.querySelector(".status-filter-group--shared [data-s=\"beschikbaar\"]");
        return availableButton && availableButton.closest ? availableButton.closest(".status-filter-pills") : null;
    }

    function createImportInput() {
        const input = document.createElement("input");
        input.type = "file";
        input.id = "importFileInput";
        input.accept = ".csv,text/csv,.tsv,text/tab-separated-values,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        input.hidden = true;
        return input;
    }

    function createDropOverlay() {
        const overlay = createElement("div", "database-import-drop-overlay");
        overlay.id = "databaseImportDropOverlay";
        overlay.hidden = true;
        overlay.setAttribute("aria-hidden", "true");

        const card = createElement("div", "database-import-drop-card");
        const icon = createElement("div", "database-import-drop-icon");
        const title = createElement("div", "database-import-drop-title");
        const subtitle = createElement("div", "database-import-drop-sub");

        icon.textContent = "CSV";
        title.textContent = "Laat los om te uploaden";
        subtitle.textContent = "We zetten de bedrijven direct onder Beschikbaar en slaan ze op.";

        card.append(icon, title, subtitle);
        overlay.append(card);
        return overlay;
    }

    function createController(deps) {
        const state = deps.state;
        const importController = deps.importController;
        const setStatusMessage = deps.setStatusMessage;
        let importBusy = false;
        let importDragDepth = 0;
        let actions = null;
        let button = null;
        let input = null;
        let overlay = null;

        function isAvailableImportActive() {
            return state && state.activeStatus === "beschikbaar";
        }

        function renderControls() {
            if (!actions || !button) return;
            actions.hidden = !isAvailableImportActive();
            button.disabled = importBusy;
            button.textContent = importBusy ? "Uploaden..." : "CSV uploaden";
        }

        function setDropActive(active) {
            if (!overlay) return;
            overlay.hidden = !active;
            overlay.setAttribute("aria-hidden", active ? "false" : "true");
        }

        function shouldShowDrop(event) {
            if (!isAvailableImportActive() || isPhotoDropDragTarget(event && event.target)) return false;
            return Boolean(getDatabaseImportFile(event && event.dataTransfer) || hasDatabaseImportDrag(event && event.dataTransfer));
        }

        async function importAvailableFile(file) {
            if (!file) return false;
            if (!isAvailableImportActive()) {
                setStatusMessage("CSV uploaden kan alleen op Beschikbaar.", "info", true);
                return false;
            }
            if (!isDatabaseImportFile(file)) {
                setStatusMessage("Gebruik een CSV-, TSV- of Excelbestand.", "error", true);
                return false;
            }
            if (importBusy) return false;
            importBusy = true;
            renderControls();
            try {
                return await importController.importFile(file, { defaultStatus: "prospect", source: "available-upload" });
            } finally {
                importBusy = false;
                importDragDepth = 0;
                if (input) input.value = "";
                setDropActive(false);
                renderControls();
            }
        }

        function bindDragEvents() {
            document.addEventListener("dragenter", function (event) {
                if (!shouldShowDrop(event)) return;
                event.preventDefault();
                importDragDepth += 1;
                setDropActive(true);
            });

            document.addEventListener("dragover", function (event) {
                if (!shouldShowDrop(event)) return;
                event.preventDefault();
                setDropActive(true);
            });

            document.addEventListener("dragleave", function () {
                if (!isAvailableImportActive()) return;
                importDragDepth = Math.max(0, importDragDepth - 1);
                if (!importDragDepth) setDropActive(false);
            });

            document.addEventListener("drop", function (event) {
                if (!isAvailableImportActive()) return;
                const file = getDatabaseImportFile(event.dataTransfer);
                if (!file) {
                    if (shouldShowDrop(event)) {
                        event.preventDefault();
                        importDragDepth = 0;
                        setDropActive(false);
                        setStatusMessage("Gebruik een CSV-, TSV- of Excelbestand.", "error", true);
                    }
                    return;
                }
                event.preventDefault();
                importDragDepth = 0;
                setDropActive(false);
                void importAvailableFile(file);
            });
        }

        function bind() {
            const filterBar = document.querySelector(".filter-bar");
            if (!filterBar || !importController || typeof importController.importFile !== "function") return;

            const builtActions = createImportActions();
            actions = builtActions.actions;
            button = builtActions.button;
            input = createImportInput();
            overlay = createDropOverlay();

            const availablePills = findAvailablePills();
            if (availablePills) availablePills.append(actions);
            else filterBar.append(actions);
            document.body.append(input, overlay);

            button.addEventListener("click", function () {
                if (!isAvailableImportActive() || importBusy) return;
                input.click();
            });

            input.addEventListener("change", function (event) {
                const file = event.target.files && event.target.files[0];
                void importAvailableFile(file);
            });

            document.querySelectorAll(".sf-btn").forEach(function (statusButton) {
                statusButton.addEventListener("click", function () {
                    window.requestAnimationFrame(renderControls);
                });
            });

            bindDragEvents();
            renderControls();
        }

        return {
            bind: bind,
            importAvailableFile: importAvailableFile,
            renderControls: renderControls
        };
    }

    global.SoftoraDatabaseAvailableImport = {
        createController: createController,
        isDatabaseImportFile: isDatabaseImportFile
    };
})(window);
