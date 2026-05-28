(function (global) {
    "use strict";

    const STYLE_ID = "softora-database-webdesign-preview-style";
    const COMPARE_ICON = "<svg class=\"photo-compare-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.9 5.03M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07l1.22-1.22\"/></svg>";

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function ensureStyles() {
        if (!global.document || global.document.getElementById(STYLE_ID)) return;
        const style = global.document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = ".photo-cell{width:98px;min-width:98px}.photo-compare-link{flex:0 0 22px;width:22px;height:34px;border:0;background:transparent;color:var(--crimson);display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer;text-decoration:none;opacity:.86}.photo-compare-link:hover,.photo-compare-link:focus-visible{color:var(--crimson-light);opacity:1}.photo-compare-icon{width:16px;height:16px}.photo-preview-card.is-comparison{width:min(1500px,94vw);max-width:min(1500px,94vw)}.photo-preview-image[hidden],.photo-preview-compare[hidden]{display:none}.photo-preview-compare{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}.photo-preview-panel{min-width:0;display:flex;flex-direction:column;gap:8px;margin:0}.photo-preview-panel img{display:block;width:100%;max-height:80vh;border-radius:0;background:transparent;box-shadow:none;object-fit:contain}.photo-preview-caption{color:rgba(255,255,255,.78);font-size:12px;text-align:center;line-height:1.35}@media(max-width:760px){.photo-preview-card.is-comparison{width:min(620px,94vw)}.photo-preview-compare{grid-template-columns:1fr}.photo-preview-panel img{max-height:40vh}}";
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

    function renderLink(customer, options) {
        const escapeHtml = options && typeof options.escapeHtml === "function" ? options.escapeHtml : function (value) { return String(value || ""); };
        if (!options || !options.show) return "";
        return "<a class=\"photo-compare-link\" href=\"#website-preview-" + escapeHtml(customer && customer.id) + "\" data-photo-compare-id=\"" + escapeHtml(customer && customer.id) + "\" aria-label=\"Webdesign en mockup naast elkaar bekijken\" title=\"Bekijk naast elkaar\">" + COMPARE_ICON + "</a>";
    }

    ensureStyles();
    global.SoftoraDatabaseWebdesignPreview = {
        openComparison: openComparison,
        renderLink: renderLink,
        reset: reset
    };
})(window);
