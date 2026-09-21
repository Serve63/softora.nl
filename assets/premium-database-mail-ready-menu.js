(function (global) {
    "use strict";

    function normalizeStatus(value) {
        return String(value || "").trim().toLowerCase();
    }

    function formatCount(value) {
        const count = Number(value);
        return Number.isFinite(count) ? Math.max(0, Math.floor(count)).toLocaleString("nl-NL") : "--";
    }

    function bind() {
        const trigger = document.getElementById("mailReadyMenuButton");
        const menu = document.getElementById("mailReadyMenu");
        if (!trigger || !menu || trigger.dataset.bound === "true") return;
        trigger.dataset.bound = "true";
        const disclosure = trigger.closest("details");
        const options = Array.from(menu.querySelectorAll("[data-mail-ready-status]"));
        const softoraCount = document.getElementById("mailReadySoftoraCount");
        const instantlyCount = document.getElementById("mailReadyInstantlyCount");
        const instantlyQueuedCount = document.getElementById("instantlyQueuedCount");
        const instantlyQueuedButton = document.getElementById("instantlyQueuedFilterButton");
        let remoteQueuedLoaded = false;

        function setQueuedCount(value, campaigns) {
            if (instantlyQueuedCount) instantlyQueuedCount.textContent = formatCount(value);
            if (!instantlyQueuedButton) return;
            const serve = campaigns && campaigns.serve;
            const martijn = campaigns && campaigns.martijn;
            const details = serve && martijn
                ? "Servé " + formatCount(serve.queued) + " · Martijn " + formatCount(martijn.queued)
                : "Actuele campagnes";
            const paused = serve && martijn && Number(serve.status) === 2 && Number(martijn.status) === 2;
            instantlyQueuedButton.title = "Klaargezet in Instantly: " + formatCount(value) + " · " + details + (paused ? " · beide campagnes gepauzeerd" : "");
            instantlyQueuedButton.setAttribute("aria-label", instantlyQueuedButton.title);
        }

        async function loadProviderCapacity() {
            if (!global.fetch) return;
            try {
                const response = await global.fetch("/api/outreach/provider-capacity", {
                    method: "GET",
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: { Accept: "application/json" }
                });
                const payload = await response.json().catch(function () { return {}; });
                if (!response.ok || payload.ok !== true || !Number.isFinite(Number(payload.queuedTotal))) return;
                remoteQueuedLoaded = true;
                setQueuedCount(payload.queuedTotal, payload.campaigns);
            } catch (error) {
                if (global.console && typeof global.console.warn === "function") global.console.warn("Instantly-campagnetelling kon niet worden geladen.", error);
            }
        }

        function setOpen(open) {
            if (disclosure) disclosure.open = Boolean(open);
            else menu.hidden = !open;
            trigger.setAttribute("aria-expanded", open ? "true" : "false");
        }

        function setSelected(status) {
            const selected = normalizeStatus(status);
            trigger.classList.toggle("act", selected === "benaderbaar" || selected === "instantly-ready");
            options.forEach(function (option) {
                option.classList.toggle("is-active", normalizeStatus(option.dataset.mailReadyStatus) === selected);
            });
        }

        if (disclosure) {
            disclosure.addEventListener("toggle", function () {
                trigger.setAttribute("aria-expanded", disclosure.open ? "true" : "false");
            });
        } else {
            trigger.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(menu.hidden);
            });
        }

        menu.addEventListener("click", function (event) {
            event.stopPropagation();
            const option = event.target.closest("[data-mail-ready-status]");
            if (!option) return;
            const status = normalizeStatus(option.dataset.mailReadyStatus);
            global.dispatchEvent(new CustomEvent("softora:mail-ready-filter", { detail: { status: status } }));
            setSelected(status);
            setOpen(false);
        });

        document.addEventListener("click", function (event) {
            const target = event && event.target;
            if (target && typeof target.closest === "function" && target.closest(".mail-ready-filter")) return;
            setOpen(false);
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") setOpen(false);
        });
        global.addEventListener("softora:mail-ready-counts", function (event) {
            const detail = event.detail || {};
            if (softoraCount) softoraCount.textContent = formatCount(detail.softora);
            if (instantlyCount) instantlyCount.textContent = formatCount(detail.instantly);
            if (!remoteQueuedLoaded) setQueuedCount(detail.queued);
            setSelected(detail.activeStatus);
        });
        void loadProviderCapacity();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
    else bind();
})(typeof window !== "undefined" ? window : globalThis);
