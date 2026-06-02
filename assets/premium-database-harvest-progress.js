(function (global) {
    "use strict";

    const HARVEST_PROGRESS_URL = "assets/premium-database-harvest-progress.json";

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

    function readHarvestProgress() {
        if (global.__SOFTORA_DISABLE_HARVEST_PROGRESS_POLL || typeof fetch !== "function") return Promise.resolve(null);
        return fetch(HARVEST_PROGRESS_URL + "?t=" + encodeURIComponent(String(Date.now())), {
            method: "GET",
            headers: { "Accept": "application/json" }
        }).then(function (response) {
            if (!response || !response.ok) return null;
            return response.json().catch(function () { return null; });
        }).catch(function () {
            return null;
        });
    }

    function isProgressDone(item) {
        const status = normalizeString(item && item.status).toLowerCase();
        return Boolean(item && (item.completed || status === "afgerond" || status === "done" || status === "completed"));
    }

    function buildTargetProgress(payload) {
        const labels = [];
        const seen = new Set();
        function addLabel(label, item) {
            const normalizedLabel = normalizeString(label);
            const key = normalizeKey(normalizedLabel);
            if (!key || seen.has(key)) return;
            seen.add(key);
            labels.push({
                label: normalizedLabel,
                status: "done",
                placeComplete: true,
                completionReason: normalizeString(item && item.completionReason) || "Afgerond in lokale verzamellijst.",
                updatedAt: normalizeString(item && item.updatedAt) || normalizeString(payload && payload.updatedAt)
            });
        }
        (Array.isArray(payload && payload.completedTargetLabels) ? payload.completedTargetLabels : []).forEach(function (label) {
            addLabel(label, null);
        });
        (Array.isArray(payload && payload.targetProgress) ? payload.targetProgress : []).forEach(function (item) {
            if (!isProgressDone(item)) return;
            addLabel(item.label || item.target, item);
        });
        return labels;
    }

    function createBridge(options) {
        const bridgeOptions = options || {};
        const customReadProgress = typeof bridgeOptions.readHarvestProgress === "function"
            ? bridgeOptions.readHarvestProgress
            : null;

        function readProgress() {
            return customReadProgress ? Promise.resolve(customReadProgress()) : readHarvestProgress();
        }

        function applyToState(state, payload) {
            if (
                typeof bridgeOptions.normalizeState !== "function"
                || typeof bridgeOptions.applyTargetProgress !== "function"
            ) {
                return null;
            }
            const progress = buildTargetProgress(payload);
            if (!progress.length) return null;
            return bridgeOptions.normalizeState({
                version: 2,
                targetOrderVersion: bridgeOptions.targetOrderVersion,
                targets: bridgeOptions.applyTargetProgress(state.targets, progress),
                activeIndex: state.activeIndex,
                desiredCompanyCount: state.desiredCompanyCount,
                updatedAt: state.updatedAt
            });
        }

        return {
            applyToState: applyToState,
            buildTargetProgress: buildTargetProgress,
            readProgress: readProgress
        };
    }

    global.SoftoraDatabaseHarvestProgress = {
        buildTargetProgress: buildTargetProgress,
        createBridge: createBridge,
        readHarvestProgress: readHarvestProgress
    };
})(window);
