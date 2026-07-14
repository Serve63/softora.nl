(function (global) {
  "use strict";

  var POLL_INTERVAL_MS = 2500;
  var pollTimer = null;

  function node(id) {
    return global.document.getElementById(id);
  }

  function companyIdFromPath() {
    var match = global.location.pathname.match(/^\/bedrijven\/([^/]+)\/video\/?$/);
    if (!match) return "";
    try { return decodeURIComponent(match[1]); } catch (_error) { return ""; }
  }

  function endpoint(companyId) {
    return "/api/bedrijven/" + encodeURIComponent(companyId) + "/website-video";
  }

  function clearPoll() {
    if (pollTimer) global.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function setStatus(message, options) {
    var settings = options || {};
    node("statusTitle").textContent = message;
    node("statusPanel").hidden = false;
    node("videoPlayer").hidden = true;
    node("calmLoader").hidden = settings.loading === false;
    node("retryButton").hidden = !settings.retry;
    node("videoStage").setAttribute("aria-busy", settings.loading === false ? "false" : "true");
  }

  function showVideo(video) {
    clearPoll();
    var player = node("videoPlayer");
    node("statusPanel").hidden = true;
    player.hidden = false;
    if (player.getAttribute("src") !== video.videoUrl) player.setAttribute("src", video.videoUrl);
    node("videoStage").setAttribute("aria-busy", "false");
  }

  function applyCompany(video) {
    if (!video) return;
    node("pageTitle").textContent = "Websitevideo van " + (video.companyName || "bedrijf");
    global.document.title = "Websitevideo van " + (video.companyName || "bedrijf") + " - Softora";
    var website = node("websiteUrl");
    website.textContent = video.websiteUrl || "";
    website.hidden = !video.websiteUrl;
  }

  async function requestStatus(companyId) {
    var response = await global.fetch(endpoint(companyId), { credentials: "same-origin", cache: "no-store" });
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok || !body.ok) throw new Error(body.error || "Status ophalen mislukt.");
    return body.video;
  }

  async function startRender(companyId, retry) {
    var response = await global.fetch(endpoint(companyId), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retry: Boolean(retry) })
    });
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok || !body.ok) throw new Error(body.error || "Render starten mislukt.");
    return body.video;
  }

  function schedulePoll(companyId) {
    clearPoll();
    pollTimer = global.setTimeout(function () { refresh(companyId, false); }, POLL_INTERVAL_MS);
  }

  async function refresh(companyId, allowStart) {
    try {
      var video = await requestStatus(companyId);
      applyCompany(video);
      if (video.status === "ready") return showVideo(video);
      if (video.status === "no_website") {
        clearPoll();
        return setStatus("Voor dit bedrijf is geen geldige website gevonden.", { loading: false });
      }
      if (video.status === "failed") {
        clearPoll();
        return setStatus("De video kon niet worden geladen.", { loading: false, retry: true });
      }
      if ((video.status === "missing" || video.needsRender) && allowStart) {
        video = await startRender(companyId, false);
        applyCompany(video);
      }
      setStatus("Video wordt geladen...", { loading: true });
      schedulePoll(companyId);
    } catch (_error) {
      clearPoll();
      setStatus("De video kon niet worden geladen.", { loading: false, retry: true });
    }
  }

  function init() {
    var companyId = companyIdFromPath();
    if (!companyId) return setStatus("De video kon niet worden geladen.", { loading: false });
    node("retryButton").addEventListener("click", async function () {
      setStatus("Video wordt geladen...", { loading: true });
      try {
        await startRender(companyId, true);
        schedulePoll(companyId);
      } catch (_error) {
        setStatus("De video kon niet worden geladen.", { loading: false, retry: true });
      }
    });
    refresh(companyId, true);
  }

  global.addEventListener("DOMContentLoaded", init);
})(window);
