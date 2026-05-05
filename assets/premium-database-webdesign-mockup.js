(function (global) {
    "use strict";

    function normalizeString(value) {
        return String(value || "").trim();
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

    function drawImageCover(context, image, x, y, width, height, cropTopRatio) {
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
            sx = (sourceWidth - sw) / 2;
        } else {
            sh = sourceWidth / targetRatio;
            sy = Math.max(0, Math.min(sourceHeight - sh, sourceHeight * (cropTopRatio || 0)));
        }
        context.drawImage(image, sx, sy, sw, sh, x, y, width, height);
    }

    function drawDevice(context, image, device) {
        context.save();
        context.shadowColor = device.shadow || "rgba(15, 23, 42, 0.2)";
        context.shadowBlur = device.blur || 34;
        context.shadowOffsetY = device.offsetY || 20;
        roundRect(context, device.x, device.y, device.w, device.h, device.radius);
        context.fillStyle = device.frame;
        context.fill();
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
        drawImageCover(context, image, sx, sy, sw, sh, device.crop || 0);
        context.restore();

        if (device.base) {
            context.fillStyle = device.base;
            roundRect(context, device.baseX, device.baseY, device.baseW, device.baseH, 16);
            context.fill();
        }
    }

    function createMockupDataUrl(image) {
        const canvas = document.createElement("canvas");
        canvas.width = 1600;
        canvas.height = 1000;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Device-mockup maken is mislukt.");

        const gradient = context.createLinearGradient(0, 0, 1600, 1000);
        gradient.addColorStop(0, "#f8f4f6");
        gradient.addColorStop(0.52, "#ffffff");
        gradient.addColorStop(1, "#efe7eb");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 1600, 1000);

        context.fillStyle = "rgba(139, 34, 82, 0.08)";
        context.beginPath();
        context.arc(1260, 160, 340, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "rgba(20, 24, 45, 0.05)";
        context.beginPath();
        context.arc(280, 820, 300, 0, Math.PI * 2);
        context.fill();

        context.fillStyle = "#14182d";
        context.font = "700 42px Oswald, Arial, sans-serif";
        context.letterSpacing = "0px";
        context.fillText("WEBDESIGN PREVIEW", 92, 118);
        context.fillStyle = "rgba(20, 24, 45, 0.56)";
        context.font = "500 24px Inter, Arial, sans-serif";
        context.fillText("Laptop - iPad - iPhone", 94, 158);

        drawDevice(context, image, {
            x: 210, y: 250, w: 920, h: 560, pad: 18, padTop: 18, padBottom: 28, radius: 28, screenRadius: 14,
            frame: "#111827", shadow: "rgba(15,23,42,.24)", blur: 44, offsetY: 26, crop: 0,
            base: "#e5e7eb", baseX: 120, baseY: 825, baseW: 1100, baseH: 42,
        });
        drawDevice(context, image, {
            x: 1040, y: 210, w: 310, h: 450, pad: 14, padTop: 18, padBottom: 18, radius: 34, screenRadius: 22,
            frame: "#1f2937", shadow: "rgba(15,23,42,.22)", blur: 34, offsetY: 22, crop: 0.05,
        });
        drawDevice(context, image, {
            x: 1275, y: 390, w: 190, h: 390, pad: 10, padTop: 22, padBottom: 16, radius: 34, screenRadius: 20,
            frame: "#030712", shadow: "rgba(15,23,42,.28)", blur: 30, offsetY: 18, crop: 0.1,
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
        const pendingIds = new Set();

        function isPending(customerId) {
            return pendingIds.has(normalizeString(customerId));
        }

        async function ensureForCustomer(customerId, ensureOptions) {
            const id = normalizeString(customerId);
            const force = Boolean(ensureOptions && ensureOptions.force);
            const customerIndex = (state.klanten || []).findIndex(function (item) { return item.id === id; });
            if (customerIndex === -1 || pendingIds.has(id)) return false;
            const customer = state.klanten[customerIndex];
            if (!isValidWebsitePhotoSource(customer && customer.websitePhoto)) return false;
            if (!force && isValidWebsitePhotoSource(customer && customer.websiteMockup)) return true;

            pendingIds.add(id);
            if (typeof renderPage === "function") renderPage();
            try {
                const image = await loadImage(customer.websitePhoto);
                const mockupDataUrl = createMockupDataUrl(image);
                if (!isValidWebsitePhotoDataUrl(mockupDataUrl)) throw new Error("Device-mockup maken is mislukt.");
                const nextCustomer = normalizeCustomer({
                    ...customer,
                    websiteMockup: mockupDataUrl,
                    websiteMockupName: replaceExtension(customer.websitePhotoName || customer.dom || customer.bedrijf, "-device-mockup"),
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
                    return isValidWebsitePhotoSource(customer && customer.websitePhoto)
                        && !isValidWebsitePhotoSource(customer && customer.websiteMockup);
                })
                .slice(0, Math.max(0, Number(limit) || 0));
            return visible.reduce(function (promise, customer) {
                return promise.then(function () { return ensureForCustomer(customer.id); });
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
