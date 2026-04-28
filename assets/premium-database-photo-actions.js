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
      ".photo-drop.is-generating{border-style:solid;background:rgba(155,35,85,.08);cursor:wait}",
      ".photo-generate{width:24px;height:24px;border:0;border-radius:999px;background:rgba(155,35,85,.11);color:var(--crimson);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:transform .15s ease,background .15s ease,box-shadow .15s ease}",
      ".photo-generate:hover{transform:translateY(-1px) scale(1.04);background:rgba(155,35,85,.16);box-shadow:0 8px 18px rgba(155,35,85,.18)}",
      ".photo-generate:disabled{cursor:wait;opacity:.62;transform:none;box-shadow:none}",
      ".photo-generate svg{width:15px;height:15px}"
    ].join("");
    document.head.appendChild(style);
  }

  function buildGenerateLabel(customer) {
    const company = normalizeString(customer && customer.bedrijf);
    return resolveCustomerWebsiteUrl(customer)
      ? "Webdesign maken voor " + company
      : "Vul eerst een geldige website in voor " + company;
  }

  function renderGenerateButton(customer, customerId, isGenerating) {
    const label = buildGenerateLabel(customer);
    return "<button class=\"photo-generate\" type=\"button\" data-generate-photo-id=\"" + escapeHtml(customerId) + "\" aria-label=\"" + escapeHtml(label) + "\" title=\"" + escapeHtml(label) + "\"" + (isGenerating ? " disabled" : "") + "><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"currentColor\" d=\"" + lightningPath + "\"/></svg></button>";
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
    return "<div class=\"photo-cell\"><div class=\"photo-drop" + (isGenerating ? " is-generating" : "") + "\" role=\"button\" tabindex=\"0\" data-photo-id=\"" + escapeHtml(customer.id) + "\" data-has-photo=\"" + (hasPhoto ? "true" : "false") + "\" aria-label=\"" + (hasPhoto ? "Websitefoto bekijken" : buildGenerateLabel(customer)) + "\">" + inner + remove + "</div></div>";
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
      setStatusMessage("Webdesign maken voor " + customer.bedrijf + "...", "info");
      const generated = await generateWebsitePhotoData(customer);
      applyGeneratedWebsitePhoto(cleanId, generated);
      renderPage();

      const photoResult = await persistCustomerPhotos(state.klanten);
      if (!photoResult.ok) {
        setStatusMessage("AI-foto staat in beeld, maar opslaan in Supabase mislukte.", "error");
        return;
      }

      toast("AI-foto opgeslagen voor " + customer.bedrijf);
      setStatusMessage("Webdesign opgeslagen voor " + customer.bedrijf + ".", "success", true);
    } catch (error) {
      console.error("Webdesign foto genereren mislukt:", error);
      setStatusMessage("Geen AI-foto opgeslagen: " + (normalizeString(error && error.message) || "controleer of de website bereikbaar is."), "error", true);
    } finally {
      generatingIds.delete(cleanId);
      renderPage();
    }
  }

  function handleGenerateClick(event) {
    const button = event.target.closest && event.target.closest(".photo-generate");
    if (!button || !nodes.tbody.contains(button)) return;
    event.preventDefault();
    event.stopPropagation();
    void generateWebdesignPhotoForCustomer(button.getAttribute("data-generate-photo-id"));
  }

  injectPhotoActionStyles();
  nodes.tbody.addEventListener("click", handleGenerateClick, true);
  window.SoftoraPremiumDatabasePhotoActions = {
    generateWebdesignPhotoForCustomer
  };
  renderPage();
})();
