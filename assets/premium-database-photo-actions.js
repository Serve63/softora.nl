(function () {
  const generatingIds = new Set();
  const lightningPath = "M13.25 2.25 4.9 13.35a.75.75 0 0 0 .6 1.2h5.08l-1.84 7.02a.75.75 0 0 0 1.33.62l8.95-11.55a.75.75 0 0 0-.6-1.21h-5.21l1.45-6.54a.75.75 0 0 0-1.41-.64Z";

  if (
    typeof renderWebsitePhotoDrop !== "function" ||
    typeof renderPage !== "function" ||
    typeof state === "undefined" ||
    typeof nodes === "undefined" ||
    !nodes.tbody
  ) {
    return;
  }

  function injectPhotoActionStyles() {
    if (document.getElementById("premiumDatabasePhotoActionsStyle")) return;
    const style = document.createElement("style");
    style.id = "premiumDatabasePhotoActionsStyle";
    style.textContent = [
      "@keyframes softora-photo-spin{to{transform:rotate(360deg)}}",
      ".photo-drop.is-generating{border-style:solid;background:rgba(155,35,85,.08);cursor:wait}",
      ".photo-generate{width:24px;height:24px;border:0;border-radius:999px;background:rgba(155,35,85,.11);color:var(--crimson);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:transform .15s ease,background .15s ease,box-shadow .15s ease}",
      ".photo-generate:hover{transform:translateY(-1px) scale(1.04);background:rgba(155,35,85,.16);box-shadow:0 8px 18px rgba(155,35,85,.18)}",
      ".photo-generate:disabled{cursor:wait;opacity:.62;transform:none;box-shadow:none}",
      ".photo-generate.is-loading:disabled{opacity:1}",
      ".photo-generate.is-loading,.photo-generate.is-loading:hover{background:transparent;box-shadow:none;transform:none}",
      ".photo-generate svg{width:15px;height:15px}",
      ".photo-spinner{width:18px;height:18px;border:2px solid rgba(155,35,85,.18);border-top-color:var(--crimson);border-radius:999px;animation:softora-photo-spin .7s linear infinite}",
      ".webdesign-count-input:focus{border-color:var(--crimson)!important;outline:none!important;box-shadow:0 0 0 3px rgba(155,35,85,.22)!important}",
      ".webdesign-count-input::selection{background:rgba(155,35,85,.24);color:var(--dark,#1a1a2e)}"
    ].join("");
    document.head.appendChild(style);
  }

  function buildCustomerCompany(customer) {
    return normalizeString(customer && customer.bedrijf);
  }

  function buildGenerateLabel(customer) {
    const company = buildCustomerCompany(customer);
    return resolveCustomerWebsiteUrl(customer)
      ? "Webdesign maken voor " + company
      : "Vul eerst een geldige website in voor " + company;
  }

  function buildLoadingLabel(customer) {
    return "Webdesign wordt gemaakt voor " + buildCustomerCompany(customer);
  }

  function renderGenerateButton(customer, customerId, isGenerating) {
    const label = isGenerating ? buildLoadingLabel(customer) : buildGenerateLabel(customer);
    const content = isGenerating
      ? "<span class=\"photo-spinner\" aria-hidden=\"true\"></span>"
      : "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"currentColor\" d=\"" + lightningPath + "\"/></svg>";
    return "<button class=\"photo-generate" + (isGenerating ? " is-loading" : "") + "\" type=\"button\" data-generate-photo-id=\"" + escapeHtml(customerId) + "\" aria-label=\"" + escapeHtml(label) + "\" title=\"" + escapeHtml(label) + "\"" + (isGenerating ? " disabled" : "") + ">" + content + "</button>";
  }

  renderWebsitePhotoDrop = function (customer) {
    if (!shouldShowWebsitePhoto(customer)) return "";
    const photo = normalizeString(customer && customer.websitePhoto);
    const label = normalizeString(customer && customer.websitePhotoName) || "Websitefoto";
    const hasPhoto = isValidWebsitePhotoDataUrl(photo);
    const customerId = normalizeString(customer && customer.id);
    const isGenerating = generatingIds.has(customerId);
    const inner = hasPhoto
      ? "<img src=\"" + escapeHtml(photo) + "\" alt=\"" + escapeHtml(label) + "\">"
      : renderGenerateButton(customer, customerId, isGenerating);
    const remove = hasPhoto
      ? "<button class=\"photo-remove\" type=\"button\" data-remove-photo-id=\"" + escapeHtml(customer.id) + "\" aria-label=\"Websitefoto verwijderen\">&times;</button>"
      : "";
    return "<div class=\"photo-cell\"><div class=\"photo-drop" + (isGenerating ? " is-generating" : "") + "\" role=\"button\" tabindex=\"0\" data-photo-id=\"" + escapeHtml(customer.id) + "\" data-has-photo=\"" + (hasPhoto ? "true" : "false") + "\" aria-label=\"" + (hasPhoto ? "Websitefoto bekijken" : isGenerating ? buildLoadingLabel(customer) : buildGenerateLabel(customer)) + "\">" + inner + remove + "</div></div>";
  };

  function applyGeneratedWebsitePhoto(customerId, generated) {
    const nextCustomers = state.klanten.map(function (customer) {
      if (customer.id !== customerId) return customer;
      return {
        ...customer,
        websitePhoto: generated.dataUrl,
        websitePhotoName: generated.fileName
      };
    });
    state.klanten = typeof sortCustomers === "function" ? sortCustomers(nextCustomers) : nextCustomers;
  }

  async function generateWebdesignPhotoForCustomer(customerId) {
    if (typeof closeAddActions === "function") closeAddActions();
    const cleanId = normalizeString(customerId);
    const customer = state.klanten.find(function (item) {
      return item.id === cleanId;
    });
    if (!customer) {
      setStatusMessage("Bedrijf niet gevonden.", "error", true);
      return;
    }
    if (generatingIds.has(cleanId)) return;
    if (!resolveCustomerWebsiteUrl(customer)) {
      setStatusMessage("Geen geldige website gevonden voor " + customer.bedrijf + ".", "error", true);
      return;
    }

    generatingIds.add(cleanId);
    renderPage();
    try {
      setStatusMessage("");
      const generated = await generateWebsitePhotoData(customer);
      applyGeneratedWebsitePhoto(cleanId, generated);
      renderPage();

      const photoResult = await persistCustomerPhotos(state.klanten);
      if (!photoResult.ok) {
        setStatusMessage("AI-foto staat in beeld, maar opslaan in Supabase mislukte.", "error");
        return;
      }

      toast("AI-foto opgeslagen voor " + customer.bedrijf);
      setStatusMessage("");
    } catch (error) {
      console.error("Webdesign foto genereren mislukt:", error);
      setStatusMessage("Geen AI-foto opgeslagen: " + (normalizeString(error && error.message) || "controleer of de website bereikbaar is."), "error", true);
    } finally {
      generatingIds.delete(cleanId);
      renderPage();
    }
  }

  async function generateWebdesignPhotosWithInlineLoaders() {
    if (typeof closeAddActions === "function") closeAddActions();
    if (nodes.generatePhotosButton) nodes.generatePhotosButton.disabled = true;
    const targets = getWebdesignPhotoTargets();
    try {
      if (!targets.length) {
        setStatusMessage("Geen bedrijven zonder foto met een geldige website gevonden.", "info", true);
        return;
      }

      let done = 0;
      let failed = 0;
      let firstErrorMessage = "";
      setStatusMessage("");

      for (const target of targets) {
        const targetId = normalizeString(target && target.id);
        generatingIds.add(targetId);
        renderPage();
        try {
          const generated = await generateWebsitePhotoData(target);
          applyGeneratedWebsitePhoto(targetId, generated);
          done += 1;
        } catch (error) {
          failed += 1;
          if (!firstErrorMessage) {
            firstErrorMessage = normalizeString(error && error.message);
          }
          console.error("Webdesign foto genereren mislukt:", error);
        } finally {
          generatingIds.delete(targetId);
          renderPage();
        }
      }

      if (!done) {
        setStatusMessage("Geen AI-foto's opgeslagen: " + (firstErrorMessage || "controleer of de websites bereikbaar zijn."), "error");
        return;
      }

      const photoResult = await persistCustomerPhotos(state.klanten);
      if (!photoResult.ok) {
        setStatusMessage("AI-foto's staan in beeld, maar opslaan in Supabase mislukte.", "error");
        return;
      }

      toast(done + " AI-foto" + (done === 1 ? "" : "'s") + " opgeslagen");
      setStatusMessage(failed ? done + " AI-foto" + (done === 1 ? "" : "'s") + " opgeslagen, " + failed + " mislukt." : "");
    } finally {
      if (nodes.generatePhotosButton) nodes.generatePhotosButton.disabled = false;
    }
  }

  function handleGenerateClick(event) {
    const button = event.target.closest && event.target.closest(".photo-generate");
    if (!button || !nodes.tbody.contains(button)) return;
    event.preventDefault();
    event.stopPropagation();
    void generateWebdesignPhotoForCustomer(button.getAttribute("data-generate-photo-id"));
  }

  function collapseCountInputSelection(input) {
    if (!input) return;
    const value = normalizeString(input.value);
    try {
      input.setSelectionRange(value.length, value.length);
    } catch (error) {
      input.value = value;
    }
  }

  function isWebdesignCountDialog(element) {
    const text = normalizeString(element && element.textContent).toLowerCase();
    const compactText = text.replace(/\s+/g, "");
    return compactText.indexOf("webdesignsmaken") !== -1 && text.indexOf("specifiek aantal") !== -1;
  }

  function patchWebdesignCountInput(input) {
    if (!input || input.dataset.softoraWebdesignCountPatched === "true") return;
    input.dataset.softoraWebdesignCountPatched = "true";
    input.classList.add("webdesign-count-input");
    if (input.type === "number") {
      input.type = "text";
      input.inputMode = "numeric";
      input.pattern = "[0-9]*";
    }

    let focusedAt = 0;
    input.addEventListener("focus", function () {
      focusedAt = Date.now();
      window.setTimeout(function () { collapseCountInputSelection(input); }, 0);
      window.setTimeout(function () { collapseCountInputSelection(input); }, 40);
    });
    input.addEventListener("select", function () {
      if (Date.now() - focusedAt > 500) return;
      window.setTimeout(function () { collapseCountInputSelection(input); }, 0);
    });
  }

  function patchWebdesignCountDialog(root) {
    const element = root && root.nodeType === 1 ? root : document.body;
    if (!element) return;
    const dialogs = [element].concat(Array.from(element.querySelectorAll("[role='dialog'], .modal, [class*='modal'], [class*='dialog']")));
    dialogs.forEach(function (dialog) {
      if (!isWebdesignCountDialog(dialog)) return;
      Array.from(dialog.querySelectorAll("input")).forEach(patchWebdesignCountInput);
    });
  }

  function observeWebdesignCountDialogs() {
    patchWebdesignCountDialog(document.body);
    if (typeof MutationObserver !== "function" || !document.body) return;
    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        Array.from(mutation.addedNodes || []).forEach(patchWebdesignCountDialog);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  injectPhotoActionStyles();
  observeWebdesignCountDialogs();
  nodes.tbody.addEventListener("click", handleGenerateClick, true);
  generateWebdesignPhotos = generateWebdesignPhotosWithInlineLoaders;
  window.generateWebdesignPhotos = generateWebdesignPhotosWithInlineLoaders;
  window.SoftoraPremiumDatabasePhotoActions = {
    generateWebdesignPhotoForCustomer,
    generateWebdesignPhotos: generateWebdesignPhotosWithInlineLoaders
  };
  renderPage();
})();
