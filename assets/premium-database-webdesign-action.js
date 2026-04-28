(function (global) {
    "use strict";

    const STYLE_ID = "softora-database-webdesign-action-style";
    const LIGHTNING_ICON = "<svg class=\"photo-generate-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"currentColor\" d=\"M13.25 2.25 4.9 13.35a.75.75 0 0 0 .6 1.2h5.08l-1.84 7.02a.75.75 0 0 0 1.33.62l8.95-11.55a.75.75 0 0 0-.6-1.21h-5.21l1.45-6.54a.75.75 0 0 0-1.41-.64Z\"/></svg>";

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function ensureStyles() {
        if (!global.document || global.document.getElementById(STYLE_ID)) return;
        const style = global.document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = ".photo-drop[data-has-photo=\"false\"][data-can-generate=\"true\"]{background:rgba(155,35,85,.08)}.photo-drop[data-has-photo=\"false\"][data-can-generate=\"false\"]{opacity:.55;cursor:not-allowed}.photo-generate-icon{width:18px;height:18px;color:var(--crimson);transition:transform .16s ease,color .16s ease}.photo-drop:hover .photo-generate-icon,.photo-drop:focus-visible .photo-generate-icon{color:var(--crimson-light);transform:scale(1.08)}";
        global.document.head.appendChild(style);
    }

    function createController(options) {
        const state = options.state;
        const escapeHtml = options.escapeHtml;
        const shouldShowWebsitePhoto = options.shouldShowWebsitePhoto;
        const isValidWebsitePhotoDataUrl = options.isValidWebsitePhotoDataUrl;
        const resolveCustomerWebsiteUrl = options.resolveCustomerWebsiteUrl;
        const isWebdesignPhotoEligible = options.isWebdesignPhotoEligible;
        const openWebsitePhotoPreview = options.openWebsitePhotoPreview;
        const generate = options.generate;
        const setStatusMessage = options.setStatusMessage;
        const isBusy = options.isBusy;
        ensureStyles();

        function getCustomerById(customerId) {
            return (state.klanten || []).find(function (item) {
                return item.id === customerId;
            }) || null;
        }

        function render(customer) {
            if (!shouldShowWebsitePhoto(customer)) return "";
            const photo = normalizeString(customer && customer.websitePhoto);
            const label = normalizeString(customer && customer.websitePhotoName) || "Websitefoto";
            const hasPhoto = isValidWebsitePhotoDataUrl(photo);
            const canGenerate = !hasPhoto && Boolean(resolveCustomerWebsiteUrl(customer));
            const inner = hasPhoto ? "<img src=\"" + escapeHtml(photo) + "\" alt=\"" + escapeHtml(label) + "\">" : LIGHTNING_ICON;
            const remove = hasPhoto ? "<button class=\"photo-remove\" type=\"button\" data-remove-photo-id=\"" + escapeHtml(customer.id) + "\" aria-label=\"Websitefoto verwijderen\">&times;</button>" : "";
            const ariaLabel = hasPhoto ? "Websitefoto bekijken" : (canGenerate ? "Webdesign maken" : "Geen geldige website gevonden");
            return "<div class=\"photo-cell\"><div class=\"photo-drop\" role=\"button\" tabindex=\"0\" data-photo-id=\"" + escapeHtml(customer.id) + "\" data-has-photo=\"" + (hasPhoto ? "true" : "false") + "\" data-can-generate=\"" + (canGenerate ? "true" : "false") + "\" aria-label=\"" + ariaLabel + "\">" + inner + remove + "</div></div>";
        }

        async function generateForCustomer(customerId) {
            const target = getCustomerById(customerId);
            if (!target) return;
            if (isValidWebsitePhotoDataUrl(target.websitePhoto)) {
                openWebsitePhotoPreview(customerId);
                return;
            }
            if (isBusy()) {
                setStatusMessage("Er wordt al een webdesign gemaakt. Wacht heel even tot deze klaar is.", "info", true);
                return;
            }
            if (!isWebdesignPhotoEligible(target)) {
                setStatusMessage("Geen geldige website gevonden voor " + target.bedrijf + ".", "error", true);
                return;
            }
            await generate([target]);
        }

        return {
            generateForCustomer: generateForCustomer,
            render: render
        };
    }

    global.SoftoraDatabaseWebdesignAction = {
        createController: createController
    };
})(window);
