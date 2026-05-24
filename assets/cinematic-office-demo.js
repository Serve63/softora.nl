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
  let targetScrollY = window.scrollY;
  let easedScrollY = window.scrollY;
  let smoothProgress = 0;
  let progressVelocity = 0;
  let frameCount = 0;
  let lastFrameTime = performance.now();
  let ignoreNativeScrollUntil = 0;
  let wheelSmoothingActive = false;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function easeCinematic(value) {
    return 0.5 - Math.cos(clamp(value, 0, 1) * Math.PI) / 2;
  }

  function easeSegment(value) {
    const clamped = clamp(value, 0, 1);
    return clamped * clamped * (3 - 2 * clamped);
  }

  function getMaxScrollY() {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }

  function getWheelDelta(event) {
    const multiplier = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? window.innerHeight : 1;
    return event.deltaY * multiplier;
  }

  function updateScrollProgress(scrollY) {
    const stageTop = stage.offsetTop;
    const travel = Math.max(1, stage.offsetHeight - window.innerHeight);
    scrollProgress = clamp((scrollY - stageTop) / travel, 0, 1);
  }

  function syncNativeScroll() {
    if (performance.now() < ignoreNativeScrollUntil) {
      return;
    }
    targetScrollY = window.scrollY;
    easedScrollY = window.scrollY;
    wheelSmoothingActive = false;
    updateScrollProgress(easedScrollY);
  }

  function smoothWheelScroll(deltaSeconds) {
    if (prefersReducedMotion || !wheelSmoothingActive) {
      updateScrollProgress(window.scrollY);
      return;
    }

    const follow = 1 - Math.exp(-deltaSeconds * 8.5);
    easedScrollY += (targetScrollY - easedScrollY) * follow;

    if (Math.abs(targetScrollY - easedScrollY) < 0.45) {
      easedScrollY = targetScrollY;
      wheelSmoothingActive = false;
    }

    if (Math.abs(window.scrollY - easedScrollY) > 0.2) {
      ignoreNativeScrollUntil = performance.now() + 120;
      window.scrollTo(0, easedScrollY);
    }

    updateScrollProgress(easedScrollY);
  }

  function smoothCameraProgress(target, deltaSeconds) {
    const diff = target - smoothProgress;
    const stiffness = 112;
    const damping = 19;
    progressVelocity += (diff * stiffness - progressVelocity * damping) * deltaSeconds;
    progressVelocity = clamp(progressVelocity, -3.2, 3.2);
    smoothProgress = clamp(smoothProgress + progressVelocity * deltaSeconds, 0, 1);

    if (Math.abs(target - smoothProgress) < 0.0005 && Math.abs(progressVelocity) < 0.004) {
      smoothProgress = target;
      progressVelocity = 0;
    }
  }

  function getShotStates(progress) {
    const eased = easeCinematic(progress);
    const mobile = window.innerWidth < 760;
    const firstHalf = easeSegment(eased / 0.54);
    const secondHalf = easeSegment((eased - 0.46) / 0.54);

    if (mobile) {
      return {
        back: { scale: lerp(1.02, 1.14, eased), x: lerp(18, -18, eased), y: lerp(0, -1.5, eased) },
        main: { scale: lerp(1.08, 1.34, eased), x: lerp(30, -32, eased), y: lerp(2, 0, firstHalf) + lerp(0, -2.5, secondHalf) },
        detail: { scale: lerp(1.16, 1.48, eased), x: lerp(24, -26, eased), y: lerp(0, -2.2, eased), opacity: easeSegment((progress - 0.2) / 0.58) * 0.5 },
      };
    }

    return {
      back: { scale: lerp(1, 1.1, eased), x: lerp(10, -10, eased), y: lerp(0, -0.8, eased) },
      main: { scale: lerp(1.04, 1.28, eased), x: lerp(21, -22, eased), y: lerp(1.2, 0, firstHalf) + lerp(0, -2, secondHalf) },
      detail: { scale: lerp(1.1, 1.42, eased), x: lerp(14, -15, eased), y: lerp(0, -1.6, eased), opacity: easeSegment((progress - 0.26) / 0.5) * 0.44 },
    };
  }

  function updateCopy(progress) {
    const active = progress < 0.36 ? 0 : progress < 0.72 ? 1 : 2;
    panels.forEach((panel, index) => {
      panel.classList.toggle("is-active", index === active);
    });
    statusLabel.textContent = active === 0 ? "pan links" : active === 1 ? "command center" : "pan rechts";
    percentLabel.textContent = String(Math.round(progress * 100)).padStart(2, "0");
    progressBar.style.transform = "scaleX(" + progress.toFixed(4) + ")";
  }

  function paint(progress) {
    const shot = getShotStates(progress);
    const focusOpacity = easeSegment((progress - 0.48) / 0.42);
    const railDrift = easeCinematic(progress);

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
    document.body.dataset.cinematicTargetProgress = scrollProgress.toFixed(3);
    document.body.dataset.cinematicVelocity = progressVelocity.toFixed(4);
  }

  function transformShot(shot) {
    return "translate3d(" + shot.x.toFixed(3) + "%, " + shot.y.toFixed(3) + "%, 0) scale(" + shot.scale.toFixed(4) + ")";
  }

  function tick(now) {
    const deltaSeconds = clamp((now - lastFrameTime) / 1000, 0.001, 0.05);
    lastFrameTime = now;

    if (!prefersReducedMotion) {
      smoothWheelScroll(deltaSeconds);
      smoothCameraProgress(scrollProgress, deltaSeconds);
    } else {
      smoothProgress = 0.78;
      progressVelocity = 0;
    }

    paint(smoothProgress);
    requestAnimationFrame(tick);
  }

  function handleWheel(event) {
    if (prefersReducedMotion || event.ctrlKey) {
      return;
    }

    const delta = getWheelDelta(event);
    if (Math.abs(delta) < 0.1) {
      return;
    }

    event.preventDefault();
    targetScrollY = clamp(targetScrollY + delta, 0, getMaxScrollY());
    wheelSmoothingActive = true;
    document.body.dataset.cinematicScrollSmoothing = "wheel";
  }

  function handleResize() {
    targetScrollY = clamp(targetScrollY, 0, getMaxScrollY());
    easedScrollY = clamp(easedScrollY, 0, getMaxScrollY());
    updateScrollProgress(wheelSmoothingActive ? easedScrollY : window.scrollY);
  }

  function markReady() {
    document.body.dataset.cinematicReady = "true";
    document.body.dataset.cinematicLayerMode = "single-panorama";
    paint(0);
  }

  updateScrollProgress(window.scrollY);
  if (photoMain.complete) {
    markReady();
  } else {
    photoMain.addEventListener("load", markReady, { once: true });
  }
  window.addEventListener("resize", handleResize, { passive: true });
  window.addEventListener("scroll", syncNativeScroll, { passive: true });
  window.addEventListener("wheel", handleWheel, { passive: false });
  requestAnimationFrame(tick);
})();
