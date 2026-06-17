(function () {
  const snapshotNode = document.getElementById("kvkSnapshot");
  const numberFormat = new Intl.NumberFormat("nl-NL");
  let snapshot = null;
  let activeBucket = "treated";
  let query = "";

  function parseSnapshot() {
    if (!snapshotNode) return null;
    try {
      return JSON.parse(snapshotNode.textContent || "{}");
    } catch (_) {
      return null;
    }
  }

  function text(value) {
    return String(value == null ? "" : value);
  }

  function escapeHtml(value) {
    return text(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalize(value) {
    return text(value).toLocaleLowerCase("nl-NL");
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function formatNumber(value) {
    return numberFormat.format(Number(value || 0));
  }

  function rowsForBucket(rows) {
    if (activeBucket === "usable") return rows.filter((row) => row.lead_status === "usable");
    if (activeBucket === "withWebsite") {
      return rows.filter((row) => row.lead_status === "usable" && row.website_status === "found" && text(row.website).trim());
    }
    if (activeBucket === "withoutWebsite") {
      return rows.filter((row) => row.lead_status === "usable" && ["no_website", "not_working"].includes(row.website_status));
    }
    if (activeBucket === "unusable") return rows.filter((row) => row.lead_status === "unusable");
    return rows;
  }

  function matchesQuery(row) {
    if (!query) return true;
    const haystack = [
      row.bedrijfsnaam,
      row.kvk_nummer,
      row.vestigingsnummer,
      row.lead_status,
      row.unusable_reason,
      row.telefoonnummer,
      row.email,
      row.website,
      row.plaats,
      row.gemeente,
      row.provincie,
      row.contact_research_note,
    ].map(normalize).join(" ");
    return haystack.includes(query);
  }

  function renderStats() {
    const stats = snapshot.stats || {};
    setText("stat-total", formatNumber(stats.companies_found));
    setText("stat-treated", formatNumber(stats.treated));
    setText("stat-usable", formatNumber(stats.usable));
    setText("stat-with-website", formatNumber(stats.with_website));
    setText("stat-without-website", formatNumber(stats.without_website));
    setText("stat-unusable", formatNumber(stats.unusable));
    setText("snapshot-time", snapshot.generated_label || "snapshot");
  }

  function renderPlanning() {
    const location = snapshot.location || {};
    const progress = Number(location.progress_percent || 0);
    const bar = document.getElementById("location-progress-bar");
    if (bar) bar.style.setProperty("--progress", `${Math.max(0, Math.min(100, progress))}%`);
    setText("location-progress-label", `${progress.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`);

    const list = document.getElementById("location-list");
    if (!list) return;
    const nextRows = Array.isArray(snapshot.next_rows) ? snapshot.next_rows : [];
    const main = `
      <li class="location-item">
        <span class="rank">636</span>
        <span>
          <span class="location-main">Nederland | Utrecht | Amersfoort | Amersfoort</span>
          <span class="location-sub">Hierna in de originele planning. Haaren is nu actief voor contactonderzoek.</span>
        </span>
        <span class="badge is-waiting">${formatNumber(163298)} inwoners</span>
      </li>
      <li class="location-item">
        <span class="rank">198</span>
        <span>
          <span class="location-main">Nederland | Noord-Brabant | Oisterwijk | Haaren</span>
          <span class="location-sub">${formatNumber(location.treated)} behandeld van ${formatNumber(location.total)} actieve bedrijven. Nog ${formatNumber(location.open)} open.</span>
        </span>
        <span class="badge">${formatNumber(location.with_website)} met website</span>
        <span class="badge is-waiting">${formatNumber(location.unusable)} onbruikbaar</span>
      </li>
    `;
    const next = nextRows.map((row, index) => `
      <li class="location-item">
        <span class="rank">${index + 1}</span>
        <span>
          <span class="location-main">${escapeHtml(row.bedrijfsnaam)}</span>
          <span class="location-sub">${escapeHtml(row.kvk_nummer)} | ${escapeHtml(row.adres)} | volgende Haaren batch</span>
        </span>
        <span class="badge is-waiting">open</span>
      </li>
    `).join("");
    list.innerHTML = main + next;
  }

  function statusLabel(row) {
    if (row.lead_status === "usable") return "Bruikbaar";
    return row.unusable_reason ? `Onbruikbaar: ${row.unusable_reason}` : "Onbruikbaar";
  }

  function displayValue(value, fallback) {
    const cleaned = text(value).trim();
    return cleaned ? escapeHtml(cleaned) : `<span class="muted">${escapeHtml(fallback || "Niet gevonden")}</span>`;
  }

  function websiteCell(value) {
    const cleaned = text(value).trim();
    if (!cleaned) return '<span class="muted">Niet gevonden</span>';
    return `<a href="${escapeHtml(cleaned)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cleaned.replace(/^https?:\/\//, ""))}</a>`;
  }

  function renderRows() {
    const body = document.getElementById("kvk-table-body");
    const count = document.getElementById("result-count");
    if (!body) return;

    const rows = rowsForBucket(snapshot.rows || []).filter(matchesQuery);
    if (count) count.textContent = `${formatNumber(rows.length)} resultaten`;

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty">Geen bedrijven gevonden.</td></tr>';
      return;
    }

    body.innerHTML = rows.map((row) => {
      const usable = row.lead_status === "usable";
      return `
        <tr>
          <td><strong>${escapeHtml(row.bedrijfsnaam)}</strong></td>
          <td>${escapeHtml(row.kvk_nummer)}</td>
          <td><span class="status-pill ${usable ? "is-usable" : "is-unusable"}">${escapeHtml(statusLabel(row))}</span></td>
          <td>${displayValue(row.telefoonnummer)}</td>
          <td>${displayValue(row.email)}</td>
          <td>${websiteCell(row.website)}</td>
          <td>${escapeHtml([row.plaats, row.gemeente, row.provincie].filter(Boolean).join(", "))}</td>
          <td class="note">${displayValue(row.contact_research_note, "Geen notitie")}</td>
        </tr>
      `;
    }).join("");
  }

  function bindEvents() {
    document.querySelectorAll("[data-bucket]").forEach((button) => {
      button.addEventListener("click", () => {
        activeBucket = button.getAttribute("data-bucket") || "treated";
        document.querySelectorAll("[data-bucket]").forEach((item) => {
          item.classList.toggle("is-active", item === button);
        });
        renderRows();
      });
    });

    const input = document.getElementById("kvk-search");
    if (input) {
      input.addEventListener("input", () => {
        query = normalize(input.value).trim();
        renderRows();
      });
    }
  }

  snapshot = parseSnapshot();
  if (!snapshot) {
    document.body.innerHTML = '<main class="kvk-shell"><div class="panel"><p class="empty">Snapshot kon niet geladen worden.</p></div></main>';
    return;
  }

  renderStats();
  renderPlanning();
  bindEvents();
  renderRows();
})();
