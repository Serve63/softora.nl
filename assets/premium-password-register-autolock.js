(function (global) {
  "use strict";

  var DEFAULT_INACTIVITY_MS = 5 * 60 * 1000;

  function createAutoLock(options) {
    var config = options || {};
    var targetDocument = config.document || global.document;
    var targetWindow = config.window || global;
    var setTimer = config.setTimeout || global.setTimeout.bind(global);
    var clearTimer = config.clearTimeout || global.clearTimeout.bind(global);
    var now = config.now || Date.now;
    var inactivityMs = Number(config.inactivityMs) || DEFAULT_INACTIVITY_MS;
    var onLock = typeof config.onLock === "function" ? config.onLock : function () {};
    var timerId = null;
    var active = false;
    var lastActivityAt = 0;

    function clearScheduledLock() {
      if (timerId == null) return;
      clearTimer(timerId);
      timerId = null;
    }

    function stop() {
      active = false;
      clearScheduledLock();
    }

    function lock(reason) {
      if (!active) return;
      stop();
      onLock(String(reason || "security-event"));
    }

    function schedule() {
      clearScheduledLock();
      if (!active) return;
      var elapsed = Math.max(0, now() - lastActivityAt);
      var remaining = Math.max(0, inactivityMs - elapsed);
      timerId = setTimer(function () {
        if (!active) return;
        if (now() - lastActivityAt >= inactivityMs) {
          lock("inactivity");
        } else {
          schedule();
        }
      }, remaining);
    }

    function recordActivity() {
      if (!active || (targetDocument && targetDocument.hidden)) return;
      lastActivityAt = now();
      schedule();
    }

    function start() {
      active = true;
      lastActivityAt = now();
      if (targetDocument && targetDocument.hidden) {
        lock("hidden");
        return;
      }
      schedule();
    }

    function handleVisibilityChange() {
      if (targetDocument && targetDocument.hidden) lock("hidden");
    }

    function handleFocus() {
      if (!active) return;
      if (now() - lastActivityAt >= inactivityMs) {
        lock("resume-timeout");
        return;
      }
      recordActivity();
    }

    ["pointerdown", "keydown", "touchstart", "focusin"].forEach(function (eventName) {
      if (targetDocument && typeof targetDocument.addEventListener === "function") {
        targetDocument.addEventListener(eventName, recordActivity, { capture: true, passive: true });
      }
    });
    if (targetDocument && typeof targetDocument.addEventListener === "function") {
      targetDocument.addEventListener("visibilitychange", handleVisibilityChange, true);
      targetDocument.addEventListener("freeze", function () { lock("freeze"); }, true);
    }
    if (targetWindow && typeof targetWindow.addEventListener === "function") {
      targetWindow.addEventListener("pagehide", function () { lock("pagehide"); }, true);
      targetWindow.addEventListener("pageshow", handleFocus, true);
      targetWindow.addEventListener("blur", function () { lock("blur"); }, true);
      targetWindow.addEventListener("focus", handleFocus, true);
    }

    return {
      isActive: function () { return active; },
      recordActivity: recordActivity,
      start: start,
      stop: stop
    };
  }

  global.SoftoraPasswordRegisterAutoLock = {
    DEFAULT_INACTIVITY_MS: DEFAULT_INACTIVITY_MS,
    create: createAutoLock
  };
})(window);
