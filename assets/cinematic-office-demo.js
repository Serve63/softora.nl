(function () {
  const stage = document.getElementById("cinematicStage");
  const photoBack = document.getElementById("officePhotoBack");
  const photoMain = document.getElementById("officePhotoMain");
  const photoDetail = document.getElementById("officePhotoDetail");
  const progressBar = document.getElementById("sceneProgress");
  const percentLabel = document.getElementById("scenePercent");
  const statusLabel = document.getElementById("sceneStatus");
  const panels = Array.from(document.querySelectorAll("[data-story-panel]"));

  if (!stage || !photoBack || !photoMain || !photoDetail || !progressBar || !percentLabel || !statusLabel) {
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
    const stageTop = stage.offsetTop;
    const travel = Math.max(1, stage.offsetHeight - window.innerHeight);
    scrollProgress = clamp((window.scrollY - stageTop) / travel, 0, 1);
  }

  function getShotStates(progress) {
    const eased = easeInOut(progress);
    const mobile = window.innerWidth < 760;
    const firstHalf = clamp(eased / 0.52, 0, 1);
    const secondHalf = clamp((eased - 0.52) / 0.48, 0, 1);

    if (mobile) {
      return {
        back: { scale: lerp(1.04, 1.22, eased), x: lerp(-9, -17, secondHalf), y: lerp(0, -2, eased) },
        main: { scale: lerp(1.18, 1.98, eased), x: lerp(-15, -39, secondHalf), y: lerp(1, 7, firstHalf) + lerp(0, -8, secondHalf) },
        detail: { scale: lerp(1.28, 2.28, eased), x: lerp(-12, -46, secondHalf), y: lerp(0, -8, eased), opacity: clamp((progress - 0.2) / 0.58, 0, 0.54) },
      };
    }

    return {
      back: { scale: lerp(1.01, 1.18, eased), x: lerp(0, -2.8, secondHalf), y: lerp(0, -1.5, eased) },
      main: { scale: lerp(1.06, 1.58, eased), x: lerp(0, -11.5, secondHalf), y: lerp(0, 2.4, firstHalf) + lerp(0, -5.4, secondHalf) },
      detail: { scale: lerp(1.14, 1.92, eased), x: lerp(1.5, -17, secondHalf), y: lerp(0, -4.5, eased), opacity: clamp((progress - 0.26) / 0.5, 0, 0.48) },
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
    const shot = getShotStates(progress);
    const focusOpacity = clamp((progress - 0.48) / 0.42, 0, 1);
    const railDrift = easeInOut(progress);

    photoBack.style.transform = transformShot(shot.back);
    photoMain.style.transform = transformShot(shot.main);
    photoDetail.style.transform = transformShot(shot.detail);
    photoDetail.style.opacity = String(shot.detail.opacity.toFixed(3));
    document.documentElement.style.setProperty("--focus-opacity", focusOpacity.toFixed(3));
    document.documentElement.style.setProperty("--light-x", lerp(-34, 34, railDrift).toFixed(3) + "%");
    document.documentElement.style.setProperty("--rail-left-x", lerp(-22, 24, railDrift).toFixed(3) + "%");
    document.documentElement.style.setProperty("--rail-right-x", lerp(18, -22, railDrift).toFixed(3) + "%");
    updateCopy(progress);
    frameCount += 1;
    document.body.dataset.cinematicFrameCount = String(frameCount);
    document.body.dataset.cinematicPixelWidth = String(photoMain.naturalWidth || 0);
    document.body.dataset.cinematicPixelHeight = String(photoMain.naturalHeight || 0);
    document.body.dataset.cinematicProgress = progress.toFixed(3);
  }

  function transformShot(shot) {
    return "translate3d(" + shot.x.toFixed(3) + "%, " + shot.y.toFixed(3) + "%, 0) scale(" + shot.scale.toFixed(4) + ")";
  }

  function tick() {
    const target = prefersReducedMotion ? 0.78 : scrollProgress;
    smoothProgress += (target - smoothProgress) * (prefersReducedMotion ? 1 : 0.16);
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
  if (photoMain.complete) {
    markReady();
  } else {
    photoMain.addEventListener("load", markReady, { once: true });
  }
  window.addEventListener("resize", updateScrollProgress, { passive: true });
  window.addEventListener("scroll", updateScrollProgress, { passive: true });
  requestAnimationFrame(tick);
})();
