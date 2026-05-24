(function () {
  const stage = document.getElementById("cinematicStage");
  const photoMain = document.getElementById("officePhotoMain");
  const progressBar = document.getElementById("sceneProgress");
  const percentLabel = document.getElementById("scenePercent");
  const statusLabel = document.getElementById("sceneStatus");
  const panels = Array.from(document.querySelectorAll("[data-story-panel]"));
  const revealElements = Array.from(document.querySelectorAll("[data-reveal]"));
  const motion = window.Motion;

  if (!stage || !photoMain || !progressBar || !percentLabel || !statusLabel || !motion) {
    return;
  }

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let scrollCleanups = [];
  let revealCleanups = [];
  let frameCount = 0;

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

  function getShotStates(progress) {
    const eased = easeCinematic(progress);
    const mobile = window.innerWidth < 760;
    const firstHalf = easeSegment(eased / 0.54);
    const secondHalf = easeSegment((eased - 0.46) / 0.54);

    if (mobile) {
      return {
        main: {
          scale: lerp(1.08, 1.34, eased),
          x: lerp(30, -32, eased),
          y: lerp(2, 0, firstHalf) + lerp(0, -2.5, secondHalf),
        },
      };
    }

    return {
      main: {
        scale: lerp(1.04, 1.28, eased),
        x: lerp(21, -22, eased),
        y: lerp(1.2, 0, firstHalf) + lerp(0, -2, secondHalf),
      },
    };
  }

  function transformShot(shot) {
    return "translate3d(" + shot.x.toFixed(3) + "%, " + shot.y.toFixed(3) + "%, 0) scale(" + shot.scale.toFixed(4) + ")";
  }

  function createPanoramaKeyframes() {
    return [0, 0.5, 1].map((progress) => transformShot(getShotStates(progress).main));
  }

  function updateCopy(progress) {
    const active = progress < 0.36 ? 0 : progress < 0.72 ? 1 : 2;
    panels.forEach((panel, index) => {
      panel.classList.toggle("is-active", index === active);
    });
    statusLabel.textContent = active === 0 ? "pan links" : active === 1 ? "command center" : "pan rechts";
    percentLabel.textContent = String(Math.round(progress * 100)).padStart(2, "0");
  }

  function paintMeta(progress, info) {
    const focusOpacity = easeSegment((progress - 0.48) / 0.42);
    const railDrift = easeCinematic(progress);

    document.documentElement.style.setProperty("--focus-opacity", focusOpacity.toFixed(3));
    document.documentElement.style.setProperty("--light-x", lerp(-34, 34, railDrift).toFixed(3) + "%");
    updateCopy(progress);
    frameCount += 1;
    document.body.dataset.cinematicFrameCount = String(frameCount);
    document.body.dataset.cinematicPixelWidth = String(photoMain.naturalWidth || 0);
    document.body.dataset.cinematicPixelHeight = String(photoMain.naturalHeight || 0);
    document.body.dataset.cinematicProgress = progress.toFixed(3);
    document.body.dataset.cinematicTargetProgress = progress.toFixed(3);
    document.body.dataset.cinematicVelocity = String(Math.round((info?.y?.velocity || 0) * 100) / 100);
  }

  function clearScrollBindings() {
    scrollCleanups.forEach((cleanup) => cleanup());
    scrollCleanups = [];
  }

  function clearRevealBindings() {
    revealCleanups.forEach((cleanup) => cleanup());
    revealCleanups = [];
  }

  function bindMotionScroll() {
    clearScrollBindings();

    if (prefersReducedMotion) {
      const reducedProgress = 0.78;
      photoMain.style.transform = transformShot(getShotStates(reducedProgress).main);
      progressBar.style.transform = "scaleX(" + reducedProgress + ")";
      paintMeta(reducedProgress);
      document.body.dataset.cinematicMotionEngine = "reduced";
      return;
    }

    const scrollOptions = {
      target: stage,
      offset: ["start start", "end end"],
      trackContentSize: true,
    };

    const panoramaAnimation = motion.animate(
      photoMain,
      { transform: createPanoramaKeyframes() },
      { duration: 1, ease: "linear" }
    );
    const progressAnimation = motion.animate(
      progressBar,
      { transform: ["scaleX(0)", "scaleX(1)"] },
      { duration: 1, ease: "linear" }
    );

    scrollCleanups.push(motion.scroll(panoramaAnimation, scrollOptions));
    scrollCleanups.push(motion.scroll(progressAnimation, scrollOptions));
    scrollCleanups.push(motion.scroll(paintMeta, scrollOptions));
    document.body.dataset.cinematicMotionEngine = "motion-scroll";
  }

  function bindSectionReveals() {
    clearRevealBindings();

    if (!revealElements.length) {
      return;
    }

    if (prefersReducedMotion || !motion.inView) {
      revealElements.forEach((element) => {
        element.style.opacity = "1";
        element.style.transform = "translateY(0px)";
      });
      document.body.dataset.cinematicSiteMotion = "reduced";
      return;
    }

    revealElements.forEach((element, index) => {
      element.style.opacity = "0";
      element.style.transform = "translateY(28px)";
      element.style.willChange = "opacity, transform";

      const cleanup = motion.inView(
        element,
        (target) => {
          motion.animate(
            target,
            { opacity: 1, transform: "translateY(0px)" },
            {
              duration: 0.78,
              delay: Math.min((index % 4) * 0.045, 0.16),
              ease: [0.22, 1, 0.36, 1],
            }
          );

          return () => {};
        },
        { margin: "0px 0px -16% 0px" }
      );

      revealCleanups.push(cleanup);
    });

    document.body.dataset.cinematicSiteMotion = "motion-reveal";
  }

  function markReady() {
    document.body.dataset.cinematicReady = "true";
    document.body.dataset.cinematicLayerMode = "single-panorama";
    bindMotionScroll();
    bindSectionReveals();
    paintMeta(0);
  }

  if (photoMain.complete) {
    markReady();
  } else {
    photoMain.addEventListener("load", markReady, { once: true });
  }

  window.addEventListener("resize", bindMotionScroll, { passive: true });
})();
