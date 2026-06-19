(function (global) {
  "use strict";

  var JOB_ENDPOINT = "/api/premium-database/cinematic-jobs";
  var POLL_INTERVAL_MS = 2600;
  var STAGE_ORDER = ["scanning", "images", "video", "site", "done"];
  var pollTimer = null;
  var currentJob = null;

  function normalizeString(value) {
    return String(value || "").trim();
  }

  function getNode(id) {
    return global.document ? global.document.getElementById(id) : null;
  }

  function setText(id, value) {
    var node = getNode(id);
    if (node) node.textContent = normalizeString(value);
  }

  function setHidden(node, hidden) {
    if (node) node.hidden = Boolean(hidden);
  }

  function clampProgress(value) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(100, Math.round(numeric)));
  }

  function readLaunchInput() {
    var params = new URLSearchParams(global.location.search || "");
    var company = normalizeString(params.get("company") || params.get("bedrijf"));
    var domain = normalizeString(params.get("domain") || params.get("dom"));
    var website = normalizeString(params.get("website") || params.get("url"));
    var customerId = normalizeString(params.get("customerId") || params.get("id"));
    return {
      customer: {
        id: customerId,
        bedrijf: company,
        dom: domain,
        website: website
      },
      websiteUrl: website || domain,
      displayName: company || domain || website || "Cinematic website"
    };
  }

  function renderStages(stage) {
    var activeIndex = STAGE_ORDER.indexOf(stage);
    if (activeIndex < 0 && stage === "queued") activeIndex = -1;
    var items = global.document ? global.document.querySelectorAll(".stage-item[data-stage]") : [];
    items.forEach(function (item) {
      var itemStage = item.getAttribute("data-stage");
      var itemIndex = STAGE_ORDER.indexOf(itemStage);
      item.classList.toggle("is-active", itemStage === stage || (stage === "queued" && itemStage === "scanning"));
      item.classList.toggle("is-done", activeIndex > itemIndex || stage === "done");
    });
  }

  function renderJob(job) {
    if (!job) return;
    currentJob = job;
    var progress = clampProgress(job.progress);
    var progressBar = getNode("progressBar");
    var video = getNode("previewVideo");
    var frame = getNode("previewFrame");
    var empty = getNode("previewEmpty");
    var errorBox = getNode("errorBox");
    var stage = normalizeString(job.stage || "queued");
    var host = normalizeString(job.site && job.site.host);
    var company = normalizeString(job.customer && job.customer.bedrijf) || "Cinematic website";

    setText("companyTitle", company);
    setText("companyMeta", host || normalizeString(job.websiteUrl) || "Website wordt voorbereid.");
    setText("jobPill", normalizeString(job.id) || "Nieuwe opdracht");
    setText("stageLabel", normalizeString(job.stageLabel) || "Proces loopt");
    setText("progressLabel", progress + "%");
    setText("statusCopy", buildStatusCopy(job));
    if (progressBar) progressBar.style.width = progress + "%";
    renderStages(stage);

    if (job.status === "error") {
      setText("errorText", normalizeString(job.error) || "Proces gestopt.");
      setHidden(errorBox, false);
      setText("previewState", "Gestopt");
      setHidden(empty, false);
      setHidden(video, true);
      setHidden(frame, true);
      return;
    }
    setHidden(errorBox, true);

    if (job.result && job.result.html && frame) {
      if (frame.srcdoc !== job.result.html) frame.srcdoc = job.result.html;
      setHidden(frame, false);
      setHidden(video, true);
      setHidden(empty, true);
      setText("previewState", "Website klaar");
      return;
    }

    if (job.video && job.video.ready && job.video.url && video) {
      if (video.getAttribute("src") !== job.video.url) {
        video.setAttribute("src", job.video.url);
        video.load();
      }
      setHidden(video, false);
      setHidden(frame, true);
      setHidden(empty, true);
      setText("previewState", "Video klaar");
      return;
    }

    setHidden(video, true);
    setHidden(frame, true);
    setHidden(empty, false);
    setText("previewState", stage === "video" ? "Renderen" : "Laden");
    setText("previewEmptyText", stage === "video" ? "Veo is de hero-video aan het renderen." : "De eerste preview verschijnt zodra het AI-proces genoeg materiaal heeft.");
  }

  function buildStatusCopy(job) {
    var stage = normalizeString(job.stage);
    if (stage === "queued") return "We zetten de opdracht klaar.";
    if (stage === "scanning") return "De website wordt gelezen zodat de nieuwe site inhoudelijk klopt.";
    if (stage === "images") return "OpenAI maakt cinematic startbeelden voor de premium richting.";
    if (stage === "video") return "Veo 3.1 zet de beelden om naar een korte hero-video.";
    if (stage === "site") return "De website wordt opgebouwd rond de video, propositie en conversie.";
    if (stage === "done") return "De cinematic premium website staat klaar.";
    if (stage === "error") return "Het proces is gestopt.";
    return "Proces loopt.";
  }

  async function readJsonResponse(response) {
    var data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
    if (!response.ok || !data || data.ok === false) {
      var detail = normalizeString(data && (data.detail || data.error || data.message));
      throw new Error(detail || "Cinematic job mislukt.");
    }
    return data;
  }

  async function startJob() {
    var input = readLaunchInput();
    setText("companyTitle", input.displayName);
    setText("companyMeta", input.websiteUrl || "Website ontbreekt.");
    if (!input.websiteUrl) {
      throw new Error("Geen website gevonden voor deze rij.");
    }
    var response = await fetch(JOB_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        customer: input.customer,
        websiteUrl: input.websiteUrl
      })
    });
    var data = await readJsonResponse(response);
    renderJob(data.job);
    schedulePoll(650);
  }

  async function pollJob() {
    if (!currentJob || !currentJob.id) return;
    var response = await fetch(JOB_ENDPOINT + "/" + encodeURIComponent(currentJob.id), {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json"
      }
    });
    var data = await readJsonResponse(response);
    renderJob(data.job);
    if (data.job && data.job.status !== "done" && data.job.status !== "error") {
      schedulePoll(POLL_INTERVAL_MS);
    }
  }

  function schedulePoll(delay) {
    if (pollTimer) global.clearTimeout(pollTimer);
    pollTimer = global.setTimeout(function () {
      pollTimer = null;
      pollJob().catch(showError);
    }, Math.max(250, Number(delay) || POLL_INTERVAL_MS));
  }

  function showError(error) {
    var job = currentJob || {
      id: "",
      status: "error",
      stage: "error",
      progress: 0,
      customer: { bedrijf: readLaunchInput().displayName },
      error: normalizeString(error && error.message) || "Cinematic proces mislukt."
    };
    job.status = "error";
    job.stage = "error";
    job.error = normalizeString(error && error.message) || job.error;
    renderJob(job);
  }

  function bindActions() {
    var resetButton = getNode("resetButton");
    if (resetButton) {
      resetButton.addEventListener("click", function () {
        global.location.reload();
      });
    }
  }

  function init() {
    bindActions();
    startJob().catch(showError);
  }

  if (global.document && global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
