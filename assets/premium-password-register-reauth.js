function initializePasswordRegisterReauth(global) {
  "use strict";

  var root = global.document && global.document.documentElement;
  if (!root || root.getAttribute("data-password-register-auth-recovery") !== "1") return;

  var retryButton = global.document.getElementById("password-register-auth-retry");
  var statusElement = global.document.getElementById("password-register-auth-recovery-status");
  var retryable = root.getAttribute("data-password-register-auth-retryable") === "1";
  var automaticDelaysMs = [900, 2400];
  var automaticAttempt = 0;
  var activeController = null;
  var scheduledRetry = null;
  var requestGeneration = 0;

  function setStatus(message) {
    if (statusElement) statusElement.textContent = String(message || "");
  }

  function setBusy(busy) {
    if (!retryButton) return;
    retryButton.disabled = Boolean(busy);
    retryButton.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function clearScheduledRetry() {
    if (scheduledRetry !== null) {
      global.clearTimeout(scheduledRetry);
      scheduledRetry = null;
    }
  }

  function abortActiveRequest() {
    if (activeController) activeController.abort();
    activeController = null;
  }

  function getSafeResponseData(response) {
    if (!response || typeof response.json !== "function") return Promise.resolve({});
    return response.json().catch(function () { return {}; });
  }

  function confirmFreshSession(options) {
    var settings = options || {};
    var generation = requestGeneration + 1;
    requestGeneration = generation;
    abortActiveRequest();
    activeController = new global.AbortController();
    var controller = activeController;
    var timedOut = false;
    var timeout = global.setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, 6500);

    setBusy(true);
    setStatus(settings.automatic ? "Beveiligde sessie wordt opnieuw gecontroleerd…" : "Toegang wordt opnieuw bevestigd…");

    return global.fetch("/premium-wachtwoordenregister", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Accept": "application/json",
        "X-Softora-Requested-With": "premium"
      },
      signal: controller.signal
    }).then(function (response) {
      return getSafeResponseData(response).then(function (data) {
        return { response: response, data: data };
      });
    }).then(function (result) {
      if (generation !== requestGeneration) return;
      if (result.response.ok && result.data && result.data.ok === true) {
        setStatus("Sessie bevestigd. Het beveiligde scherm wordt geopend…");
        global.location.replace("/premium-wachtwoordenregister");
        return;
      }
      if (result.response.status === 401) {
        setStatus("Je sessie is verlopen. Je wordt veilig naar inloggen gebracht…");
        global.location.assign("/premium-personeel-login?next=%2Fpremium-wachtwoordenregister&expired=1");
        return;
      }
      if (result.response.status === 403) {
        setStatus("Deze sessie heeft geen toegang tot het wachtwoordenregister.");
        return;
      }
      setStatus("Bevestigen lukte nog niet. Je kluis blijft veilig gesloten; probeer het zo opnieuw.");
    }).catch(function (error) {
      if (generation !== requestGeneration || ((error && error.name === "AbortError") && !timedOut)) return;
      setStatus("Bevestigen lukte nog niet. Je kluis blijft veilig gesloten; probeer het zo opnieuw.");
    }).finally(function () {
      global.clearTimeout(timeout);
      if (generation !== requestGeneration) return;
      activeController = null;
      setBusy(false);
    });
  }

  function scheduleAutomaticRetry() {
    if (!retryable || automaticAttempt >= automaticDelaysMs.length) return;
    var delay = automaticDelaysMs[automaticAttempt];
    automaticAttempt += 1;
    scheduledRetry = global.setTimeout(function () {
      scheduledRetry = null;
      confirmFreshSession({ automatic: true }).finally(scheduleAutomaticRetry);
    }, delay);
  }

  if (retryButton) {
    retryButton.addEventListener("click", function () {
      clearScheduledRetry();
      confirmFreshSession({ automatic: false });
    });
  }

  global.addEventListener("pagehide", function () {
    requestGeneration += 1;
    clearScheduledRetry();
    abortActiveRequest();
    setBusy(false);
  }, { once: true });

  scheduleAutomaticRetry();
}

if (typeof module === "object" && module.exports) {
  module.exports = initializePasswordRegisterReauth;
} else {
  initializePasswordRegisterReauth(window);
}
