(function (root, factory) {
    const api = factory(root);
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.SoftoraDatabaseStatusMessage = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
    "use strict";

    function show(state, banner, message, tone, autoClear) {
        if (state.messageTimer) {
            root.clearTimeout(state.messageTimer);
            state.messageTimer = null;
        }
        if (!message || !tone || tone === "info") {
            banner.textContent = "";
            banner.classList.remove("is-visible");
            banner.dataset.tone = "";
            return;
        }
        banner.textContent = String(message);
        banner.dataset.tone = tone;
        banner.classList.add("is-visible");
        if (autoClear) {
            state.messageTimer = root.setTimeout(function () {
                show(state, banner, "");
            }, 3200);
        }
    }

    return { show: show };
});
