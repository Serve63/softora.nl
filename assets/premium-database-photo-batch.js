(function () {
  const FOCUS_STYLE_ID = "softora-photo-batch-focus-style";

  function formatPhotoBatchCount(count) {
    return Number(count || 0).toLocaleString("nl-NL") + (count === 1 ? " bedrijf" : " bedrijven");
  }

  function ensureInputFocusStyles() {
    if (typeof document === "undefined" || document.getElementById(FOCUS_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FOCUS_STYLE_ID;
    style.textContent = ".photo-batch-input:focus{outline:2px solid rgba(139,34,82,.42);outline-offset:2px;border-color:var(--crimson)}.photo-batch-input::selection{background:rgba(139,34,82,.2);color:var(--dark)}";
    document.head.appendChild(style);
  }

  function formatEuroCost(value) {
    if (!Number.isFinite(value)) return "prijs na generatie";
    return "€" + value.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // OpenAI calculator: Sunburst max, 1024x1536, 5488 output tokens at $30/M.
  function formatOutputEstimate(count) {
    const amount = Math.max(0, Number(count) || 0) * 0.16464;
    return "ca. US$" + amount.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 5 }) + " + invoer";
  }

  function formatGenerationCost(generation) {
    const cost = generation && generation.cost;
    if (!cost || cost.basis !== "reported-image-usage" || cost.currency !== "USD" || !Number.isFinite(cost.amountUsd) || cost.amountUsd < 0) return "beeldkosten niet beschikbaar";
    return "US$" + cost.amountUsd.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 8 }) + " beeldkosten (excl. btw)";
  }

  function createCostReporter(options) {
    const root = options.root, costEur = options.costEur;
    const costs = new Map();
    function updateChargeLabelPositions() {
        if (!root.document) return;
        const labels = Array.from(root.document.querySelectorAll(".photo-generate-charge-label"));
        labels.reverse().forEach(function (label, index) {
            label.style.bottom = (18 + (index * 44)) + "px";
        });
    }

    function showChargeLabel(variant, generation) {
        if (!root.document) return;
        const label = root.document.createElement("div");
        label.className = "photo-generate-charge-label";
        label.setAttribute("aria-live", "polite");
        label.textContent = generation ? formatGenerationCost(generation) : (Number.isFinite(costEur) ? formatEuroCost(costEur) : formatOutputEstimate(1));
        root.document.body.appendChild(label);
        updateChargeLabelPositions();
        const frame = typeof root.requestAnimationFrame === "function"
            ? root.requestAnimationFrame
            : function (callback) { root.setTimeout(callback, 0); };
        frame(function () {
            label.classList.add("is-visible");
        });
        root.setTimeout(function () {
            label.classList.remove("is-visible");
        }, generation ? 5800 : 1800);
        root.setTimeout(function () {
            if (label.parentNode) label.parentNode.removeChild(label);
            updateChargeLabelPositions();
        }, generation ? 6200 : 2200);
    }


    return {
      show: showChargeLabel,
      report: function (job) {
        const text = formatGenerationCost(job && job.generation);
        if (job && job.customerId) costs.set(job.customerId, text);
        options.setStatusMessage((job && job.company || "Ontwerp") + " · " + text, "info", true);
        if (job && job.generation) showChargeLabel(job.variant, job.generation);
      },
      consume: function (ids) {
        return ids.map(function (id) { const text = costs.get(id); costs.delete(id); return text; }).filter(Boolean).join("; ");
      }
    };
  }

  function createController(options) {
    const nodes = options.nodes;
    const getTargets = options.getTargets;
    const formatCost = options.formatEuroCost || formatEuroCost;
    const costEur = options.costEur;
    const closeAddActions = options.closeAddActions;
    const setStatusMessage = options.setStatusMessage;
    const generate = options.generate;
    let mode = "custom";
    let cachedTargetCount = null;
    ensureInputFocusStyles();

    function getTargetCount(options) {
      if (!options || !options.force) {
        if (cachedTargetCount !== null) return cachedTargetCount;
      }
      cachedTargetCount = getTargets().length;
      return cachedTargetCount;
    }

    function updateSummary(message) {
      const total = getTargetCount();
      const rawLimit = Math.floor(Number(nodes.photoBatchLimitInput.value));
      const selectedCount = mode === "all"
        ? total
        : (Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, total) : 0);
      const selectedCost = Number.isFinite(costEur) ? selectedCount * costEur : null;

      nodes.photoBatchChoiceButtons.forEach(function (optionNode) {
        optionNode.classList.toggle("is-active", optionNode.dataset.photoBatchMode === mode);
      });
      nodes.photoBatchAllCount.textContent = formatPhotoBatchCount(total) + " · " + (Number.isFinite(costEur) ? formatCost(total * costEur) : formatOutputEstimate(total));
      nodes.photoBatchLimitInput.max = String(Math.max(total, 1));
      nodes.photoBatchSummary.textContent = message || (selectedCount
        ? "Selectie: " + formatPhotoBatchCount(selectedCount) + " · " + (Number.isFinite(selectedCost) ? formatCost(selectedCost) : formatOutputEstimate(selectedCount)) + " (beeldprijs; invoer extra)"
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

      const total = getTargetCount({ force: true });
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
    }

    function close() {
      cachedTargetCount = null;
      nodes.photoBatchModal.classList.remove("on");
      nodes.photoBatchModal.setAttribute("aria-hidden", "true");
    }

    function isOpen() {
      return nodes.photoBatchModal.classList.contains("on");
    }

    function resolveSelection() {
      const total = getTargetCount();
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
      void generate(selection.limit, { silentProgress: true });
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

  const api = { createCostReporter: createCostReporter, createController: createController, formatEuroCost: formatEuroCost, formatOutputEstimate: formatOutputEstimate, formatGenerationCost: formatGenerationCost };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.SoftoraDatabasePhotoBatch = api;
}());
