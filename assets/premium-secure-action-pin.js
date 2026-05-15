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
      ".secure-action-pin-overlay{position:fixed;inset:0;z-index:12000;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(25,27,39,.68);backdrop-filter:blur(3px)}",
      ".secure-action-pin-overlay.open{display:flex}",
      ".secure-action-pin-card{position:relative;width:min(640px,100%);border:1px solid rgba(139,34,82,.18);border-radius:22px;background:#fff;color:#191b2f;box-shadow:0 28px 80px rgba(18,18,28,.28);padding:40px 40px 32px;overflow:hidden;text-align:center}",
      ".secure-action-pin-close{position:absolute;right:24px;top:22px;width:40px;height:40px;border:0;background:transparent;color:#6f7282;border-radius:10px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}",
      ".secure-action-pin-close svg{width:22px;height:22px}",
      ".secure-action-pin-close:hover{background:rgba(139,34,82,.06);color:#191b2f}",
      ".secure-action-pin-icon{width:74px;height:74px;margin:0 auto 26px;border:1px solid rgba(139,34,82,.18);border-radius:22px;background:linear-gradient(145deg,rgba(139,34,82,.1),rgba(139,34,82,.035));display:flex;align-items:center;justify-content:center;color:#9b2355}",
      ".secure-action-pin-icon svg{width:34px;height:34px;stroke-width:1.8}",
      ".secure-action-pin-kicker{margin:0 0 8px;font-family:Oswald,Inter,system-ui,sans-serif;font-size:1rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#9b2355}",
      ".secure-action-pin-title{margin:0;color:#191b2f;font-family:Inter,system-ui,sans-serif;font-size:clamp(1.8rem,4vw,2.4rem);font-weight:800;line-height:1.08;letter-spacing:0}",
      ".secure-action-pin-desc{max-width:480px;margin:18px auto 28px;color:#686c7c;font-size:1.25rem;line-height:1.45;font-weight:500}",
      ".secure-action-pin-slots{display:flex;justify-content:center;gap:12px;margin:0 auto 24px;flex-wrap:wrap}",
      ".secure-action-pin-slot{width:52px;height:52px;border-radius:50%;border:2px solid rgba(155,35,85,.2);background:#fbf8fa;color:#191b2f;display:flex;align-items:center;justify-content:center;font-family:Oswald,Inter,system-ui,sans-serif;font-size:1.45rem;font-weight:800;font-variant-numeric:tabular-nums;box-shadow:inset 0 1px 0 rgba(255,255,255,.85);transition:transform .14s ease,border-color .14s ease,background .14s ease,box-shadow .14s ease}",
      ".secure-action-pin-slot.filled{border-color:#9b2355;background:#fff;box-shadow:0 0 0 4px rgba(155,35,85,.1)}",
      ".secure-action-pin-slot.error{border-color:#c0392b;background:rgba(192,57,43,.08);color:#c0392b;animation:secureActionPinShake .28s ease}",
      "@keyframes secureActionPinShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}",
      ".secure-action-pin-pad{width:min(310px,100%);margin:0 auto;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}",
      ".secure-action-pin-key{height:56px;border:1px solid rgba(25,27,47,.1);border-radius:14px;background:linear-gradient(180deg,#fff 0%,#fafafa 100%);color:#191b2f;cursor:pointer;font-family:Inter,system-ui,sans-serif;font-size:1.35rem;font-weight:800;font-variant-numeric:tabular-nums;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 1px 2px rgba(0,0,0,.04);transition:transform .08s ease,border-color .14s ease,color .14s ease,box-shadow .14s ease}",
      ".secure-action-pin-key:hover{border-color:rgba(155,35,85,.3);color:#9b2355;box-shadow:0 8px 22px rgba(25,27,47,.08)}",
      ".secure-action-pin-key:active{transform:scale(.96)}",
      ".secure-action-pin-key svg{width:20px;height:20px}",
      ".secure-action-pin-message{min-height:1.3em;margin-top:14px;color:#c0392b;font-size:.86rem;font-weight:700}",
      "@media(max-width:560px){.secure-action-pin-card{padding:34px 20px 24px}.secure-action-pin-close{right:14px;top:14px}.secure-action-pin-desc{font-size:1rem}.secure-action-pin-slot{width:44px;height:44px;font-size:1.2rem}.secure-action-pin-key{height:50px}}",
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

    overlay.innerHTML = [
      '<div class="secure-action-pin-card">',
      '  <button type="button" class="secure-action-pin-close" data-secure-action-pin-close aria-label="Sluiten"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>',
      '  <div class="secure-action-pin-icon" aria-hidden="true">' + iconSvg("lock") + "</div>",
      '  <p class="secure-action-pin-kicker" data-secure-action-pin-kicker>Beveiligde actie</p>',
      '  <h2 class="secure-action-pin-title" id="secure-action-pin-title" data-secure-action-pin-title>Actie bevestigen</h2>',
      '  <p class="secure-action-pin-desc" data-secure-action-pin-desc>Typ de pincode om te voorkomen dat deze actie per ongeluk start.</p>',
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
    paintSlots();
    if (state.buffer.length === PIN_LENGTH) {
      window.setTimeout(confirmPin, 120);
    }
  }

  function backspace() {
    if (!state.pending || state.busy) return;
    state.buffer = state.buffer.slice(0, -1);
    setMessage("");
    paintSlots();
  }

  function clear() {
    if (!state.pending || state.busy) return;
    state.buffer = "";
    setMessage("");
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
      body: JSON.stringify({ actionConfirmPin: pin }),
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
      flashError(String((error && error.message) || "Pincode klopt niet."));
    }
  }

  function bindOverlay() {
    state.overlay.addEventListener("click", function (event) {
      if (event.target === state.overlay) closeWithCancel();
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
