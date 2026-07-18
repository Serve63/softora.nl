(function (global) {
    "use strict";

    const STYLE_ID = "softora-webdesign-variant-picker-style";
    const V1_VARIANT = "v1-prompt-only";
    const V2_VARIANT = "v2-visual-dna";
    let activeDialog = null;

    function ensureStyles() {
        if (!global.document || global.document.getElementById(STYLE_ID)) return;
        const style = global.document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = ".webdesign-variant-backdrop{position:fixed;inset:0;z-index:14000;display:grid;place-items:center;padding:24px;background:rgba(17,20,35,.58);backdrop-filter:blur(8px)}.webdesign-variant-dialog{width:min(560px,100%);border:1px solid rgba(155,35,85,.14);border-radius:24px;background:#fff;box-shadow:0 28px 80px rgba(17,20,35,.28);padding:26px;font-family:Inter,system-ui,sans-serif;color:#17192a}.webdesign-variant-eyebrow{color:#9b2355;font-size:12px;font-weight:900;letter-spacing:.11em;text-transform:uppercase}.webdesign-variant-title{margin:7px 0 5px;font-size:24px;line-height:1.15}.webdesign-variant-subtitle{margin:0 0 20px;color:#66697a;font-size:14px;line-height:1.5}.webdesign-variant-grid{display:grid;gap:12px}.webdesign-variant-option{position:relative;width:100%;border:1px solid #e4e4eb;border-radius:18px;background:#fff;padding:18px;text-align:left;cursor:pointer;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}.webdesign-variant-option:hover,.webdesign-variant-option:focus-visible{outline:none;border-color:#9b2355;box-shadow:0 12px 30px rgba(155,35,85,.12);transform:translateY(-1px)}.webdesign-variant-option--recommended{border-color:rgba(155,35,85,.38);background:linear-gradient(145deg,rgba(155,35,85,.07),rgba(255,255,255,.98) 58%)}.webdesign-variant-badge{display:inline-flex;margin-bottom:8px;border-radius:999px;background:#9b2355;color:#fff;padding:5px 8px;font-size:10px;font-weight:900;letter-spacing:.05em;text-transform:uppercase}.webdesign-variant-name{display:block;font-size:17px;font-weight:850;line-height:1.25}.webdesign-variant-copy{display:block;margin-top:5px;color:#66697a;font-size:13px;line-height:1.45}.webdesign-variant-cost{display:block;margin-top:10px;color:#9b2355;font-size:12px;font-weight:850}.webdesign-variant-cancel{display:block;margin:16px auto 0;border:0;background:transparent;color:#77798a;font-size:13px;font-weight:750;cursor:pointer}.webdesign-variant-cancel:hover,.webdesign-variant-cancel:focus-visible{color:#9b2355;outline:none;text-decoration:underline}@media(max-width:620px){.webdesign-variant-backdrop{padding:14px}.webdesign-variant-dialog{border-radius:20px;padding:20px}.webdesign-variant-title{font-size:21px}}";
        global.document.head.appendChild(style);
    }

    function createTextElement(tagName, className, text) {
        const element = global.document.createElement(tagName);
        element.className = className;
        element.textContent = text;
        return element;
    }

    function createOption(variant, name, copy, cost, recommended) {
        const button = global.document.createElement("button");
        button.type = "button";
        button.className = "webdesign-variant-option" + (recommended ? " webdesign-variant-option--recommended" : "");
        button.setAttribute("data-webdesign-variant", variant);
        if (recommended) button.appendChild(createTextElement("span", "webdesign-variant-badge", "Nieuw · beste stijlmatch"));
        button.appendChild(createTextElement("span", "webdesign-variant-name", name));
        button.appendChild(createTextElement("span", "webdesign-variant-copy", copy));
        button.appendChild(createTextElement("span", "webdesign-variant-cost", cost));
        return button;
    }

    function choose(options) {
        if (!global.document || !global.document.body || !global.document.createElement) {
            return Promise.resolve(V1_VARIANT);
        }
        if (activeDialog && typeof activeDialog.close === "function") activeDialog.close(null);
        ensureStyles();

        return new Promise(function (resolve) {
            const backdrop = global.document.createElement("div");
            backdrop.className = "webdesign-variant-backdrop";
            const dialog = global.document.createElement("div");
            dialog.className = "webdesign-variant-dialog";
            dialog.setAttribute("role", "dialog");
            dialog.setAttribute("aria-modal", "true");
            dialog.setAttribute("aria-labelledby", "webdesignVariantTitle");

            const company = String(options && options.company || "").trim();
            dialog.appendChild(createTextElement("div", "webdesign-variant-eyebrow", "Webdesign maken"));
            const title = createTextElement("h2", "webdesign-variant-title", "Kies de ontwerpvariant");
            title.id = "webdesignVariantTitle";
            dialog.appendChild(title);
            dialog.appendChild(createTextElement(
                "p",
                "webdesign-variant-subtitle",
                company ? "Welke aanpak wil je gebruiken voor " + company + "?" : "Welke aanpak wil je gebruiken?"
            ));

            const grid = global.document.createElement("div");
            grid.className = "webdesign-variant-grid";
            const v2Button = createOption(
                V2_VARIANT,
                "V2 — Visuele stijlmatch",
                "Gebruikt een echte homepage-screenshot als visueel DNA voor kleuren, typografie, sfeer en branche, met een radicaal nieuwe layout.",
                "Geschatte API-kosten: circa €0,06",
                true
            );
            const v1Button = createOption(
                V1_VARIANT,
                "V1 — Originele generator",
                "De bestaande snelle tekstscan zonder screenshot; exact het huidige pad blijft beschikbaar als terugval.",
                "Geschatte API-kosten: circa €0,01",
                false
            );
            grid.appendChild(v2Button);
            grid.appendChild(v1Button);
            dialog.appendChild(grid);

            const cancel = createTextElement("button", "webdesign-variant-cancel", "Annuleren");
            cancel.type = "button";
            dialog.appendChild(cancel);
            backdrop.appendChild(dialog);
            global.document.body.appendChild(backdrop);

            let settled = false;
            function close(value) {
                if (settled) return;
                settled = true;
                if (global.document && typeof global.document.removeEventListener === "function") {
                    global.document.removeEventListener("keydown", onKeyDown);
                }
                if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
                if (activeDialog && activeDialog.backdrop === backdrop) activeDialog = null;
                resolve(value);
            }
            function onKeyDown(event) {
                if (event && event.key === "Escape") close(null);
            }
            v2Button.addEventListener("click", function () { close(V2_VARIANT); });
            v1Button.addEventListener("click", function () { close(V1_VARIANT); });
            cancel.addEventListener("click", function () { close(null); });
            backdrop.addEventListener("click", function (event) {
                if (event && event.target === backdrop) close(null);
            });
            if (typeof global.document.addEventListener === "function") {
                global.document.addEventListener("keydown", onKeyDown);
            }
            activeDialog = { backdrop: backdrop, close: close };
            if (typeof v2Button.focus === "function") v2Button.focus();
        });
    }

    global.SoftoraDatabaseWebdesignVariantPicker = {
        V1_VARIANT: V1_VARIANT,
        V2_VARIANT: V2_VARIANT,
        choose: choose
    };
})(typeof window !== "undefined" ? window : globalThis);
