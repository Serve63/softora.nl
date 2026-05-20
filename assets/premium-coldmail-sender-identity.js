(function () {
  "use strict";

  var allowedSenderEmails = [
    "ruben@softora.nl",
    "serve@softora.nl",
    "martijn@softora.nl",
  ];
  var applyDelaysMs = [0, 250, 750, 1500, 3000];
  var senderTouchedByUser = false;
  var applyingIdentitySender = false;

  function normalizeSenderEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeIdentityText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function resolveAllowedSenderEmail(senderEmail, availableEmails) {
    var allowedEmails = Array.isArray(availableEmails) && availableEmails.length
      ? availableEmails.map(normalizeSenderEmail)
      : allowedSenderEmails;
    var normalizedEmail = normalizeSenderEmail(senderEmail);
    return allowedEmails.indexOf(normalizedEmail) !== -1 ? normalizedEmail : "";
  }

  function resolveColdmailSenderEmailFromSession(session, availableEmails) {
    var directEmail = resolveAllowedSenderEmail(session && session.email, availableEmails);
    if (directEmail) return directEmail;

    var identityText = normalizeIdentityText([
      session && session.displayName,
      session && session.firstName,
      session && session.lastName,
      session && session.email,
    ].filter(Boolean).join(" "));

    if (identityText.indexOf("martijn") !== -1) {
      return resolveAllowedSenderEmail("martijn@softora.nl", availableEmails);
    }
    if (
      identityText.indexOf("serve") !== -1 ||
      identityText.indexOf("servec") !== -1 ||
      identityText.indexOf("creusen") !== -1
    ) {
      return resolveAllowedSenderEmail("serve@softora.nl", availableEmails);
    }
    if (identityText.indexOf("ruben") !== -1) {
      return resolveAllowedSenderEmail("ruben@softora.nl", availableEmails);
    }
    return "";
  }

  function getSenderSelect() {
    return document.getElementById("campaignSenderEmail");
  }

  function getAvailableSenderEmails(select) {
    return Array.prototype.slice.call((select && select.options) || [])
      .map(function (option) {
        return normalizeSenderEmail(option.value);
      })
      .filter(Boolean);
  }

  function applySenderEmail(senderEmail) {
    if (senderTouchedByUser) return false;
    var select = getSenderSelect();
    if (!select) return false;
    var resolvedEmail = resolveAllowedSenderEmail(senderEmail, getAvailableSenderEmails(select));
    if (!resolvedEmail) return false;

    applyingIdentitySender = true;
    try {
      select.value = resolvedEmail;
      if (typeof window.syncCustomSelect === "function") {
        window.syncCustomSelect(select);
      }
      if (typeof window.applyColdmailingTemplateForSender === "function") {
        window.applyColdmailingTemplateForSender(resolvedEmail);
      }
      select.setAttribute("data-authenticated-sender-email", resolvedEmail);
    } finally {
      applyingIdentitySender = false;
    }
    return true;
  }

  function watchManualSenderChanges() {
    var select = getSenderSelect();
    if (!select || select.dataset.identitySenderWatch === "1") return;
    select.dataset.identitySenderWatch = "1";
    select.addEventListener("change", function () {
      if (!applyingIdentitySender) senderTouchedByUser = true;
    }, true);
  }

  function scheduleSenderApplications(senderEmail) {
    applyDelaysMs.forEach(function (delayMs) {
      window.setTimeout(function () {
        watchManualSenderChanges();
        applySenderEmail(senderEmail);
      }, delayMs);
    });
  }

  async function hydrateAuthenticatedColdmailSender() {
    if (location.pathname.indexOf("premium-ai-lead-generator") !== -1) return "";
    var response = await fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Accept": "application/json" },
    });
    var session = await response.json().catch(function () { return null; });
    var senderEmail = resolveColdmailSenderEmailFromSession(session, allowedSenderEmails);
    if (senderEmail) scheduleSenderApplications(senderEmail);
    return senderEmail;
  }

  function bootColdmailSenderIdentity() {
    watchManualSenderChanges();
    hydrateAuthenticatedColdmailSender().catch(function () {
      /* Sender correction is best-effort; the campaign form remains usable. */
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootColdmailSenderIdentity, { once: true });
  } else {
    bootColdmailSenderIdentity();
  }

  window.SoftoraColdmailSenderIdentity = {
    resolveColdmailSenderEmailFromSession: resolveColdmailSenderEmailFromSession,
    applySenderEmail: applySenderEmail,
  };
})();
