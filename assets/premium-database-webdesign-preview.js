(function (global) {
    "use strict";

    const STYLE_ID = "softora-database-webdesign-preview-style";
    const COMPARE_ICON = "<svg class=\"photo-compare-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.9 5.03M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07l1.22-1.22\"/></svg>";
    const DIAMOND_ICON = "<svg class=\"photo-diamond-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M6.75 3.75h10.5L21 8.75 12 20.25 3 8.75l3.75-5Z\"/><path fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M3 8.75h18M8 3.75l-2 5 6 11.5 6-11.5-2-5\"/></svg>";
    const VIDEO_ICON = "<svg class=\"photo-video-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><rect x=\"3.5\" y=\"6.5\" width=\"12\" height=\"11\" rx=\"2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"m15.5 10 5-2.75v9.5l-5-2.75\"/></svg>";

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function slugifyPublicPreview(value, fallback) {
        const normalized = normalizeString(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
        return slug || fallback || "webdesign";
    }

    function ensureStyles() {
        if (!global.document || global.document.getElementById(STYLE_ID)) return;
        const style = global.document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = ".photo-cell{width:172px;min-width:172px}.photo-compare-link,.photo-diamond-badge,.photo-video-link{flex:0 0 22px;width:22px;height:34px;border:0;background:transparent;color:var(--crimson);display:inline-flex;align-items:center;justify-content:center;padding:0;text-decoration:none;opacity:.86}.photo-compare-link,.photo-diamond-badge,.photo-video-link{cursor:pointer}.photo-diamond-badge,.photo-video-link{color:var(--crimson-light);opacity:.9}.photo-compare-link:hover,.photo-compare-link:focus-visible,.photo-diamond-badge:hover,.photo-diamond-badge:focus-visible,.photo-video-link:hover,.photo-video-link:focus-visible{color:var(--crimson-light);opacity:1}.photo-compare-icon,.photo-diamond-icon,.photo-video-icon{width:16px;height:16px}.photo-preview-card.is-comparison{width:min(1500px,94vw);max-width:min(1500px,94vw)}.photo-preview-image[hidden],.photo-preview-compare[hidden]{display:none}.photo-preview-compare{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}.photo-preview-panel{min-width:0;display:flex;flex-direction:column;gap:8px;margin:0}.photo-preview-panel img{display:block;width:100%;max-height:80vh;border-radius:0;background:transparent;box-shadow:none;object-fit:contain}.photo-preview-caption{color:rgba(255,255,255,.78);font-size:12px;text-align:center;line-height:1.35}@media(max-width:760px){.photo-preview-card.is-comparison{width:min(620px,94vw)}.photo-preview-compare{grid-template-columns:1fr}.photo-preview-panel img{max-height:40vh}}";
        global.document.head.appendChild(style);
    }

    function getPreviewCard(nodes) {
        return nodes && nodes.photoPreview && typeof nodes.photoPreview.querySelector === "function" ? nodes.photoPreview.querySelector(".photo-preview-card") : null;
    }

    function createCompareFigure(documentRef, imageId, captionId) {
        const figure = documentRef.createElement("figure");
        const image = documentRef.createElement("img");
        const caption = documentRef.createElement("figcaption");
        figure.className = "photo-preview-panel";
        image.id = imageId;
        image.alt = "";
        caption.id = captionId;
        caption.className = "photo-preview-caption";
        figure.appendChild(image);
        figure.appendChild(caption);
        return figure;
    }

    function ensureComparisonPreviewNodes(nodes) {
        const documentRef = global.document;
        const card = getPreviewCard(nodes);
        if (!documentRef || !card) return null;
        let compare = documentRef.getElementById("photoPreviewCompare");
        if (!compare) {
            compare = documentRef.createElement("div");
            compare.className = "photo-preview-compare";
            compare.id = "photoPreviewCompare";
            compare.hidden = true;
            compare.appendChild(createCompareFigure(documentRef, "photoPreviewComparePhoto", "photoPreviewComparePhotoCaption"));
            compare.appendChild(createCompareFigure(documentRef, "photoPreviewCompareMockup", "photoPreviewCompareMockupCaption"));
            card.insertBefore(compare, nodes.photoPreviewMeta || null);
        }
        return {
            card: card,
            compare: compare,
            photo: documentRef.getElementById("photoPreviewComparePhoto"),
            photoCaption: documentRef.getElementById("photoPreviewComparePhotoCaption"),
            mockup: documentRef.getElementById("photoPreviewCompareMockup"),
            mockupCaption: documentRef.getElementById("photoPreviewCompareMockupCaption")
        };
    }

    function reset(nodes) {
        const refs = ensureComparisonPreviewNodes(nodes);
        if (!refs) return;
        refs.card.classList.remove("is-comparison");
        if (nodes && nodes.photoPreviewImage) nodes.photoPreviewImage.hidden = false;
        if (nodes && nodes.photoPreviewMeta) nodes.photoPreviewMeta.hidden = false;
        refs.compare.hidden = true;
        [refs.photo, refs.mockup].forEach(function (image) {
            if (!image) return;
            image.removeAttribute("src");
            image.alt = "";
        });
        [refs.photoCaption, refs.mockupCaption].forEach(function (caption) {
            if (caption) caption.textContent = "";
        });
    }

    function openComparison(nodes, customer, helpers) {
        const normalizeValue = helpers && typeof helpers.normalizeString === "function" ? helpers.normalizeString : normalizeString;
        const isValidSource = helpers && typeof helpers.isValidWebsitePhotoSource === "function" ? helpers.isValidWebsitePhotoSource : function (value) { return /^data:image\//i.test(normalizeValue(value)); };
        const photo = normalizeValue(customer && customer.websitePhoto);
        const mockup = normalizeValue(customer && customer.websiteMockup);
        if (!customer || !isValidSource(photo) || !isValidSource(mockup)) return false;
        const refs = ensureComparisonPreviewNodes(nodes);
        if (!refs) return false;
        const photoLabel = normalizeValue(customer.websitePhotoName) || "Websitefoto";
        const mockupLabel = normalizeValue(customer.websiteMockupName) || "Device mockup";
        refs.card.classList.add("is-comparison");
        if (nodes.photoPreviewImage) {
            nodes.photoPreviewImage.hidden = true;
            nodes.photoPreviewImage.removeAttribute("src");
            nodes.photoPreviewImage.alt = "";
        }
        refs.compare.hidden = false;
        refs.photo.src = photo;
        refs.photo.alt = photoLabel;
        refs.photoCaption.textContent = photoLabel;
        refs.mockup.src = mockup;
        refs.mockup.alt = mockupLabel;
        refs.mockupCaption.textContent = mockupLabel;
        if (nodes.photoPreviewMeta) { nodes.photoPreviewMeta.hidden = true; nodes.photoPreviewMeta.textContent = ""; }
        if (nodes.photoPreview) {
            nodes.photoPreview.classList.add("on");
            nodes.photoPreview.setAttribute("aria-hidden", "false");
        }
        return true;
    }

    function resolveCustomerWebsiteUrl(customer) {
        return normalizeString(customer && (customer.website || customer.websiteUrl || customer.url || customer.dom || customer.domain));
    }

    function pushQueryParam(parts, key, value) {
        const normalized = normalizeString(value);
        if (!normalized) return;
        parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(normalized));
    }

    function buildCinematicHref(customer, id, intent) {
        const parts = [];
        pushQueryParam(parts, "customerId", id);
        pushQueryParam(parts, "company", customer && (customer.bedrijf || customer.company || customer.companyName || customer.naam));
        pushQueryParam(parts, "domain", customer && (customer.dom || customer.domain));
        pushQueryParam(parts, "website", resolveCustomerWebsiteUrl(customer));
        pushQueryParam(parts, "intent", intent);
        return "/premium-cinematic-website" + (parts.length ? "?" + parts.join("&") : "");
    }

    function renderLink(customer, options) {
        const escapeHtml = options && typeof options.escapeHtml === "function" ? options.escapeHtml : function (value) { return String(value || ""); };
        const id = normalizeString(customer && customer.id);
        if (!options || !options.show || !id) return "";
        const slug = slugifyPublicPreview(customer && (customer.bedrijf || customer.company || customer.companyName || customer.naam), encodeURIComponent(id));
        const cinematicHref = buildCinematicHref(customer, id, "");
        const videoHref = buildCinematicHref(customer, id, "video");
        return "<a class=\"photo-compare-link\" href=\"https://www.softora.nl/webdesign/" + escapeHtml(slug) + "\" target=\"_blank\" rel=\"noopener\" data-public-preview-id=\"" + escapeHtml(id) + "\" aria-label=\"Open openbare previewpagina\" title=\"Open openbare pagina\">" + COMPARE_ICON + "</a><a class=\"photo-diamond-badge photo-cinematic-link\" href=\"" + escapeHtml(cinematicHref) + "\" target=\"_blank\" rel=\"noopener\" data-cinematic-customer-id=\"" + escapeHtml(id) + "\" aria-label=\"Start cinematic websiteflow\" title=\"Start cinematic websiteflow\">" + DIAMOND_ICON + "</a><a class=\"photo-video-link photo-cinematic-video-link\" href=\"" + escapeHtml(videoHref) + "\" target=\"_blank\" rel=\"noopener\" data-cinematic-video-customer-id=\"" + escapeHtml(id) + "\" aria-label=\"Start cinematic videoflow\" title=\"Start cinematic videoflow\">" + VIDEO_ICON + "</a>";
    }

    ensureStyles();
    global.SoftoraDatabaseWebdesignPreview = {
        openComparison: openComparison,
        renderLink: renderLink,
        reset: reset
    };
})(window);
