(function () {
  function formatPhotoBatchCount(count) {
    return Number(count || 0).toLocaleString("nl-NL") + " bedrijf" + (count === 1 ? "" : "ven");
  }

  function createController(options) {
    const nodes = options.nodes;
    const getTargets = options.getTargets;
    const formatEuroCost = options.formatEuroCost;
    const costEur = options.costEur;
    const closeAddActions = options.closeAddActions;
    const setStatusMessage = options.setStatusMessage;
    const generate = options.generate;
    let mode = "custom";

    function updateSummary(message) {
      const total = getTargets().length;
      const rawLimit = Math.floor(Number(nodes.photoBatchLimitInput.value));
      const selectedCount = mode === "all"
        ? total
        : (Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, total) : 0);
      const selectedCost = selectedCount * costEur;

      nodes.photoBatchChoiceButtons.forEach(function (optionNode) {
        optionNode.classList.toggle("is-active", optionNode.dataset.photoBatchMode === mode);
      });
      nodes.photoBatchAllCount.textContent = formatPhotoBatchCount(total) + " · " + formatEuroCost(total * costEur);
      nodes.photoBatchLimitInput.max = String(Math.max(total, 1));
      nodes.photoBatchSummary.textContent = message || (selectedCount
        ? "Selectie: " + formatPhotoBatchCount(selectedCount) + " · " + formatEuroCost(selectedCost)
        : "Vul minimaal 1 in.");
    }

    function setMode(nextMode) {
      mode = nextMode === "all" ? "all" : "custom";
      updateSummary();
      if (mode === "custom" && document.activeElement !== nodes.photoBatchLimitInput) {
        nodes.photoBatchLimitInput.focus();
      }
    }

    function open() {
      closeAddActions();
      if (nodes.generatePhotosButton.disabled) return;

      const total = getTargets().length;
      if (!total) {
        setStatusMessage("Geen bedrijven zonder foto met een geldige website gevonden.", "info", true);
        return;
      }

      mode = "custom";
      nodes.photoBatchLimitInput.value = String(Math.min(10, total));
      updateSummary();
      nodes.photoBatchModal.classList.add("on");
      nodes.photoBatchModal.setAttribute("aria-hidden", "false");
      nodes.photoBatchLimitInput.focus();
      nodes.photoBatchLimitInput.select();
    }

    function close() {
      nodes.photoBatchModal.classList.remove("on");
      nodes.photoBatchModal.setAttribute("aria-hidden", "true");
    }

    function isOpen() {
      return nodes.photoBatchModal.classList.contains("on");
    }

    function resolveSelection() {
      const total = getTargets().length;
      if (!total) {
        close();
        setStatusMessage("Geen bedrijven zonder foto met een geldige website gevonden.", "info", true);
        return null;
      }

      if (mode === "all") {
        return { limit: null, count: total };
      }

      const limit = Math.floor(Number(nodes.photoBatchLimitInput.value));
      if (!Number.isFinite(limit) || limit < 1) {
        updateSummary("Vul minimaal 1 in.");
        nodes.photoBatchLimitInput.focus();
        nodes.photoBatchLimitInput.select();
        return null;
      }

      const cappedLimit = Math.min(limit, total);
      nodes.photoBatchLimitInput.value = String(cappedLimit);
      return { limit: cappedLimit, count: cappedLimit };
    }

    function start() {
      const selection = resolveSelection();
      if (!selection) return;

      close();
      void generate(selection.limit);
    }

    function bind() {
      nodes.photoBatchOptions.addEventListener("click", function (event) {
        const optionNode = event.target.closest("[data-photo-batch-mode]");
        if (!optionNode || !nodes.photoBatchOptions.contains(optionNode)) return;
        setMode(optionNode.dataset.photoBatchMode);
      });
      nodes.photoBatchLimitInput.addEventListener("focus", function () {
        setMode("custom");
      });
      nodes.photoBatchLimitInput.addEventListener("input", function () {
        mode = "custom";
        updateSummary();
      });
      nodes.cancelPhotoBatchButton.addEventListener("click", close);
      nodes.startPhotoBatchButton.addEventListener("click", start);
      nodes.photoBatchModal.addEventListener("click", function (event) {
        if (event.target === nodes.photoBatchModal) {
          close();
        }
      });
    }

    return {
      bind: bind,
      close: close,
      isOpen: isOpen,
      open: open,
    };
  }

  window.SoftoraDatabasePhotoBatch = {
    createController: createController,
  };
}());
