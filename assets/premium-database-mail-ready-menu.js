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
            setSelected(detail.activeStatus);
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
    else bind();
})(typeof window !== "undefined" ? window : globalThis);
