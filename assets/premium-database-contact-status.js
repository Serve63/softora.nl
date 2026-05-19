(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SoftoraDatabaseContactStatus = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function fallbackNormalizeString(value) {
    return String(value || "").trim();
  }

  function fallbackNormalizeSearchValue(value) {
    return fallbackNormalizeString(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function resolveHelpers(helpers) {
    const options = helpers && typeof helpers === "object" ? helpers : {};
    return {
      normalizeString: typeof options.normalizeString === "function" ? options.normalizeString : fallbackNormalizeString,
      normalizeSearchValue: typeof options.normalizeSearchValue === "function" ? options.normalizeSearchValue : fallbackNormalizeSearchValue
    };
  }

  function normalizeOutreachStatusKey(value, helpers) {
    const normalizeString = resolveHelpers(helpers).normalizeString;
    const normalized = normalizeString(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (["benaderd", "gemaild", "sent", "mailed"].indexOf(normalized) !== -1) return "benaderd";
    if (["reactie_ontvangen", "reply_received", "actie_nodig", "action_required"].indexOf(normalized) !== -1) return "reactie_ontvangen";
    if (["interesse", "interested", "geinteresseerd"].indexOf(normalized) !== -1) return "interesse";
    if (["geen_interesse", "geblokkeerd", "opt_out", "unsubscribe", "geenbehoefte"].indexOf(normalized) !== -1) return "geen_interesse";
    if (["afgehaakt", "lost", "no_deal", "geendeal"].indexOf(normalized) !== -1) return "afgehaakt";
    if (["geen_gehoor", "geengehoor", "no_answer"].indexOf(normalized) !== -1) return "geen_gehoor";
    if (["klant_geworden", "klant", "customer", "paid"].indexOf(normalized) !== -1) return "klant_geworden";
    return "";
  }

  function hasColdmailHistorySignal(raw, helpers) {
    const normalizeSearchValue = resolveHelpers(helpers).normalizeSearchValue;
    const history = Array.isArray(raw && raw.hist) ? raw.hist : [];
    return history.some(function (item) {
      const text = normalizeSearchValue([
        item && item.type,
        item && item.status,
        item && item.label,
        item && item.message,
        item && item.title,
        item && item.source
      ].join(" "));
      return /\b(gemaild|mail verstuurd|mailcontact|coldmail|cold mailing|email)\b/.test(text);
    });
  }

  function getColdmailSentAt(raw, helpers) {
    const normalizeString = resolveHelpers(helpers).normalizeString;
    return normalizeString(raw && (raw.outreachSentAt || raw.outreach_sent_at || raw.lastColdmailSentAt || raw.lastMailSentAt || raw.lastMailedAt || raw.coldmailCampaignStartedAt));
  }

  function hasColdmailSentSignal(raw, helpers) {
    const normalizeString = resolveHelpers(helpers).normalizeString;
    if (!raw || typeof raw !== "object") return false;
    if (normalizeOutreachStatusKey(raw.outreachStatus, helpers) === "benaderd") return true;
    if (getColdmailSentAt(raw, helpers)) return true;
    if (normalizeString(raw.coldmailSentMessageId || raw.outreachMessageId || raw.sentMessageId || raw.messageId)) return true;
    return hasColdmailHistorySignal(raw, helpers);
  }

  function shouldInferMailedStatus(storedStatus, raw, helpers) {
    return ["nieuw", "prospect", "benaderbaar"].indexOf(storedStatus) !== -1 && hasColdmailSentSignal(raw, helpers);
  }

  return {
    normalizeOutreachStatusKey,
    hasColdmailHistorySignal,
    getColdmailSentAt,
    hasColdmailSentSignal,
    shouldInferMailedStatus
  };
});
