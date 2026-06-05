(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SoftoraDatabaseTableHelpers = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function fallbackNormalizeString(value) { return String(value || "").trim(); }
  function fallbackNormalizeSearchValue(value) { return fallbackNormalizeString(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
  function resolveHelpers(helpers) {
    const options = helpers && typeof helpers === "object" ? helpers : {};
    return {
      normalizeString: typeof options.normalizeString === "function" ? options.normalizeString : fallbackNormalizeString,
      normalizeSearchValue: typeof options.normalizeSearchValue === "function" ? options.normalizeSearchValue : fallbackNormalizeSearchValue,
      normalizeDatabaseStatus: typeof options.normalizeDatabaseStatus === "function" ? options.normalizeDatabaseStatus : function (value) { return fallbackNormalizeSearchValue(value).replace(/\s+/g, "_"); }
    };
  }
  function mapColdCallingOutcomeText(text, helpers) {
    const normalized = resolveHelpers(helpers).normalizeSearchValue(text);
    if (/\b(buiten gebruik|nummer buiten gebruik|ongeldig nummer|invalid number|not in service|disconnected|wrong number|verkeerd nummer)\b/.test(normalized)) return "buiten";
    if (/\b(geen gehoor|no answer|not answered|unanswered|voicemail|niet opgenomen)\b/.test(normalized)) return "geengehoor";
    if (/\b(geen interesse|geen behoefte|niet geinteresseerd|not interested|do not call|geblokkeerd|opt out)\b/.test(normalized)) return "geblokkeerd";
    return "";
  }
  function hasColdCallingActionText(text, helpers) { return /\b(gebeld|belpoging|coldcall|cold calling|coldcalling|call|retell|vapi|twilio|telefonisch)\b/.test(resolveHelpers(helpers).normalizeSearchValue(text)); }
  function getColdCallingFieldText(customer, helpers) {
    const normalizeSearchValue = resolveHelpers(helpers).normalizeSearchValue;
    return normalizeSearchValue([customer && customer.coldcallingStatus, customer && customer.callOutcome, customer && customer.lastColdcallAt].join(" "));
  }
  function getColdCallingHistoryOutcome(customer, helpers) {
    const normalizeSearchValue = resolveHelpers(helpers).normalizeSearchValue;
    const history = Array.isArray(customer && customer.hist) ? customer.hist : [];
    for (let index = 0; index < history.length; index += 1) {
      const item = history[index], text = normalizeSearchValue([item && item.type, item && item.status, item && item.label, item && item.message, item && item.title, item && item.source].join(" "));
      if (hasColdCallingActionText(text, helpers)) { const outcome = mapColdCallingOutcomeText(text, helpers); if (outcome) return outcome; }
    }
    return "";
  }
  function hasUsedColdCalling(customer, helpers) {
    const resolved = resolveHelpers(helpers);
    const status = resolved.normalizeDatabaseStatus(customer && customer.status, customer);
    if (status === "gebeld") return true;
    if (getColdCallingFieldText(customer, resolved)) return true;
    const history = Array.isArray(customer && customer.hist) ? customer.hist : [];
    return history.some(function (item) { return hasColdCallingActionText([item && item.type, item && item.status, item && item.label, item && item.message, item && item.title].join(" "), resolved); });
  }
  function matchesColdcallingStatusFilter(customer, activeStatus, helpers) {
    const resolved = resolveHelpers(helpers);
    const expected = resolved.normalizeString(activeStatus);
    const fieldOutcome = mapColdCallingOutcomeText(getColdCallingFieldText(customer, resolved), resolved);
    if (fieldOutcome) return fieldOutcome === expected;
    const historyOutcome = getColdCallingHistoryOutcome(customer, resolved);
    if (historyOutcome) return historyOutcome === expected;
    return hasUsedColdCalling(customer, resolved) && resolved.normalizeDatabaseStatus(customer && customer.status, customer) === expected;
  }
  function isColdcallingStatusFilter(status, helpers) { return ["geblokkeerd", "geengehoor", "buiten"].indexOf(resolveHelpers(helpers).normalizeString(status)) !== -1; }
  function getVisibleRows(customers, visibleLimit, pageSize) { const size = Math.max(1, Number(pageSize) || 25); return (customers || []).slice(0, Math.max(size, Number(visibleLimit) || size)); }
  function getNextVisibleLimit(visibleLimit, pageSize) { const size = Math.max(1, Number(pageSize) || 25); return Math.max(size, Number(visibleLimit) || size) + size; }
  function getLoadMoreState(totalCount, renderedCount) {
    const total = Math.max(0, Number(totalCount) || 0);
    const rendered = Math.max(0, Math.min(total, Number(renderedCount) || 0));
    const hasMore = total > rendered;
    return { hasMore, summary: hasMore ? "Toont " + rendered.toLocaleString("nl-NL") + " van " + total.toLocaleString("nl-NL") : "" };
  }

  return { getLoadMoreState, getNextVisibleLimit, getVisibleRows, hasUsedColdCalling, isColdcallingStatusFilter, mapColdCallingOutcomeText, matchesColdcallingStatusFilter };
});
