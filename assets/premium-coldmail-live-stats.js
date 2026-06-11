(function (global) {
  "use strict";

  const STATS_URL = "/api/coldmailing/stats";
  const STATS_EVENT = "softora:coldmail-live-stats";
  const STYLE_ID = "coldmailLiveStatsStyle";
  const REFRESH_MS = 15000;
  let lastStats = null;
  let refreshPromise = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function getStatsRoot() {
    return byId("coldmailLiveStats");
  }

  function injectStyles() {
    if (byId(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.coldmail-live-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 0 0 16px;
}
.coldmail-live-stat {
  min-width: 0;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  box-shadow: 0 8px 24px rgba(26,26,46,.04);
}
.coldmail-live-stat span {
  display: block;
  margin-bottom: 8px;
  color: var(--light);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
}
.coldmail-live-stat strong {
  display: block;
  color: var(--dark);
  font-family: 'Oswald', sans-serif;
  font-size: 1.42rem;
  font-weight: 700;
  line-height: 1.1;
  word-break: break-word;
}
.coldmail-live-stat small {
  display: block;
  margin-top: 6px;
  color: var(--mid);
  font-size: 0.78rem;
  line-height: 1.35;
}
html[data-coldmail-live-stats="unavailable"] .coldmail-live-stat strong {
  color: var(--mid);
}
@media (max-width: 1024px) {
  .coldmail-live-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .coldmail-live-stats { grid-template-columns: 1fr; }
}
`.trim();
    document.head.appendChild(style);
  }

  function injectMarkup() {
    if (getStatsRoot()) return true;
    const topbar = document.querySelector("#screen-dashboard .topbar");
    if (!topbar || !topbar.parentNode) return false;
    const root = document.createElement("div");
    root.className = "coldmail-live-stats";
    root.id = "coldmailLiveStats";
    root.setAttribute("data-coldmail-live-stats", "loading");
    root.setAttribute("aria-live", "polite");
    root.innerHTML = `
    <div class="coldmail-live-stat">
      <span>Vandaag verstuurd</span>
      <strong id="coldmailLiveSentToday">0</strong>
      <small id="coldmailLiveSentTodayNote">Europe/Amsterdam</small>
    </div>
    <div class="coldmail-live-stat">
      <span>Laatste 24 uur</span>
      <strong id="coldmailLiveSentLast24h">0</strong>
      <small>Geslaagde SMTP-verzendingen</small>
    </div>
    <div class="coldmail-live-stat">
      <span>Totaal Softora/Gmail</span>
      <strong id="coldmailLiveSentTotal">0</strong>
      <small id="coldmailLiveSentTotalNote">Instantly niet meegeteld</small>
    </div>
    <div class="coldmail-live-stat">
      <span>Laatst succesvol</span>
      <strong id="coldmailLiveLastSentAt">Nog geen mail</strong>
      <small id="coldmailLiveLastSender">Geen afzender</small>
    </div>`.trim();
    topbar.insertAdjacentElement("afterend", root);
    return true;
  }

  function setText(id, value) {
    const element = byId(id);
    if (element) element.textContent = String(value == null ? "" : value);
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }

  function formatNumber(value) {
    return number(value).toLocaleString("nl-NL");
  }

  function readTotalSent(stats) {
    if (!stats || typeof stats !== "object") return 0;
    return number(stats.systemTotalSent || stats.totalSent || stats.databaseTotalSent);
  }

  function formatLastSentAt(value, timezone) {
    const parsed = new Date(String(value || ""));
    if (!Number.isFinite(parsed.getTime())) return "Nog geen mail";
    try {
      return new Intl.DateTimeFormat("nl-NL", {
        timeZone: timezone || "Europe/Amsterdam",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(parsed);
    } catch (_) {
      return parsed.toLocaleString("nl-NL");
    }
  }

  function notify(stats) {
    if (typeof global.dispatchEvent !== "function") return;
    try {
      global.dispatchEvent(new CustomEvent(STATS_EVENT, {
        detail: { stats: stats || {} },
      }));
    } catch (_) {}
  }

  function setAvailability(value) {
    document.documentElement.setAttribute("data-coldmail-live-stats", value);
    const root = getStatsRoot();
    if (root) root.setAttribute("data-coldmail-live-stats", value);
  }

  function render(stats) {
    lastStats = stats && typeof stats === "object" ? stats : {};
    setAvailability("ready");
    setText("coldmailLiveSentToday", formatNumber(lastStats.sentToday));
    setText("coldmailLiveSentLast24h", formatNumber(lastStats.sentLast24h));
    setText("coldmailLiveSentTotal", formatNumber(readTotalSent(lastStats)));
    setText("coldmailLiveLastSentAt", formatLastSentAt(lastStats.lastSuccessfulSendAt, lastStats.timezone));
    setText("coldmailLiveLastSender", lastStats.lastSenderEmail || "Geen afzender");
    setText("coldmailLiveSentTodayNote", lastStats.dateKey || "Europe/Amsterdam");
    setText(
      "coldmailLiveSentTotalNote",
      "Interesse " + formatNumber(lastStats.interestedTotal) + " - conversie " + formatNumber(lastStats.conversionRate) + "%"
    );
    notify(lastStats);
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = fetch(STATS_URL, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then((response) => response.json().then((payload) => ({ response, payload })).catch(() => ({ response, payload: null })))
      .then(({ response, payload }) => {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error(payload && (payload.message || payload.error) || "Coldmail statistieken laden mislukt.");
        }
        render(payload.stats || {});
        return lastStats;
      })
      .catch((error) => {
        setAvailability(lastStats ? "stale" : "unavailable");
        notify(lastStats || {});
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          console.warn("Coldmail statistieken laden mislukt:", error && error.message ? error.message : error);
        }
        return lastStats;
      })
      .finally(() => {
        refreshPromise = null;
      });
    return refreshPromise;
  }

  function init() {
    injectStyles();
    if (!injectMarkup()) return;
    void refresh();
    global.setInterval(refresh, REFRESH_MS);
    global.addEventListener("focus", refresh);
    global.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) void refresh();
    });
  }

  global.SoftoraColdmailLiveStats = {
    refresh,
    getStats: function () {
      return lastStats;
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
