(function () {
  "use strict";

  var PIN_LENGTH = 6;
  var VERIFY_URL = "/api/premium-users/verify-pin";
  var state = {
    overlay: null,
    buffer: "",
    pending: null,
    busy: false,
    options: {},
  };

  function injectStyles() {
    if (document.getElementById("secure-action-pin-styles")) return;
    var style = document.createElement("style");
    style.id = "secure-action-pin-styles";
    style.textContent = [
      ".secure-action-pin-overlay{position:fixed;inset:0;z-index:12000;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(25,27,39,.52);backdrop-filter:blur(2px)}",
      ".secure-action-pin-overlay.open{display:flex}",
      ".secure-action-pin-card,.secure-action-pin-card *{box-sizing:border-box}",
      ".secure-action-pin-card{position:relative;width:min(400px,100%);border:1px solid rgba(139,34,82,.16);border-radius:18px;background:#fff;color:#191b2f;box-shadow:0 18px 48px rgba(18,18,28,.22);padding:22px 22px 20px;overflow:hidden;text-align:center}",
      ".secure-action-pin-close{position:absolute;right:14px;top:12px;width:32px;height:32px;border:0;background:transparent;color:#6f7282;border-radius:9px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}",
      ".secure-action-pin-close svg{width:18px;height:18px}",
      ".secure-action-pin-close:hover{background:rgba(139,34,82,.06);color:#191b2f}",
      ".secure-action-pin-icon{width:38px;height:38px;margin:0 auto 12px;border:1px solid rgba(139,34,82,.16);border-radius:12px;background:rgba(139,34,82,.055);display:flex;align-items:center;justify-content:center;color:#9b2355}",
      ".secure-action-pin-icon svg{width:20px;height:20px;stroke-width:1.75}",
      ".secure-action-pin-kicker{margin:0 0 6px;font-family:Oswald,Inter,system-ui,sans-serif;font-size:.74rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#9b2355}",
      ".secure-action-pin-title{margin:0;color:#191b2f;font-family:Inter,system-ui,sans-serif;font-size:1.32rem;font-weight:800;line-height:1.15;letter-spacing:0}",
      ".secure-action-pin-desc{max-width:320px;margin:10px auto 16px;color:#686c7c;font-size:.88rem;line-height:1.45;font-weight:500}",
      ".secure-action-pin-slots{display:flex;justify-content:center;gap:7px;margin:0 auto 14px;flex-wrap:wrap}",
      ".secure-action-pin-slot{width:32px;height:32px;border-radius:50%;border:2px solid rgba(155,35,85,.18);background:#fbf8fa;color:#191b2f;display:flex;align-items:center;justify-content:center;font-family:Oswald,Inter,system-ui,sans-serif;font-size:.92rem;font-weight:800;font-variant-numeric:tabular-nums;box-shadow:inset 0 1px 0 rgba(255,255,255,.85);transition:transform .14s ease,border-color .14s ease,background .14s ease,box-shadow .14s ease}",
      ".secure-action-pin-slot.filled{border-color:#9b2355;background:#fff;box-shadow:0 0 0 3px rgba(155,35,85,.08)}",
      ".secure-action-pin-slot.error{border-color:#c0392b;background:rgba(192,57,43,.08);color:#c0392b;animation:secureActionPinShake .28s ease}",
      "@keyframes secureActionPinShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}",
      ".secure-action-pin-pad{width:min(228px,100%);margin:0 auto;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}",
      ".secure-action-pin-key{height:38px;border:1px solid rgba(25,27,47,.1);border-radius:9px;background:linear-gradient(180deg,#fff 0%,#fafafa 100%);color:#191b2f;cursor:pointer;font-family:Inter,system-ui,sans-serif;font-size:.98rem;font-weight:800;font-variant-numeric:tabular-nums;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 1px 2px rgba(0,0,0,.035);transition:transform .08s ease,border-color .14s ease,color .14s ease,box-shadow .14s ease}",
      ".secure-action-pin-key:hover{border-color:rgba(155,35,85,.28);color:#9b2355;box-shadow:0 6px 16px rgba(25,27,47,.07)}",
      ".secure-action-pin-key:active{transform:scale(.96)}",
      ".secure-action-pin-key svg{width:17px;height:17px}",
      ".secure-action-pin-message{min-height:1.25em;margin-top:10px;color:#c0392b;font-size:.76rem;font-weight:700}",
      ".secure-action-code-capture{position:fixed;left:-1000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0;background:transparent;color:transparent}",
      "@media(max-width:560px){.secure-action-pin-card{padding:20px 16px 18px}.secure-action-pin-close{right:10px;top:10px}.secure-action-pin-title{font-size:1.22rem}.secure-action-pin-desc{font-size:.86rem}.secure-action-pin-slot{width:30px;height:30px;font-size:.88rem}.secure-action-pin-key{height:38px}}",
    ].join("");
    document.head.appendChild(style);
  }

  function iconSvg(name) {
    if (name === "clear") {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
    }
    if (name === "back") {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  }

  function ensureOverlay() {
    if (state.overlay) return state.overlay;
    injectStyles();

    var overlay = document.createElement("div");
    overlay.className = "secure-action-pin-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "secure-action-pin-title");
    overlay.setAttribute("tabindex", "-1");
    overlay.setAttribute("data-1p-ignore", "true");
    overlay.setAttribute("data-lpignore", "true");
    overlay.setAttribute("data-bwignore", "true");
    overlay.setAttribute("data-form-type", "other");

    overlay.innerHTML = [
      '<div class="secure-action-pin-card" data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other">',
      '  <button type="button" class="secure-action-pin-close" data-secure-action-pin-close aria-label="Sluiten"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>',
      '  <div class="secure-action-pin-icon" aria-hidden="true">' + iconSvg("lock") + "</div>",
      '  <p class="secure-action-pin-kicker" data-secure-action-pin-kicker>Beveiligde actie</p>',
      '  <h2 class="secure-action-pin-title" id="secure-action-pin-title" data-secure-action-pin-title>Actie bevestigen</h2>',
      '  <p class="secure-action-pin-desc" data-secure-action-pin-desc>Typ de pincode om te voorkomen dat deze actie per ongeluk start.</p>',
      '  <input class="secure-action-code-capture" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Eenmalige bevestigingscode" tabindex="-1" name="softora_action_code" data-secure-action-code-capture data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other">',
      '  <div class="secure-action-pin-slots" role="status" aria-live="polite" aria-label="Voortgang pincode" data-secure-action-pin-slots></div>',
      '  <div class="secure-action-pin-pad" data-secure-action-pin-pad></div>',
      '  <div class="secure-action-pin-message" data-secure-action-pin-message></div>',
      "</div>",
    ].join("");

    document.body.appendChild(overlay);
    state.overlay = overlay;
    buildSlots();
    buildPad();
    bindOverlay();
    return overlay;
  }

  function buildSlots() {
    var host = state.overlay.querySelector("[data-secure-action-pin-slots]");
    if (!host || host.children.length) return;
    for (var i = 0; i < PIN_LENGTH; i += 1) {
      var slot = document.createElement("div");
      slot.className = "secure-action-pin-slot";
      slot.setAttribute("data-secure-action-pin-slot", String(i));
      host.appendChild(slot);
    }
  }

  function addKey(label, action, ariaLabel) {
    var host = state.overlay.querySelector("[data-secure-action-pin-pad]");
    var button = document.createElement("button");
    button.type = "button";
    button.className = "secure-action-pin-key";
    button.setAttribute("data-secure-action-pin-" + action, label);
    if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
    if (label.indexOf("<") !== -1) button.innerHTML = label;
    else button.textContent = label;
    host.appendChild(button);
  }

  function buildPad() {
    var host = state.overlay.querySelector("[data-secure-action-pin-pad]");
    if (!host || host.children.length) return;
    ["1", "2", "3", "4", "5", "6", "7", "8", "9"].forEach(function (digit) {
      addKey(digit, "digit");
    });
    addKey(iconSvg("clear"), "clear", "Volledige pincode wissen");
    addKey("0", "digit");
    addKey(iconSvg("back"), "back", "Laatste cijfer wissen");
  }

  function setText(selector, value) {
    var el = state.overlay.querySelector(selector);
    if (el) el.textContent = value;
  }

  function setMessage(message) {
    setText("[data-secure-action-pin-message]", message || "");
  }

  function getCaptureInput() {
    return state.overlay ? state.overlay.querySelector("[data-secure-action-code-capture]") : null;
  }

  function syncCaptureInput() {
    var input = getCaptureInput();
    if (input && input.value !== state.buffer) input.value = state.buffer;
  }

  function focusCaptureInput() {
    var input = getCaptureInput();
    if (!input) return;
    try {
      input.focus({ preventScroll: true });
    } catch (error) {
      input.focus();
    }
  }

  function paintSlots(mode) {
    var slots = state.overlay.querySelectorAll("[data-secure-action-pin-slot]");
    slots.forEach(function (slot, index) {
      var digit = state.buffer[index] || "";
      slot.textContent = digit;
      slot.classList.toggle("filled", Boolean(digit));
      slot.classList.toggle("error", mode === "error");
    });
  }

  function flashError(message) {
    setMessage(message || "Pincode klopt niet.");
    paintSlots("error");
    window.setTimeout(function () {
      paintSlots();
    }, 320);
  }

  function appendDigit(digit) {
    if (!state.pending || state.busy || state.buffer.length >= PIN_LENGTH) return;
    state.buffer += String(digit || "").replace(/\D+/g, "").slice(0, 1);
    setMessage("");
    syncCaptureInput();
    paintSlots();
    if (state.buffer.length === PIN_LENGTH) {
      window.setTimeout(confirmPin, 120);
    }
  }

  function backspace() {
    if (!state.pending || state.busy) return;
    state.buffer = state.buffer.slice(0, -1);
    setMessage("");
    syncCaptureInput();
    paintSlots();
  }

  function clear() {
    if (!state.pending || state.busy) return;
    state.buffer = "";
    setMessage("");
    syncCaptureInput();
    paintSlots();
  }

  function closeWithCancel() {
    if (!state.pending) return;
    var pending = state.pending;
    closeOverlay();
    pending.reject(new Error("Geannuleerd"));
  }

  function closeOverlay() {
    if (state.overlay) state.overlay.classList.remove("open");
    state.buffer = "";
    state.busy = false;
    state.options = {};
    state.pending = null;
    setMessage("");
    syncCaptureInput();
    paintSlots();
  }

  async function verifyPin(pin) {
    var verifyUrl = state.options.verifyUrl === undefined ? VERIFY_URL : state.options.verifyUrl;
    if (!verifyUrl) return true;
    var response = await fetch(verifyUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ actionConfirmCode: pin }),
    });
    var payload = await response.json().catch(function () { return null; });
    if (!response.ok || !payload || payload.ok === false) {
      throw new Error((payload && (payload.error || payload.message)) || "Pincode klopt niet.");
    }
    return true;
  }

  async function confirmPin() {
    if (!state.pending || state.busy) return;
    var pin = String(state.buffer || "").trim();
    if (pin.length !== PIN_LENGTH) {
      flashError("Vul alle zes cijfers in.");
      return;
    }
    state.busy = true;
    setMessage("Pincode controleren...");
    try {
      await verifyPin(pin);
      var pending = state.pending;
      closeOverlay();
      pending.resolve(pin);
    } catch (error) {
      state.busy = false;
      state.buffer = "";
      syncCaptureInput();
      flashError(String((error && error.message) || "Pincode klopt niet."));
    }
  }

  function bindOverlay() {
    state.overlay.addEventListener("input", function (event) {
      if (!event.target.matches("[data-secure-action-code-capture]")) return;
      if (!state.pending || state.busy) {
        syncCaptureInput();
        return;
      }
      state.buffer = String(event.target.value || "").replace(/\D+/g, "").slice(0, PIN_LENGTH);
      setMessage("");
      syncCaptureInput();
      paintSlots();
      if (state.buffer.length === PIN_LENGTH) {
        window.setTimeout(confirmPin, 120);
      }
    });

    state.overlay.addEventListener("click", function (event) {
      if (event.target === state.overlay) {
        closeWithCancel();
        return;
      }
      focusCaptureInput();
      var digitButton = event.target.closest("[data-secure-action-pin-digit]");
      if (digitButton && state.overlay.contains(digitButton)) {
        appendDigit(digitButton.getAttribute("data-secure-action-pin-digit"));
        return;
      }
      if (event.target.closest("[data-secure-action-pin-clear]")) {
        clear();
        return;
      }
      if (event.target.closest("[data-secure-action-pin-back]")) {
        backspace();
        return;
      }
      if (event.target.closest("[data-secure-action-pin-close]")) {
        closeWithCancel();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (!state.overlay || !state.overlay.classList.contains("open")) return;
      if (event.key >= "0" && event.key <= "9") {
        event.preventDefault();
        appendDigit(event.key);
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        backspace();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeWithCancel();
      }
    });
  }

  function request(options) {
    ensureOverlay();
    if (state.pending) {
      return Promise.reject(new Error("Er staat al een bevestiging open."));
    }
    state.options = options || {};
    state.buffer = "";
    state.busy = false;
    setText("[data-secure-action-pin-kicker]", state.options.kicker || "Beveiligde actie");
    setText("[data-secure-action-pin-title]", state.options.title || "Actie bevestigen");
    setText(
      "[data-secure-action-pin-desc]",
      state.options.description || "Typ de pincode om te voorkomen dat deze actie per ongeluk start."
    );
    setMessage("");
    paintSlots();
    state.overlay.classList.add("open");
    state.overlay.focus();
    syncCaptureInput();
    focusCaptureInput();
    return new Promise(function (resolve, reject) {
      state.pending = { resolve: resolve, reject: reject };
    });
  }

  function isLeadGeneratorAlias() {
    var path = String(window.location && window.location.pathname || "").toLowerCase();
    return document.documentElement.getAttribute("data-softora-lead-generator-alias") === "1" ||
      path.indexOf("/premium-ai-lead-generator") !== -1;
  }

  function confirmMailSend() {
    return request({
      kicker: "Beveiligde actie",
      title: "Mails versturen bevestigen",
      description: "Typ de pincode om te voorkomen dat deze actie per ongeluk start.",
    });
  }

  function showGuardError(error) {
    if (error && error.message === "Geannuleerd") return;
    var message = String((error && error.message) || "Pincode controleren is mislukt.");
    if (typeof window.showToast === "function") window.showToast(message);
  }

  function bindMailSendGuard() {
    if (window.__softoraSecureMailSendGuardBound) return;
    window.__softoraSecureMailSendGuardBound = true;
    document.documentElement.setAttribute("data-secure-action-pin-ready", "true");
    document.addEventListener("click", async function (event) {
      var trigger = event.target.closest("[data-secure-mail-send-pin]");
      if (!trigger || isLeadGeneratorAlias()) return;
      if (trigger.getAttribute("data-secure-mail-send-pin-skip") === "1") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      try {
        await confirmMailSend();
      } catch (error) {
        showGuardError(error);
        return;
      }
      trigger.setAttribute("data-secure-mail-send-pin-skip", "1");
      try {
        if (typeof window.startCampagne === "function") {
          await window.startCampagne();
        } else {
          trigger.click();
        }
      } finally {
        trigger.removeAttribute("data-secure-mail-send-pin-skip");
      }
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindMailSendGuard, { once: true });
  } else {
    bindMailSendGuard();
  }

  window.SoftoraSecureActionPin = {
    request: request,
    confirmMailSend: confirmMailSend,
  };
})();
