(function (global) {
    "use strict";

    const DEVICE_MOCKUP_VERSION = "v12";
    const MOCKUP_BACKGROUND_SRC = "/assets/webdesign-preview-stage-bg.jpg";
    const MOCKUP_TEMPLATE_SRC = "/assets/webdesign-device-mockup-template-v12.jpg";
    const DEVICE_MOCKUP_SCREENS = [
        {
            id: "laptop",
            points: [{ x: 222, y: 124 }, { x: 921, y: 149 }, { x: 952, y: 654 }, { x: 235, y: 630 }],
            fitMode: "viewport-width", cropTopRatio: 0, glassOpacity: 0.12, edgeStrokeWidth: 10, edgeStrokeOpacity: 0.72,
        },
        {
            id: "tablet",
            points: [{ x: 1016, y: 168 }, { x: 1300, y: 178 }, { x: 1318, y: 652 }, { x: 1032, y: 646 }],
            fitMode: "viewport-width", cropTopRatio: 0, glassOpacity: 0.14, edgeStrokeWidth: 8, edgeStrokeOpacity: 0.66,
        },
        {
            id: "phone",
            points: [{ x: 1378, y: 355 }, { x: 1502, y: 363 }, { x: 1511, y: 642 }, { x: 1387, y: 640 }],
            fitMode: "viewport-width", cropTopRatio: 0, glassOpacity: 0.16, edgeStrokeWidth: 7, edgeStrokeOpacity: 0.72,
        },
    ];
    let mockupBackgroundPromise = null;
    let mockupTemplatePromise = null;
    function normalizeString(value) {
        return String(value || "").trim();
    }

    function hasApprovedMockup(customer, isValidWebsitePhotoSource) {
        return Boolean(customer && isValidWebsitePhotoSource(customer.websiteMockup));
    }

    function hasUsableMockup(customer, isValidWebsitePhotoSource) {
        return hasApprovedMockup(customer, isValidWebsitePhotoSource);
    }

    function replaceExtension(fileName, suffix) {
        const clean = normalizeString(fileName).replace(/\.[a-z0-9]+$/i, "") || "webdesign";
        return clean + suffix + ".jpg";
    }

    function loadImageAsDataUrl(source) {
        const raw = normalizeString(source);
        if (!raw) return Promise.reject(new Error("Geen webdesign gevonden voor mockup."));
        if (/^data:image\//i.test(raw)) return Promise.resolve(raw);
        return fetch(raw, { mode: "cors", cache: "no-store" })
            .then(function (response) {
                if (!response.ok) throw new Error("Webdesign laden voor mockup is mislukt.");
                return response.blob();
            })
            .then(function (blob) {
                return new Promise(function (resolve, reject) {
                    const reader = new FileReader();
                    reader.onload = function () { resolve(normalizeString(reader.result)); };
                    reader.onerror = function () { reject(new Error("Webdesign voorbereiden voor mockup is mislukt.")); };
                    reader.readAsDataURL(blob);
                });
            });
    }

    function loadImage(source) {
        return loadImageAsDataUrl(source).then(function (dataUrl) {
            return new Promise(function (resolve, reject) {
                const image = new Image();
                image.onload = function () { resolve(image); };
                image.onerror = function () { reject(new Error("Mockup-afbeelding kon niet worden geladen.")); };
                image.src = dataUrl;
            });
        });
    }

    function loadMockupBackground() {
        if (mockupBackgroundPromise) return mockupBackgroundPromise;
        mockupBackgroundPromise = new Promise(function (resolve) {
            const image = new Image();
            image.onload = function () { resolve(image); };
            image.onerror = function () { resolve(null); };
            image.src = MOCKUP_BACKGROUND_SRC;
        });
        return mockupBackgroundPromise;
    }

    function loadMockupTemplate() {
        if (mockupTemplatePromise) return mockupTemplatePromise;
        mockupTemplatePromise = new Promise(function (resolve) {
            const image = new Image();
            image.onload = function () { resolve(image); };
            image.onerror = function () { resolve(null); };
            image.src = MOCKUP_TEMPLATE_SRC;
        });
        return mockupTemplatePromise;
    }

    function roundRect(context, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        context.beginPath();
        context.moveTo(x + r, y);
        context.arcTo(x + width, y, x + width, y + height, r);
        context.arcTo(x + width, y + height, x, y + height, r);
        context.arcTo(x, y + height, x, y, r);
        context.arcTo(x, y, x + width, y, r);
        context.closePath();
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function normalizeRatio(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function drawImageCover(context, image, x, y, width, height, cropTopRatio, cropFocusX) {
        const sourceWidth = image.naturalWidth || image.width || 1;
        const sourceHeight = image.naturalHeight || image.height || 1;
        const targetRatio = width / height;
        const sourceRatio = sourceWidth / sourceHeight;
        let sx = 0;
        let sy = 0;
        let sw = sourceWidth;
        let sh = sourceHeight;
        if (sourceRatio > targetRatio) {
            sw = sourceHeight * targetRatio;
            sx = (sourceWidth - sw) * clamp(normalizeRatio(cropFocusX, 0.5), 0, 1);
        } else {
            sh = sourceWidth / targetRatio;
            sy = clamp(sourceHeight * normalizeRatio(cropTopRatio, 0), 0, Math.max(0, sourceHeight - sh));
        }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, sx, sy, sw, sh, x, y, width, height);
    }

    function drawImageViewportCover(context, image, x, y, width, height, options) {
        const sourceWidth = image.naturalWidth || image.width || 1;
        const sourceHeight = image.naturalHeight || image.height || 1;
        const targetRatio = width / height;
        const viewportHeightRatio = clamp(normalizeRatio(options && options.viewportHeightRatio, 0.68), 0.38, 1);
        let sh = Math.max(1, sourceHeight * viewportHeightRatio);
        let sw = sh * targetRatio;
        if (sw > sourceWidth) {
            sw = sourceWidth;
            sh = sw / targetRatio;
        }
        sh = Math.min(sh, sourceHeight);
        sw = Math.min(sw, sourceWidth);
        const focusX = clamp(normalizeRatio(options && options.cropFocusX, 0.5), 0, 1);
        const cropTopRatio = clamp(normalizeRatio(options && options.cropTopRatio, 0), 0, 1);
        const sx = clamp((sourceWidth - sw) * focusX, 0, Math.max(0, sourceWidth - sw));
        const sy = clamp((sourceHeight - sh) * cropTopRatio, 0, Math.max(0, sourceHeight - sh));
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, sx, sy, sw, sh, x, y, width, height);
    }

    function drawImageViewportFitWidth(context, image, x, y, width, height, options) {
        const sourceWidth = image.naturalWidth || image.width || 1;
        const sourceHeight = image.naturalHeight || image.height || 1;
        const scale = width / sourceWidth;
        const renderedHeight = sourceHeight * scale;
        const cropTopRatio = clamp(normalizeRatio(options && options.cropTopRatio, 0), 0, 1);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        if (renderedHeight > height) {
            const visibleSourceHeight = Math.max(1, height / scale);
            const sy = clamp((sourceHeight - visibleSourceHeight) * cropTopRatio, 0, Math.max(0, sourceHeight - visibleSourceHeight));
            context.drawImage(image, 0, sy, sourceWidth, visibleSourceHeight, x, y, width, height);
            return;
        }
        context.drawImage(image, 0, 0, sourceWidth, sourceHeight, x, y, width, renderedHeight);
    }

    function drawDevice(context, image, device) {
        context.save();
        context.shadowColor = device.shadow || "rgba(15, 23, 42, 0.2)";
        context.shadowBlur = device.blur || 34;
        context.shadowOffsetY = device.offsetY || 20;
        roundRect(context, device.x, device.y, device.w, device.h, device.radius);
        context.fillStyle = device.frame;
        context.fill();
        if (device.edge) {
            context.strokeStyle = device.edge;
            context.lineWidth = 3;
            context.stroke();
        }
        context.restore();

        roundRect(context, device.x, device.y, device.w, device.h, device.radius);
        context.fillStyle = device.frame;
        context.fill();

        const sx = device.x + device.pad;
        const sy = device.y + device.padTop;
        const sw = device.w - device.pad * 2;
        const sh = device.h - device.padTop - device.padBottom;
        context.save();
        roundRect(context, sx, sy, sw, sh, device.screenRadius);
        context.clip();
        context.fillStyle = "#ffffff";
        context.fillRect(sx, sy, sw, sh);
        if (device.fitMode === "viewport-width") {
            drawImageViewportFitWidth(context, image, sx, sy, sw, sh, device);
        } else if (device.fitMode === "viewport") {
            drawImageViewportCover(context, image, sx, sy, sw, sh, device);
        } else {
            drawImageCover(context, image, sx, sy, sw, sh, device.crop || 0, device.cropFocusX);
        }
        context.restore();

        if (device.baseStyle === "modern-laptop") {
            drawModernLaptopBase(context, device);
        } else if (device.base) {
            context.fillStyle = device.base;
            roundRect(context, device.baseX, device.baseY, device.baseW, device.baseH, 16);
            context.fill();
        }
    }

    function drawModernLaptopBase(context, device) {
        const hingeY = device.y + device.h - 15;
        const deckTopY = device.baseY;
        const deckBottomY = device.baseY + device.baseH;
        const left = device.baseX;
        const right = device.baseX + device.baseW;
        const topLeft = device.x + 64;
        const topRight = device.x + device.w - 64;
        const bottomLeft = left + 24;
        const bottomRight = right - 24;

        const hingeGradient = context.createLinearGradient(device.x + 82, hingeY, device.x + device.w - 82, hingeY + 22);
        hingeGradient.addColorStop(0, "#101827");
        hingeGradient.addColorStop(0.5, "#2b3648");
        hingeGradient.addColorStop(1, "#0b1220");
        context.fillStyle = hingeGradient;
        roundRect(context, device.x + 82, hingeY, device.w - 164, 22, 11);
        context.fill();

        const deckGradient = context.createLinearGradient(left, deckTopY, right, deckBottomY);
        deckGradient.addColorStop(0, "#202b3d");
        deckGradient.addColorStop(0.48, "#121a2a");
        deckGradient.addColorStop(1, "#070d17");
        context.beginPath();
        context.moveTo(topLeft, deckTopY);
        context.lineTo(topRight, deckTopY);
        context.lineTo(bottomRight, deckBottomY);
        context.lineTo(bottomLeft, deckBottomY);
        context.closePath();
        context.fillStyle = deckGradient;
        context.fill();

        context.strokeStyle = "rgba(255, 255, 255, 0.18)";
        context.lineWidth = 3;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(left + 86, deckTopY + 5);
        context.lineTo(right - 86, deckTopY + 5);
        context.stroke();

        context.strokeStyle = "rgba(255, 255, 255, 0.14)";
        context.beginPath();
        context.moveTo(left + 20, deckBottomY - 18);
        context.lineTo(right - 20, deckBottomY - 18);
        context.stroke();

        drawLaptopKeyboard(context, device, left, deckTopY);

        context.fillStyle = "rgba(8, 13, 23, 0.66)";
        roundRect(context, left + device.baseW * 0.39, deckBottomY - 72, device.baseW * 0.22, 48, 10);
        context.fill();
        context.strokeStyle = "rgba(148, 163, 184, 0.42)";
        context.lineWidth = 2;
        context.stroke();

        context.fillStyle = "rgba(148, 163, 184, 0.24)";
        roundRect(context, left + device.baseW * 0.43, deckBottomY - 18, device.baseW * 0.14, 7, 4);
        context.fill();
    }

    function drawLaptopKeyboard(context, device, left, deckTopY) {
        const rows = [
            { y: deckTopY + 42, count: 14, keyW: 38, gap: 9, h: 12 },
            { y: deckTopY + 66, count: 13, keyW: 41, gap: 10, h: 13 },
            { y: deckTopY + 92, count: 12, keyW: 45, gap: 10, h: 14 },
            { y: deckTopY + 120, count: 10, keyW: 53, gap: 12, h: 15 },
        ];
        rows.forEach(function (row) {
            const rowW = row.count * row.keyW + (row.count - 1) * row.gap;
            const rowX = left + (device.baseW - rowW) / 2;
            for (let index = 0; index < row.count; index += 1) {
                roundRect(context, rowX + index * (row.keyW + row.gap), row.y, row.keyW, row.h, 4);
                context.fillStyle = "rgba(148, 163, 184, 0.32)";
                context.fill();
                context.strokeStyle = "rgba(255, 255, 255, 0.20)";
                context.lineWidth = 1;
                context.stroke();
            }
        });
    }

    function drawStageBackground(context, backgroundImage) {
        if (backgroundImage) {
            context.drawImage(backgroundImage, 0, 0, 1600, 1000);
        } else {
            const gradient = context.createLinearGradient(0, 0, 1600, 1000);
            gradient.addColorStop(0, "#f7f3ec");
            gradient.addColorStop(0.52, "#ffffff");
            gradient.addColorStop(1, "#dfe8ee");
            context.fillStyle = gradient;
            context.fillRect(0, 0, 1600, 1000);

            context.fillStyle = "rgba(137, 213, 231, 0.12)";
            context.beginPath();
            context.arc(1270, 185, 330, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = "rgba(197, 168, 107, 0.13)";
            context.beginPath();
            context.arc(245, 820, 310, 0, Math.PI * 2);
            context.fill();
        }

        const overlay = context.createLinearGradient(0, 0, 1600, 1000);
        overlay.addColorStop(0, "rgba(15, 23, 42, 0.12)");
        overlay.addColorStop(0.48, "rgba(255, 255, 255, 0.10)");
        overlay.addColorStop(1, "rgba(15, 23, 42, 0.16)");
        context.fillStyle = overlay;
        context.fillRect(0, 0, 1600, 1000);
    }

    function getPointDistance(first, second) {
        return Math.hypot((Number(second.x) || 0) - (Number(first.x) || 0), (Number(second.y) || 0) - (Number(first.y) || 0));
    }

    function getScreenTarget(screen) {
        const points = Array.isArray(screen.points) ? screen.points : [];
        const topLeft = points[0] || { x: 0, y: 0 };
        const topRight = points[1] || { x: 1, y: 0 };
        const bottomLeft = points[3] || { x: 0, y: 1 };
        return {
            width: Math.max(1, getPointDistance(topLeft, topRight)),
            height: Math.max(1, getPointDistance(topLeft, bottomLeft)),
        };
    }

    function clipScreenPolygon(context, screen) {
        const points = Array.isArray(screen.points) ? screen.points : [];
        context.beginPath();
        points.forEach(function (point, index) {
            if (index === 0) context.moveTo(point.x, point.y);
            else context.lineTo(point.x, point.y);
        });
        context.closePath();
        context.clip();
    }

    function fillScreenPolygon(context, screen) {
        const points = Array.isArray(screen.points) ? screen.points : [];
        context.beginPath();
        points.forEach(function (point, index) {
            if (index === 0) context.moveTo(point.x, point.y);
            else context.lineTo(point.x, point.y);
        });
        context.closePath();
        context.fill();
    }

    function interpolatePoint(first, second, ratio) {
        return {
            x: (Number(first.x) || 0) + ((Number(second.x) || 0) - (Number(first.x) || 0)) * ratio,
            y: (Number(first.y) || 0) + ((Number(second.y) || 0) - (Number(first.y) || 0)) * ratio,
        };
    }

    function resolveScreenImageCrop(image, width, height, screen) {
        const sourceWidth = image.naturalWidth || image.width || 1;
        const sourceHeight = image.naturalHeight || image.height || 1;
        if (screen.fitMode === "viewport-width") {
            const scale = width / sourceWidth;
            const visibleSourceHeight = Math.min(sourceHeight, Math.max(1, height / scale));
            const cropTopRatio = clamp(normalizeRatio(screen.cropTopRatio, 0), 0, 1);
            return {
                sx: 0,
                sy: clamp((sourceHeight - visibleSourceHeight) * cropTopRatio, 0, Math.max(0, sourceHeight - visibleSourceHeight)),
                sw: sourceWidth,
                sh: visibleSourceHeight,
            };
        }

        const targetRatio = width / height;
        const viewportHeightRatio = clamp(normalizeRatio(screen.viewportHeightRatio, 0.68), 0.38, 1);
        let sh = Math.max(1, sourceHeight * viewportHeightRatio);
        let sw = sh * targetRatio;
        if (sw > sourceWidth) {
            sw = sourceWidth;
            sh = sw / targetRatio;
        }
        sh = Math.min(sh, sourceHeight);
        sw = Math.min(sw, sourceWidth);
        const focusX = clamp(normalizeRatio(screen.cropFocusX, 0.5), 0, 1);
        const cropTopRatio = clamp(normalizeRatio(screen.cropTopRatio, 0), 0, 1);
        return {
            sx: clamp((sourceWidth - sw) * focusX, 0, Math.max(0, sourceWidth - sw)),
            sy: clamp((sourceHeight - sh) * cropTopRatio, 0, Math.max(0, sourceHeight - sh)),
            sw: sw,
            sh: sh,
        };
    }

    function drawWebsiteOnTemplateScreen(context, image, screen) {
        const points = Array.isArray(screen.points) ? screen.points : [];
        const topLeft = points[0] || { x: 0, y: 0 };
        const topRight = points[1] || { x: 1, y: 0 };
        const bottomLeft = points[3] || { x: 0, y: 1 };
        const target = getScreenTarget(screen);
        const crop = resolveScreenImageCrop(image, target.width, target.height, screen);
        const strips = screen.id === "phone" ? 64 : 96;
        const stripHeight = target.height / strips;
        const stripOverlap = 1.2;
        const sourceOverlap = crop.sh / target.height * stripOverlap;

        context.save();
        clipScreenPolygon(context, screen);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        for (let index = 0; index < strips; index += 1) {
            const topRatio = index / strips;
            const bottomRatio = (index + 1) / strips;
            const stripTopLeft = interpolatePoint(topLeft, bottomLeft, topRatio);
            const stripTopRight = interpolatePoint(topRight, points[2] || topRight, topRatio);
            const stripBottomLeft = interpolatePoint(topLeft, bottomLeft, bottomRatio);
            const sourceY = crop.sy + crop.sh * topRatio;
            const sourceHeight = crop.sh / strips;
            context.setTransform(
                (stripTopRight.x - stripTopLeft.x) / target.width,
                (stripTopRight.y - stripTopLeft.y) / target.width,
                (stripBottomLeft.x - stripTopLeft.x) / stripHeight,
                (stripBottomLeft.y - stripTopLeft.y) / stripHeight,
                stripTopLeft.x,
                stripTopLeft.y
            );
            context.drawImage(image, crop.sx, sourceY, crop.sw, sourceHeight + sourceOverlap, 0, 0, target.width, stripHeight + stripOverlap);
        }
        context.restore();

        context.save();
        clipScreenPolygon(context, screen);
        context.fillStyle = "rgba(0, 0, 0, " + (screen.glassOpacity || 0.12) + ")";
        fillScreenPolygon(context, screen);
        const glass = context.createLinearGradient(points[0].x, points[0].y, points[2].x, points[2].y);
        glass.addColorStop(0, "rgba(255, 255, 255, 0.24)");
        glass.addColorStop(0.36, "rgba(255, 255, 255, 0.02)");
        glass.addColorStop(0.72, "rgba(0, 0, 0, 0.10)");
        glass.addColorStop(1, "rgba(255, 255, 255, 0.10)");
        context.fillStyle = glass;
        fillScreenPolygon(context, screen);
        context.strokeStyle = "rgba(2, 6, 23, " + (screen.edgeStrokeOpacity || 0.7) + ")";
        context.lineWidth = screen.edgeStrokeWidth || 8;
        context.lineJoin = "round";
        context.stroke();
        context.restore();
    }

    async function createMockupDataUrl(image) {
        const canvas = document.createElement("canvas");
        canvas.width = 1600;
        canvas.height = 900;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Device-mockup maken is mislukt.");

        const template = await loadMockupTemplate();
        if (template) {
            context.drawImage(template, 0, 0, 1600, 900);
        } else {
            drawStageBackground(context, await loadMockupBackground());
        }
        DEVICE_MOCKUP_SCREENS.forEach(function (screen) {
            drawWebsiteOnTemplateScreen(context, image, screen);
        });

        return canvas.toDataURL("image/jpeg", 0.86);
    }

    function createController(options) {
        const state = options.state;
        const normalizeCustomer = options.normalizeCustomer;
        const sortCustomers = options.sortCustomers;
        const isValidWebsitePhotoSource = options.isValidWebsitePhotoSource;
        const isValidWebsitePhotoDataUrl = options.isValidWebsitePhotoDataUrl;
        const persistCustomerPhotos = options.persistCustomerPhotos;
        const renderPage = options.renderPage;
        const setStatusMessage = options.setStatusMessage;
        const toast = typeof options.toast === "function" ? options.toast : function () {};
        const pendingIds = new Set();

        function isPending(customerId) {
            return pendingIds.has(normalizeString(customerId));
        }

        async function ensureForCustomer(customerId, ensureOptions) {
            const id = normalizeString(customerId);
            const force = Boolean(ensureOptions && ensureOptions.force);
            const silent = Boolean(ensureOptions && ensureOptions.silent);
            const pendingReserved = Boolean(ensureOptions && ensureOptions.pendingReserved);
            const releaseReservedPending = function () {
                if (!pendingReserved) return;
                pendingIds.delete(id);
                if (typeof renderPage === "function") renderPage();
            };
            const customerIndex = (state.klanten || []).findIndex(function (item) { return item.id === id; });
            if (customerIndex === -1 || (pendingIds.has(id) && !pendingReserved)) {
                releaseReservedPending();
                return false;
            }
            const customer = state.klanten[customerIndex];
            if (!isValidWebsitePhotoSource(customer && customer.websitePhoto)) {
                releaseReservedPending();
                return false;
            }
            if (!force && hasUsableMockup(customer, isValidWebsitePhotoSource)) {
                releaseReservedPending();
                return true;
            }

            if (!pendingReserved) pendingIds.add(id);
            if (force && !silent && !isValidWebsitePhotoSource(customer && customer.websiteMockup)) {
                toast("Device mockup wordt lokaal gemaakt, geen extra API-kosten");
            }
            if (!pendingReserved && typeof renderPage === "function") renderPage();
            try {
                const image = await loadImage(customer.websitePhoto);
                const mockupDataUrl = await createMockupDataUrl(image);
                if (!isValidWebsitePhotoDataUrl(mockupDataUrl)) throw new Error("Device-mockup maken is mislukt.");
                const checkedAt = new Date().toISOString();
                const nextCustomer = normalizeCustomer({
                    ...customer,
                    websiteMockup: mockupDataUrl,
                    websiteMockupName: replaceExtension(customer.websitePhotoName || customer.dom || customer.bedrijf, "-device-mockup-" + DEVICE_MOCKUP_VERSION),
                    mockupRenderer: "softora-browser-device-" + DEVICE_MOCKUP_VERSION,
                    mockupOrientation: "upright",
                    mockupQualityStatus: "checked",
                    mockupQualityCheckedAt: checkedAt,
                    updatedAt: new Date().toISOString().slice(0, 10),
                }, id);
                state.klanten = sortCustomers(state.klanten.map(function (item) {
                    return item.id === id ? nextCustomer : item;
                }));
                if (typeof renderPage === "function") renderPage();
                const saved = await persistCustomerPhotos(state.klanten, { onlyCustomerIds: [id] });
                if (!saved || !saved.ok) {
                    throw new Error("Mockup staat lokaal in beeld, maar opslaan in Supabase mislukte.");
                }
                return true;
            } catch (error) {
                if (typeof setStatusMessage === "function") {
                    setStatusMessage(normalizeString(error && error.message) || "Device-mockup maken is mislukt.", "error", true);
                }
                return false;
            } finally {
                pendingIds.delete(id);
                if (typeof renderPage === "function") renderPage();
            }
        }

        function ensureVisibleMockups(customers, limit) {
            const visible = (Array.isArray(customers) ? customers : [])
                .filter(function (customer) {
                    const id = normalizeString(customer && customer.id);
                    return isValidWebsitePhotoSource(customer && customer.websitePhoto)
                        && !hasUsableMockup(customer, isValidWebsitePhotoSource)
                        && id
                        && !pendingIds.has(id);
                })
                .slice(0, Math.max(0, Number(limit) || 0));
            const reservedPendingIds = visible.map(function (customer) { return normalizeString(customer && customer.id); }).filter(Boolean);
            reservedPendingIds.forEach(function (id) { pendingIds.add(id); });
            if (reservedPendingIds.length && typeof renderPage === "function") renderPage();
            return visible.reduce(function (promise, customer) {
                return promise.then(function () { return ensureForCustomer(customer.id, { pendingReserved: true }); });
            }, Promise.resolve());
        }

        return {
            ensureForCustomer: ensureForCustomer,
            ensureVisibleMockups: ensureVisibleMockups,
            isPending: isPending,
        };
    }

    global.SoftoraDatabaseWebdesignMockup = {
        createController: createController
    };
})(window);
