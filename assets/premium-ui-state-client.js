(function (global) {
    "use strict";

    function normalizeScope(scope) {
        return encodeURIComponent(String(scope || ""));
    }

    function getReadUrls(scope) {
        var encodedScope = normalizeScope(scope);
        return [
            "/api/ui-state-get?scope=" + encodedScope,
            "/api/ui-state/" + encodedScope
        ];
    }

    function getWriteUrls(scope) {
        var encodedScope = normalizeScope(scope);
        return [
            "/api/ui-state-set?scope=" + encodedScope,
            "/api/ui-state/" + encodedScope
        ];
    }

    async function parseJsonResponse(response) {
        return await response.json().catch(function () { return {}; });
    }

    async function requestWithFallback(urls, options, label) {
        var lastError = null;

        for (var index = 0; index < urls.length; index += 1) {
            try {
                var response = await fetch(urls[index], options);
                if (!response.ok) throw new Error(label + " mislukt (" + response.status + ")");
                return await parseJsonResponse(response);
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error(label + " mislukt");
    }

    async function getUiState(scope) {
        return await requestWithFallback(
            getReadUrls(scope),
            { method: "GET", cache: "no-store" },
            "UI-state GET"
        );
    }

    async function setUiState(scope, body) {
        return await requestWithFallback(
            getWriteUrls(scope),
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body || {})
            },
            "UI-state POST"
        );
    }

    global.SoftoraUiStateClient = {
        get: getUiState,
        set: setUiState
    };
})(window);
