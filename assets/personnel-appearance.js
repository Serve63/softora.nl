(function (global) {
    "use strict";
    const doc = global.document;
    const root = doc.documentElement;
    const script = doc.currentScript;
    const owner = String(script && script.getAttribute("data-theme-owner") || "").trim().toLowerCase();
    const model = "personnel-appearance:v1";
    const store = global.SoftoraReadModelStore;
    let mode = "light";
    try {
        if (store && owner && store.readSync(model, owner) === "dark") mode = "dark";
    } catch (_) { /* A blocked browser store must not block appearance controls. */ }

    function syncControls() {
        doc.querySelectorAll("[data-personnel-theme-toggle]").forEach(function (button) {
            const label = mode === "dark" ? "Lichte modus inschakelen" : "Donkere modus inschakelen";
            button.setAttribute("aria-label", label);
            button.setAttribute("title", label);
            button.setAttribute("aria-pressed", String(mode === "dark"));
        });
        doc.querySelectorAll(".theme-switch-btn[data-theme-value]").forEach(function (button) {
            const active = button.getAttribute("data-theme-value") === mode;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
    }

    function applyMode(value, persist) {
        mode = value === "dark" ? "dark" : "light";
        root.setAttribute("data-theme-mode", mode);
        root.setAttribute("data-theme", mode);
        syncControls();
        if (persist !== false && store && owner) {
            try { store.writeSync(model, owner, mode); } catch (_) { /* Keep the current page usable. */ }
        }
        return mode;
    }

    function mountToggle() {
        const date = doc.getElementById("currentDate");
        if (!date || !date.parentElement || doc.querySelector("[data-personnel-theme-toggle]")) return;
        const host = date.closest(".topbar-date") || date;
        host.classList.add("personnel-theme-date");
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "personnel-theme-toggle";
        button.setAttribute("data-personnel-theme-toggle", "");
        button.innerHTML = '<svg class="personnel-theme-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.9 13.1A9 9 0 0 1 10.9 3.1 9 9 0 1 0 20.9 13.1Z"/></svg><svg class="personnel-theme-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
        button.addEventListener("click", function () { applyMode(mode === "dark" ? "light" : "dark"); });
        host.insertAdjacentElement("afterend", button);
        syncControls();
    }

    global.SoftoraPersonnelAppearance = { getMode: function () { return mode; }, applyMode: applyMode };
    applyMode(mode, false);
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", mountToggle, { once: true });
    else mountToggle();
    global.addEventListener("storage", function (event) {
        if (event.key !== null && event.key !== "softora-readmodel-sync:" + model) return;
        try { applyMode(store && owner ? store.readSync(model, owner) : "light", false); } catch (_) { /* Ignore unavailable storage. */ }
    });
})(window);
