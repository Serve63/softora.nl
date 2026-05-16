(function () {
  "use strict";

  var loginPath = "/premium-personeel-login";
  var pathname = String((window.location && window.location.pathname) || "");
  if (!/^\/premium-/i.test(pathname) || /^\/premium-personeel-login\/?$/i.test(pathname)) return;
  if (typeof window.fetch !== "function") return;

  var nativeFetch = window.fetch.bind(window);
  var redirecting = false;

  function getCurrentPath() {
    var loc = window.location || {};
    return String((loc.pathname || "/") + (loc.search || "") + (loc.hash || "")) || "/premium-personeel-dashboard";
  }

  function redirectToLogin() {
    if (redirecting) return;
    redirecting = true;
    var params = new URLSearchParams();
    params.set("next", getCurrentPath());
    params.set("expired", "1");
    window.location.replace(loginPath + "?" + params.toString());
  }

  function getRequestUrl(input) {
    try {
      return new URL(typeof input === "string" ? input : String((input && input.url) || ""), window.location.href);
    } catch (_) {
      return null;
    }
  }

  function isProtectedApiAuthFailure(input, response) {
    var requestUrl = getRequestUrl(input);
    return Boolean(
      response &&
      response.status === 401 &&
      requestUrl &&
      requestUrl.origin === window.location.origin &&
      requestUrl.pathname.indexOf("/api/") === 0 &&
      requestUrl.pathname !== "/api/auth/session"
    );
  }

  window.fetch = function softoraPremiumSessionFetch(input, init) {
    return nativeFetch(input, init).then(function (response) {
      if (isProtectedApiAuthFailure(input, response)) redirectToLogin();
      return response;
    });
  };

  async function checkSessionStillActive() {
    if (redirecting) return;
    try {
      var response = await nativeFetch("/api/auth/session", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store"
      });
      if (!response.ok) return;
      var payload = await response.json().catch(function () { return null; });
      if (!payload || payload.authenticated !== true) redirectToLogin();
    } catch (_) {
      /* netwerkfout: laat de pagina met rust */
    }
  }

  window.addEventListener("focus", checkSessionStillActive);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") checkSessionStillActive();
  });
  window.setTimeout(checkSessionStillActive, 1500);
  window.setInterval(checkSessionStillActive, 60000);
})();
