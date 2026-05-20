(function () {
  const overlayId = "coldmail-send-lock-overlay";
  const styleId = "coldmail-send-lock-style";
  const lockAttribute = "data-coldmail-send-lock";
  let coldmailSendLockActive = false;
  let sidebarWasInert = false;
  let sidebarAriaHidden = null;

  function ensureColdmailSendLockStyle() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
html[${lockAttribute}],
html[${lockAttribute}] body {
  overflow: hidden;
  cursor: wait;
}
html[${lockAttribute}] .sidebar {
  pointer-events: none !important;
  user-select: none !important;
}
.coldmail-send-lock-overlay {
  position: fixed;
  inset: 0;
  z-index: 22000;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 24px;
  pointer-events: auto;
  background: rgba(255,255,255,.68);
  backdrop-filter: blur(12px) saturate(1.05);
}
.coldmail-send-lock-overlay:not([hidden]) { display: flex; }
.coldmail-send-lock-card {
  width: min(420px, calc(100vw - 48px));
  padding: 30px 30px 28px;
  border: 1px solid rgba(155,35,85,.18);
  border-radius: 12px;
  background: rgba(255,255,255,.96);
  box-shadow: 0 28px 70px rgba(26,26,46,.13);
  text-align: center;
}
.coldmail-send-lock-spinner {
  width: 48px;
  height: 48px;
  margin: 0 auto 18px;
  border-radius: 50%;
  border: 2px solid rgba(155,35,85,.16);
  border-top-color: #9b2355;
  animation: coldmail-send-lock-spin .8s linear infinite;
}
.coldmail-send-lock-kicker {
  margin: 0 0 6px;
  font-family: 'Oswald', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 2.5px;
  text-transform: uppercase;
  color: #9b2355;
}
.coldmail-send-lock-title {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.15;
  color: #1a1a2e;
}
.coldmail-send-lock-copy {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
  color: #6b7280;
}
@keyframes coldmail-send-lock-spin {
  to { transform: rotate(360deg); }
}
`;
    document.head.appendChild(style);
  }

  function ensureColdmailSendLockOverlay() {
    let overlay = document.getElementById(overlayId);
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.className = "coldmail-send-lock-overlay";
    overlay.hidden = true;
    overlay.tabIndex = -1;
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.setAttribute("aria-label", "Mails worden verstuurd");
    overlay.innerHTML = [
      '<div class="coldmail-send-lock-card">',
      '  <div class="coldmail-send-lock-spinner" aria-hidden="true"></div>',
      '  <p class="coldmail-send-lock-kicker">Verzending loopt</p>',
      '  <h2 class="coldmail-send-lock-title">Mails worden verstuurd</h2>',
      '  <p class="coldmail-send-lock-copy">Blijf op deze pagina. Klikken is geblokkeerd tot de verzending klaar is.</p>',
      '</div>',
    ].join("");
    document.body.appendChild(overlay);
    return overlay;
  }

  function setColdmailSendLock(isLocked) {
    const locked = Boolean(isLocked);
    const wasLocked = coldmailSendLockActive;
    const overlay = ensureColdmailSendLockOverlay();
    const sidebar = document.querySelector(".sidebar");
    coldmailSendLockActive = locked;
    document.documentElement.toggleAttribute(lockAttribute, locked);

    overlay.hidden = !locked;
    overlay.setAttribute("aria-hidden", locked ? "false" : "true");

    if (sidebar) {
      if (locked && !wasLocked) {
        sidebarWasInert = sidebar.hasAttribute("inert");
        sidebarAriaHidden = sidebar.getAttribute("aria-hidden");
        sidebar.setAttribute("inert", "");
        sidebar.setAttribute("aria-hidden", "true");
      } else if (!locked && wasLocked) {
        if (!sidebarWasInert) sidebar.removeAttribute("inert");
        if (sidebarAriaHidden === null) sidebar.removeAttribute("aria-hidden");
        else sidebar.setAttribute("aria-hidden", sidebarAriaHidden);
        sidebarAriaHidden = null;
      }
    }

    if (locked) {
      if (document.activeElement && typeof document.activeElement.blur === "function") {
        document.activeElement.blur();
      }
      window.setTimeout(function () {
        try {
          overlay.focus({ preventScroll: true });
        } catch (error) {
          overlay.focus();
        }
      }, 0);
    }
  }

  function blockColdmailSendLockInteraction(event) {
    if (!coldmailSendLockActive) return;
    const overlay = document.getElementById(overlayId);
    if (overlay && overlay.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    if (event.type === "focusin" && overlay && typeof overlay.focus === "function") {
      try {
        overlay.focus({ preventScroll: true });
      } catch (error) {
        overlay.focus();
      }
    }
  }

  function wrapColdmailCampaignSender() {
    const originalSender = window.sendColdmailCampaignNow;
    if (typeof originalSender !== "function") return false;
    if (originalSender.__softoraColdmailSendFreezeWrapped) return true;
    window.sendColdmailCampaignNow = async function softoraColdmailSendFreezeWrapped() {
      setColdmailSendLock(true);
      try {
        return await originalSender.apply(this, arguments);
      } finally {
        setColdmailSendLock(false);
      }
    };
    window.sendColdmailCampaignNow.__softoraColdmailSendFreezeWrapped = true;
    return true;
  }

  [
    "click",
    "dblclick",
    "mousedown",
    "mouseup",
    "pointerdown",
    "pointerup",
    "touchstart",
    "touchend",
    "keydown",
    "focusin",
  ].forEach(function (eventName) {
    document.addEventListener(eventName, blockColdmailSendLockInteraction, true);
  });

  function initColdmailSendFreeze() {
    ensureColdmailSendLockStyle();
    ensureColdmailSendLockOverlay();
    wrapColdmailCampaignSender();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initColdmailSendFreeze, { once: true });
  } else {
    initColdmailSendFreeze();
  }

  window.SoftoraColdmailSendFreeze = {
    show: function () { setColdmailSendLock(true); },
    hide: function () { setColdmailSendLock(false); },
    wrap: wrapColdmailCampaignSender,
  };
})();
