(function (global) {
    "use strict";

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function defaultIsValidPhotoSource(value) {
        const raw = normalizeString(value);
        if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(raw)) return true;
        if (!/^https:\/\//i.test(raw)) return false;
        try {
            const parsed = new URL(raw);
            return parsed.protocol === "https:" && Boolean(parsed.hostname);
        } catch (error) {
            return false;
        }
    }

    function isApprovedMockupQuality(customer, isValidWebsitePhotoSource) {
        const isValidSource = typeof isValidWebsitePhotoSource === "function" ? isValidWebsitePhotoSource : defaultIsValidPhotoSource;
        return isValidSource(customer && (customer.websiteMockup || customer.mockup || customer.websiteMockupImage));
    }

    function buildWebdesignAssetState(customer, helpers, runtimeState) {
        const options = helpers && typeof helpers === "object" ? helpers : {};
        const runtime = runtimeState && typeof runtimeState === "object" ? runtimeState : {};
        const isValidWebsitePhotoSource = typeof options.isValidWebsitePhotoSource === "function" ? options.isValidWebsitePhotoSource : defaultIsValidPhotoSource;
        const shouldShowWebsitePhoto = typeof options.shouldShowWebsitePhoto === "function" ? options.shouldShowWebsitePhoto : function () { return true; };
        const resolveCustomerWebsiteUrl = typeof options.resolveCustomerWebsiteUrl === "function" ? options.resolveCustomerWebsiteUrl : function (item) { return normalizeString(item && (item.website || item.dom)); };
        const isMailLeadEligible = typeof options.isMailLeadEligible === "function" ? options.isMailLeadEligible : function () { return false; };
        const isMockupPending = typeof options.isMockupPending === "function" ? options.isMockupPending : function () { return false; };
        const isMockupFailed = typeof options.isMockupFailed === "function" ? options.isMockupFailed : function () { return false; };
        const id = normalizeString(customer && customer.id);
        const visible = Boolean(customer) && shouldShowWebsitePhoto(customer);
        const snapshotPhotoReady = Boolean(customer && (customer.websitePhotoAssetReady === true || customer.hasPhoto === true));
        const snapshotMockupReady = Boolean(customer && (customer.websiteMockupAssetReady === true || customer.hasMockup === true));
        const hasPhoto = visible && (isValidWebsitePhotoSource(customer && customer.websitePhoto) || snapshotPhotoReady);
        const hasMockup = visible && (isValidWebsitePhotoSource(customer && customer.websiteMockup) || snapshotMockupReady);
        const mockupApproved = hasMockup;
        const mockupPending = Boolean(id) && (Boolean(isMockupPending(id)) || Boolean(runtime.pendingMockupIds && runtime.pendingMockupIds.has && runtime.pendingMockupIds.has(id)));
        const mockupFailed = Boolean(id) && (Boolean(isMockupFailed(id)) || Boolean(runtime.failedMockupIds && runtime.failedMockupIds.has && runtime.failedMockupIds.has(id)));
        const leadEligible = Boolean(isMailLeadEligible(customer));
        const canGeneratePhoto = visible && leadEligible && !hasPhoto && Boolean(resolveCustomerWebsiteUrl(customer));
        const canRepairMockup = hasPhoto && !hasMockup && !mockupPending;
        const isMailReady = visible && leadEligible && hasPhoto && hasMockup;

        return {
            visible: visible,
            hasPhoto: hasPhoto,
            hasMockup: hasMockup,
            mockupApproved: mockupApproved,
            mockupPending: mockupPending,
            mockupFailed: mockupFailed,
            isMailReady: isMailReady,
            canGeneratePhoto: canGeneratePhoto,
            canRepairMockup: canRepairMockup,
            hasCompleteAssets: hasPhoto && hasMockup,
            mockupSlotVisible: hasPhoto || hasMockup || mockupPending || mockupFailed,
            mockupState: hasMockup ? "ready" : (mockupPending ? "pending" : (mockupFailed ? "failed" : (hasPhoto ? "missing" : "empty")))
        };
    }

    function mergeCustomersWithPhotos(customers, photoMap, fallbackCustomers, helpers) {
        const options = helpers && typeof helpers === "object" ? helpers : {};
        const normalizeCustomer = typeof options.normalizeCustomer === "function" ? options.normalizeCustomer : function (item) { return item && typeof item === "object" ? { ...item } : {}; };
        const sortCustomers = typeof options.sortCustomers === "function" ? options.sortCustomers : function (items) { return items; };
        const shouldShowWebsitePhoto = typeof options.shouldShowWebsitePhoto === "function" ? options.shouldShowWebsitePhoto : function () { return true; };
        const isValidWebsitePhotoSource = typeof options.isValidWebsitePhotoSource === "function" ? options.isValidWebsitePhotoSource : defaultIsValidPhotoSource;
        const buildCustomerIdentityKey = typeof options.buildCustomerIdentityKey === "function" ? options.buildCustomerIdentityKey : function () { return ""; };
        const photos = photoMap && typeof photoMap === "object" ? photoMap : {};
        const photosByIdentity = new Map();
        const fallbackPhotosById = new Map();
        const fallbackPhotosByIdentity = new Map();
        function hasAnyMedia(item) { return isValidWebsitePhotoSource(item && item.websitePhoto) || isValidWebsitePhotoSource(item && item.websiteMockup); }
        function rememberFallbackMedia(customer) {
            const normalized = normalizeCustomer(customer);
            if (!normalized.id || !hasAnyMedia(normalized)) return;
            fallbackPhotosById.set(normalized.id, normalized);
            const identityKey = buildCustomerIdentityKey(normalized);
            if (identityKey) fallbackPhotosByIdentity.set(identityKey, normalized);
        }
        function firstValidSource() {
            for (let index = 0; index < arguments.length; index += 1) {
                const value = normalizeString(arguments[index]);
                if (isValidWebsitePhotoSource(value)) return value;
            }
            return "";
        }
        function firstText() {
            for (let index = 0; index < arguments.length; index += 1) {
                const value = normalizeString(arguments[index]);
                if (value) return value;
            }
            return "";
        }
        Object.keys(photos).forEach(function (key) {
            const item = photos[key];
            const identityKey = normalizeString(item && item.identityKey);
            if (identityKey && hasAnyMedia(item)) photosByIdentity.set(identityKey, item);
        });
        (Array.isArray(fallbackCustomers) ? fallbackCustomers : []).forEach(rememberFallbackMedia);
        return sortCustomers((customers || []).map(function (customer, index) {
            const normalized = normalizeCustomer(customer, "photo-merge-" + index);
            if (!shouldShowWebsitePhoto(normalized)) return { ...normalized, websitePhoto: "", websitePhotoName: "", websiteMockup: "", websiteMockupName: "", mockupRenderer: "", mockupOrientation: "", mockupQualityStatus: "", mockupQualityCheckedAt: "" };
            const identityKey = buildCustomerIdentityKey(normalized);
            const photo = photos[normalized.id] || photosByIdentity.get(identityKey) || null;
            const fallbackPhoto = fallbackPhotosById.get(normalized.id) || fallbackPhotosByIdentity.get(identityKey) || null;
            const websitePhoto = firstValidSource(photo && photo.websitePhoto, fallbackPhoto && fallbackPhoto.websitePhoto, normalized.websitePhoto);
            if (!websitePhoto) return normalized;
            const websiteMockup = firstValidSource(photo && photo.websiteMockup, fallbackPhoto && fallbackPhoto.websiteMockup, normalized.websiteMockup);
            return {
                ...normalized,
                websitePhoto: websitePhoto,
                websitePhotoName: firstText(photo && photo.websitePhotoName, fallbackPhoto && fallbackPhoto.websitePhotoName, normalized.websitePhotoName) || "Websitefoto",
                websiteMockup: websiteMockup,
                websiteMockupName: firstText(photo && photo.websiteMockupName, fallbackPhoto && fallbackPhoto.websiteMockupName, normalized.websiteMockupName) || (websiteMockup ? "Device mockup" : ""),
                mockupRenderer: firstText(photo && photo.mockupRenderer, fallbackPhoto && fallbackPhoto.mockupRenderer, normalized.mockupRenderer),
                mockupOrientation: firstText(photo && photo.mockupOrientation, fallbackPhoto && fallbackPhoto.mockupOrientation, normalized.mockupOrientation),
                mockupQualityStatus: firstText(photo && photo.mockupQualityStatus, fallbackPhoto && fallbackPhoto.mockupQualityStatus, normalized.mockupQualityStatus),
                mockupQualityCheckedAt: firstText(photo && photo.mockupQualityCheckedAt, fallbackPhoto && fallbackPhoto.mockupQualityCheckedAt, normalized.mockupQualityCheckedAt)
            };
        }));
    }

    global.SoftoraDatabaseWebdesignAssetState = {
        buildWebdesignAssetState: buildWebdesignAssetState,
        mergeCustomersWithPhotos: mergeCustomersWithPhotos,
        isApprovedMockupQuality: isApprovedMockupQuality
    };
})(window);
