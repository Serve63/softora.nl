(function () {
  const stage = document.getElementById("cinematicStage");
  const photo = document.getElementById("officePhoto");
  const progressBar = document.getElementById("sceneProgress");
  const percentLabel = document.getElementById("scenePercent");
  const statusLabel = document.getElementById("sceneStatus");
  const panels = Array.from(document.querySelectorAll("[data-story-panel]"));

  if (!stage || !photo || !progressBar || !percentLabel || !statusLabel) {
    return;
  }

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let scrollProgress = 0;
  let smoothProgress = 0;
  let frameCount = 0;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function easeInOut(value) {
    return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
  }

  function updateScrollProgress() {
    const rect = stage.getBoundingClientRect();
    const travel = Math.max(1, rect.height - window.innerHeight);
    scrollProgress = clamp(Math.abs(rect.top) / travel, 0, 1);
  }

  function getShotState(progress) {
    const eased = easeInOut(progress);
    const mobile = window.innerWidth < 760;
    const firstHalf = clamp(eased / 0.52, 0, 1);
    const secondHalf = clamp((eased - 0.52) / 0.48, 0, 1);

    if (mobile) {
      return {
        scale: lerp(1.12, 1.78, eased),
        x: lerp(-18, -32, secondHalf),
        y: lerp(0, 4, firstHalf) + lerp(0, -4, secondHalf),
      };
    }

    return {
      scale: lerp(1.04, 1.42, eased),
      x: lerp(0, -7, secondHalf),
      y: lerp(0, 2, firstHalf) + lerp(0, -3, secondHalf),
    };
  }

  function updateCopy(progress) {
    const active = progress < 0.36 ? 0 : progress < 0.72 ? 1 : 2;
    panels.forEach((panel, index) => {
      panel.classList.toggle("is-active", index === active);
    });
    statusLabel.textContent = active === 0 ? "bovenaanzicht" : active === 1 ? "camera drop" : "front view";
    percentLabel.textContent = String(Math.round(progress * 100)).padStart(2, "0");
    progressBar.style.transform = "scaleX(" + progress.toFixed(4) + ")";
  }

  function paint(progress) {
    const shot = getShotState(progress);
    photo.style.transform = "translate3d(" + shot.x.toFixed(3) + "%, " + shot.y.toFixed(3) + "%, 0) scale(" + shot.scale.toFixed(4) + ")";
    updateCopy(progress);
    frameCount += 1;
    document.body.dataset.cinematicFrameCount = String(frameCount);
    document.body.dataset.cinematicPixelWidth = String(photo.naturalWidth || 0);
    document.body.dataset.cinematicPixelHeight = String(photo.naturalHeight || 0);
    document.body.dataset.cinematicProgress = progress.toFixed(3);
  }

  function tick() {
    const target = prefersReducedMotion ? 0.78 : scrollProgress;
    smoothProgress += (target - smoothProgress) * (prefersReducedMotion ? 1 : 0.09);
    paint(smoothProgress);
    if (!prefersReducedMotion) {
      updateScrollProgress();
    }
    requestAnimationFrame(tick);
  }

  function markReady() {
    document.body.dataset.cinematicReady = "true";
    paint(0);
  }

  updateScrollProgress();
  if (photo.complete) {
    markReady();
  } else {
    photo.addEventListener("load", markReady, { once: true });
  }
  window.addEventListener("resize", updateScrollProgress, { passive: true });
  window.addEventListener("scroll", updateScrollProgress, { passive: true });
  requestAnimationFrame(tick);
})();
