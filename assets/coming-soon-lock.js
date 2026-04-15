(function () {
  var path = String(window.location.pathname || "").toLowerCase();
  var unlockCode = "Andre2Fritz2!";
  var storageKey = "softora_coming_soon_unlock_v1";
  var lockedPaths = new Set([
    "/premium-bedrijfssoftware",
    "/premium-voicesoftware",
    "/premium-websites",
    "/premium-blog",
    "/premium-over-softora",
    "/premium-bevestigingsmails",
    "/premium-websitegenerator",
    "/premium-seo",
    "/premium-boekhouding"
  ]);

  if (!lockedPaths.has(path)) return;
  if (sessionStorage.getItem(storageKey) === unlockCode) return;
  if (document.querySelector(".coming-soon-lock-overlay")) return;

  document.body.classList.add("coming-soon-lock-active");

  var overlay = document.createElement("div");
  overlay.className = "coming-soon-lock-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Coming soon melding");

  function closeOverlay() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.body.classList.remove("coming-soon-lock-active");
  }

  function tryUnlock() {
    var input = window.prompt("Voer toegangscode in om deze pagina te bekijken:");
    if (input === null) return;
    if (String(input).trim() === unlockCode) {
      try {
        sessionStorage.setItem(storageKey, unlockCode);
      } catch (_) {
        /* ignore storage errors */
      }
      closeOverlay();
      return;
    }
    window.alert("Onjuiste code.");
  }

  overlay.innerHTML = [
    '<div class="coming-soon-lock-card">',
    '  <div class="coming-soon-lock-icon" aria-hidden="true">',
    '    <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.8" style="color:#f5f7ff">',
    '      <rect x="4" y="11" width="16" height="10" rx="2"></rect>',
    '      <path d="M8 11V8a4 4 0 1 1 8 0v3"></path>',
    "    </svg>",
    "  </div>",
    '  <h1 class="coming-soon-lock-title">Coming Soon</h1>',
    '  <p class="coming-soon-lock-subtitle">Deze pagina staat tijdelijk op slot terwijl we hem afronden. Binnenkort live met een volledige premium ervaring.</p>',
    '  <div class="coming-soon-lock-actions">',
    '    <a class="coming-soon-lock-btn coming-soon-lock-btn-primary" href="/">Terug naar home</a>',
    '    <button type="button" class="coming-soon-lock-btn coming-soon-lock-btn-secondary" data-unlock-soon>Ontgrendelen</button>',
    "  </div>",
    "</div>"
  ].join("");

  document.body.appendChild(overlay);
  var unlockBtn = overlay.querySelector("[data-unlock-soon]");
  if (unlockBtn) unlockBtn.addEventListener("click", tryUnlock);
})();
