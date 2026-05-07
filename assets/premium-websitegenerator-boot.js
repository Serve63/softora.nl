(function () {
  function finishPremiumShellBoot() {
    if (window.SoftoraPremiumBoot && typeof window.SoftoraPremiumBoot.setShellBooting === "function") {
      window.SoftoraPremiumBoot.setShellBooting(false);
      return;
    }
    if (window.SoftoraPremiumBootTiming && typeof window.SoftoraPremiumBootTiming.release === "function") {
      window.SoftoraPremiumBootTiming.release();
      return;
    }
    document.documentElement.removeAttribute("data-personnel-loading");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", finishPremiumShellBoot, { once: true });
  } else {
    finishPremiumShellBoot();
  }
})();
