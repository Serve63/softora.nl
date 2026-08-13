(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (!root || !root.document) return;
    root.SoftoraLiveMomentumFocusMode = api;
    api.init({ window: root, document: root.document });
})(typeof window !== "undefined" ? window : null, function () {
    const SCROLLER_SELECTOR = ".bar-chart-viewport, .habit-board, .end-game-goals";

    function init(options) {
        const win = options && options.window;
        const doc = options && options.document;
        const body = doc && doc.body;
        const button = doc && doc.querySelector("[data-momentum-focus-toggle]");
        if (!win || !doc || !body || !button || button.dataset.momentumFocusReady === "1") return null;

        const captureScroll = function () {
            return {
                x: Number(win.scrollX) || 0,
                y: Number(win.scrollY) || 0,
                scrollers: Array.from(doc.querySelectorAll(SCROLLER_SELECTOR)).map(function (element) {
                    return { element: element, left: element.scrollLeft, top: element.scrollTop };
                }),
            };
        };
        const restoreScroll = function (snapshot) {
            const apply = function () {
                win.scrollTo(snapshot.x, snapshot.y);
                snapshot.scrollers.forEach(function (item) {
                    item.element.scrollLeft = item.left;
                    item.element.scrollTop = item.top;
                });
            };
            if (typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(apply);
            else apply();
        };
        const setFocusMode = function (enabled, preserveScroll) {
            const next = Boolean(enabled);
            const snapshot = preserveScroll === false ? null : captureScroll();
            body.classList.toggle("momentum-focus-mode", next);
            button.setAttribute("aria-pressed", next ? "true" : "false");
            const label = next ? "Normale weergave herstellen" : "Vergrote weergave openen";
            button.setAttribute("aria-label", label);
            button.setAttribute("title", label);
            if (snapshot) restoreScroll(snapshot);
            return next;
        };
        const onClick = function () {
            setFocusMode(button.getAttribute("aria-pressed") !== "true");
        };
        const onKeydown = function (event) {
            if (event.key !== "Escape" || button.getAttribute("aria-pressed") !== "true") return;
            setFocusMode(false);
            button.focus({ preventScroll: true });
        };
        const onPageShow = function () {
            setFocusMode(false, false);
        };

        button.dataset.momentumFocusReady = "1";
        setFocusMode(false, false);
        button.addEventListener("click", onClick);
        doc.addEventListener("keydown", onKeydown);
        win.addEventListener("pageshow", onPageShow);
        return { setFocusMode: setFocusMode, destroy: function () {
            button.removeEventListener("click", onClick);
            doc.removeEventListener("keydown", onKeydown);
            win.removeEventListener("pageshow", onPageShow);
            delete button.dataset.momentumFocusReady;
            setFocusMode(false, false);
        } };
    }

    return { init: init };
});
