(function (global) {
  "use strict";

  function clearValue(element) {
    if (!element) return;
    element.value = "";
    if (typeof element.removeAttribute === "function") {
      element.removeAttribute("aria-invalid");
    }
  }

  function wipeEntries(entries) {
    (Array.isArray(entries) ? entries : []).forEach(function (entry) {
      if (!entry || typeof entry !== "object") return;
      Object.keys(entry).forEach(function (key) {
        entry[key] = "";
      });
    });
  }

  function clearSensitiveUi(options) {
    var config = options || {};
    (Array.isArray(config.inputs) ? config.inputs : []).forEach(clearValue);

    if (config.entryForm && typeof config.entryForm.reset === "function") {
      config.entryForm.reset();
    }
    if (config.passwordInput) {
      config.passwordInput.type = "password";
      clearValue(config.passwordInput);
    }
    if (config.passwordToggle) {
      config.passwordToggle.textContent = "Tonen";
      config.passwordToggle.setAttribute("aria-pressed", "false");
      config.passwordToggle.setAttribute("aria-label", "Wachtwoord tonen");
    }
    if (config.deleteModalText) {
      config.deleteModalText.textContent = "";
    }
    if (config.status) {
      config.status.textContent = "";
    }
    if (config.toast) {
      config.toast.textContent = "";
      if (config.toast.classList) config.toast.classList.remove("show");
    }
    if (config.list && typeof config.list.replaceChildren === "function") {
      var lockedState = config.createLockedState
        ? config.createLockedState("Kluis vergrendeld.")
        : null;
      config.list.replaceChildren.apply(config.list, lockedState ? [lockedState] : []);
    }
  }

  global.SoftoraPasswordRegisterSecurity = {
    clearSensitiveUi: clearSensitiveUi,
    wipeEntries: wipeEntries
  };
})(window);
