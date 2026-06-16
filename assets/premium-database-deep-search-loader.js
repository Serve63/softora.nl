(function (global) {
    "use strict";

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function createController(options) {
        const scriptUrls = options && options.scriptUrls || {};
        const setStatusMessage = typeof options.setStatusMessage === "function" ? options.setStatusMessage : function () {};
        const toast = typeof options.toast === "function" ? options.toast : function () {};
        const scriptPromises = new Map();
        let controller = null;
        let loadPromise = null;

        function loadScriptOnce(src) {
            const url = normalizeString(src);
            if (!url) return Promise.reject(new Error("Script-url ontbreekt."));
            if (scriptPromises.has(url)) return scriptPromises.get(url);
            const promise = new Promise(function (resolve, reject) {
                const script = document.createElement("script");
                script.src = url;
                script.async = false;
                script.onload = function () { resolve(); };
                script.onerror = function () { reject(new Error("Script laden mislukt: " + url)); };
                document.head.appendChild(script);
            });
            scriptPromises.set(url, promise);
            return promise;
        }

        function createDeepSearchController() {
            if (!global.SoftoraDatabaseDeepSearch || typeof global.SoftoraDatabaseDeepSearch.createController !== "function") {
                throw new Error("Bedrijvenlijst module is niet beschikbaar.");
            }
            controller = global.SoftoraDatabaseDeepSearch.createController({
                nodes: options.nodes,
                getUiState: options.getUiState,
                setUiState: options.setUiState,
                scope: options.scope,
                stateKey: options.stateKey,
                importRows: options.importRows,
                recordApiCost: options.recordApiCost,
                getCustomers: options.getCustomers,
                setStatusMessage: setStatusMessage,
                toast: toast
            });
            controller.bind();
            return controller;
        }

        function ensure() {
            if (controller) return Promise.resolve(controller);
            if (!loadPromise) {
                setStatusMessage("Bedrijvenlijst laden...", "info");
                loadPromise = loadScriptOnce(scriptUrls.deepSearchHelpers)
                    .then(function () { return loadScriptOnce(scriptUrls.targetCoords); })
                    .then(function () { return loadScriptOnce(scriptUrls.deepSearch); })
                    .then(createDeepSearchController)
                    .catch(function (error) {
                        loadPromise = null;
                        setStatusMessage("Bedrijvenlijst laden mislukt: " + String(error && error.message || "onbekende fout"), "error", true);
                        throw error;
                    });
            }
            return loadPromise;
        }

        async function open() {
            try {
                const current = await ensure();
                current.open();
            } catch (error) {
                if (global.console && typeof global.console.error === "function") {
                    global.console.error("Bedrijvenlijst openen mislukt:", error);
                }
            }
        }

        return {
            close: function () { return controller && typeof controller.close === "function" ? controller.close() : true; },
            ensure: ensure,
            isBusy: function () { return Boolean(controller && typeof controller.isBusy === "function" && controller.isBusy()); },
            isOpen: function () { return Boolean(controller && typeof controller.isOpen === "function" && controller.isOpen()); },
            open: open
        };
    }

    global.SoftoraDatabaseDeepSearchLoader = {
        createController: createController
    };
})(window);
