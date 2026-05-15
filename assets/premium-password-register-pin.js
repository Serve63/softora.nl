(function (global) {
  "use strict";

  function createPinController(options) {
    var config = options || {};
    var state = {
      input: "",
      attempts: 0,
      blocked: false,
      checking: false,
      blockTimer: null
    };

    function getElement(value) {
      if (!value) return null;
      if (typeof value === "string") return document.getElementById(value);
      return value;
    }

    function getMessageElement() {
      return getElement(config.messageEl || "pin-msg");
    }

    function setMessage(message) {
      var messageEl = getMessageElement();
      if (messageEl) messageEl.textContent = String(message || "");
    }

    function updateDots(stateClass) {
      document.querySelectorAll(config.dotSelector || ".pin-dot").forEach(function (dot, index) {
        dot.className = "pin-dot";
        if (stateClass) {
          dot.classList.add(stateClass);
        } else if (index < state.input.length) {
          dot.classList.add("filled");
        }
      });
    }

    function resetPinState() {
      state.input = "";
      state.attempts = 0;
      state.blocked = false;
      state.checking = false;
      if (state.blockTimer) {
        window.clearInterval(state.blockTimer);
        state.blockTimer = null;
      }
      updateDots();
      setMessage("");
    }

    async function verifyPin(pin) {
      var response = await fetch("/api/premium-users/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionConfirmCode: pin })
      });
      var data = {};
      try {
        data = await response.json();
      } catch (_) {
        data = {};
      }
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Bevestigingspin is onjuist of ontbreekt.");
      }
      return data;
    }

    function startTemporaryBlock() {
      state.blocked = true;
      var seconds = 30;
      setMessage("Geblokkeerd \u2014 wacht " + seconds + "s");
      state.blockTimer = window.setInterval(function () {
        seconds -= 1;
        if (seconds <= 0) {
          window.clearInterval(state.blockTimer);
          state.blockTimer = null;
          state.blocked = false;
          state.attempts = 0;
          setMessage("");
          return;
        }
        setMessage("Geblokkeerd \u2014 wacht " + seconds + "s");
      }, 1000);
    }

    function handleFailedAttempt() {
      state.checking = false;
      state.attempts += 1;
      updateDots("error");
      window.setTimeout(function () {
        state.input = "";
        updateDots();
      }, 450);
      if (state.attempts >= 5) {
        startTemporaryBlock();
      } else {
        setMessage("Onjuist \u2014 nog " + (5 - state.attempts) + " poging" + (5 - state.attempts !== 1 ? "en" : ""));
      }
    }

    async function runCheck() {
      if (state.checking) return;
      var attemptedPin = state.input;
      state.checking = true;
      setMessage("Controleren...");
      try {
        await verifyPin(attemptedPin);
        updateDots("success");
        window.setTimeout(function () {
          Promise.resolve(config.unlock && config.unlock())
            .then(function () {
              resetPinState();
            })
            .catch(function () {
              state.checking = false;
              setMessage("Laden mislukt");
            });
        }, 350);
      } catch (_) {
        handleFailedAttempt();
      }
    }

    function pressDigit(digit) {
      if (state.blocked || state.checking || state.input.length >= 6) return;
      state.input += String(digit == null ? "" : digit).slice(0, 1);
      updateDots();
      if (state.input.length === 6) window.setTimeout(runCheck, 120);
    }

    function backspace() {
      if (state.blocked || state.checking) return;
      state.input = state.input.slice(0, -1);
      updateDots();
    }

    function clear() {
      if (state.blocked || state.checking) return;
      state.input = "";
      updateDots();
      setMessage("");
    }

    function lock() {
      if (typeof config.onBeforeLock === "function") config.onBeforeLock();
      var registerScreen = getElement(config.registerScreen || "screen-register");
      var pinScreen = getElement(config.pinScreen || "screen-pin");
      if (registerScreen) registerScreen.style.display = "none";
      if (pinScreen) pinScreen.style.display = "flex";
      resetPinState();
    }

    function bindNumpad(numpadEl) {
      if (!numpadEl) return;
      numpadEl.addEventListener("click", function (event) {
        var target = event.target;
        var button = target && typeof target.closest === "function"
          ? target.closest("[data-pin-digit], [data-pin-action]")
          : null;
        if (!button) return;
        if (button.dataset.pinDigit != null) {
          pressDigit(button.dataset.pinDigit);
        } else if (button.dataset.pinAction === "clear") {
          clear();
        } else if (button.dataset.pinAction === "backspace") {
          backspace();
        }
      });
    }

    function bindKeyboard(target) {
      (target || document).addEventListener("keydown", function (event) {
        var pinScreen = getElement(config.pinScreen || "screen-pin");
        if (!pinScreen || pinScreen.style.display === "none") return;
        if (event.key >= "0" && event.key <= "9") pressDigit(event.key);
        if (event.key === "Backspace") backspace();
        if (event.key === "Escape") {
          event.preventDefault();
          clear();
        }
      });
    }

    return {
      backspace: backspace,
      bindKeyboard: bindKeyboard,
      bindNumpad: bindNumpad,
      clear: clear,
      lock: lock,
      pressDigit: pressDigit,
      reset: resetPinState
    };
  }

  global.SoftoraPasswordRegisterPin = {
    create: createPinController
  };
})(window);
