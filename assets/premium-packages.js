(function () {
    "use strict";

    var packageTabGroups = {
        routes: ["routes"],
        website: ["bouwen", "onderhoud"],
        bedrijfssoftware: ["bedrijfssoftware", "bedrijfssoftware-onderhoud"],
        voicesoftware: ["voice-software", "voice-software-onderhoud"],
        chatbots: ["chatbots", "chatbots-onderhoud"]
    };

    function setActivePanels(name) {
        var panelIds = Array.isArray(packageTabGroups[name]) ? packageTabGroups[name] : [name];
        document.querySelectorAll(".tab-panel").forEach(function (panel) {
            panel.classList.remove("active");
        });
        panelIds.forEach(function (panelId) {
            var panelEl = document.getElementById("tab-" + panelId);
            if (panelEl) panelEl.classList.add("active");
        });
    }

    function setActiveTab(tabEl) {
        document.querySelectorAll(".tab").forEach(function (tab) {
            tab.classList.toggle("active", tab === tabEl);
        });
    }

    function switchTab(name, tabEl) {
        setActivePanels(name);
        if (tabEl) setActiveTab(tabEl);
    }

    function bindPackageTabs() {
        document.addEventListener("click", function (event) {
            var tabEl = event.target && event.target.closest
                ? event.target.closest("[data-package-tab]")
                : null;
            if (!tabEl) return;
            switchTab(tabEl.getAttribute("data-package-tab"), tabEl);
        });
    }

    function finishPremiumShellBoot() {
        if (window.SoftoraPremiumBoot && typeof window.SoftoraPremiumBoot.setShellBooting === "function") {
            window.SoftoraPremiumBoot.setShellBooting(false);
            return;
        }
        var main = document.querySelector("main.is-premium-boot-host");
        if (!main) return;
        var shell = main.querySelector(".premium-boot-shell");
        var loader = main.querySelector(".premium-boot-loader");
        if (shell) {
            shell.classList.remove("is-booting");
            shell.setAttribute("aria-busy", "false");
        }
        if (loader) loader.classList.add("is-hidden");
    }

    bindPackageTabs();

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", finishPremiumShellBoot, { once: true });
    } else {
        finishPremiumShellBoot();
    }
})();
