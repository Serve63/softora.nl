(function () {
  "use strict";

  const DATA_URL = "/assets/premium-location-harvest-live.json";
  const REFRESH_MS = 5000;
  const state = {
    payload: null,
    query: ""
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeSearch(value) {
    return normalizeText(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function escapeHtml(value) {
    return normalizeText(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeWebsiteHref(value) {
    const raw = normalizeText(value);
    if (!raw) return "";
    const candidate = /^https?:\/\//i.test(raw) ? raw : "https://" + raw.replace(/^\/+/, "");
    try {
      const url = new URL(candidate);
      if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) return "";
      return url.href;
    } catch (error) {
      return "";
    }
  }

  function formatWebsiteLabel(value) {
    const raw = normalizeText(value);
    if (!raw) return "";
    return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  }

  function formatDateTime(value) {
    const raw = normalizeText(value);
    if (!raw) return "Nog niet bijgewerkt";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return new Intl.DateTimeFormat("nl-NL", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function formatPopulation(target) {
    const number = Number(target && target.population);
    if (!Number.isFinite(number) || number <= 0) return "";
    return (target && target.populationEstimated ? "ca. " : "")
      + new Intl.NumberFormat("nl-NL").format(Math.round(number))
      + " inwoners";
  }

  function statusLabel(status) {
    const normalized = normalizeText(status).toLowerCase();
    if (normalized === "done") return "";
    if (normalized === "previously_done") return "";
    if (normalized === "active") return "Bezig";
    if (normalized === "skipped") return "Overgeslagen";
    return "";
  }

  function statusClass(status) {
    const normalized = normalizeText(status).toLowerCase();
    if (normalized === "done" || normalized === "previously_done") return "previous";
    if (["done", "active", "skipped"].includes(normalized)) return normalized;
    return "todo";
  }

  function splitLocation(label) {
    const parts = normalizeText(label).split("|").map(function (part) { return part.trim(); }).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : normalizeText(label);
  }

  function getTargets(payload) {
    return Array.isArray(payload && payload.targets) ? payload.targets : [];
  }

  function getCompanies(payload) {
    return Array.isArray(payload && payload.companies) ? payload.companies : [];
  }

  function isCompleteCompany(company) {
    return Boolean(
      normalizeText(company && company.companyName)
      && normalizeText(company && company.phone)
      && normalizeText(company && company.email)
      && normalizeText(company && company.location)
    );
  }

  function hasWebsite(company) {
    return Boolean(normalizeText(company && company.website));
  }

  function looksInactive(company) {
    const text = normalizeSearch([
      company && company.companyName,
      company && company.location,
      company && company.sourcePlace,
      company && company.contactStatus,
      company && company.contactError,
      company && company.sourceUrl
    ].join(" "));
    return /in liquidatie|failliet|faillissement|uitgeschreven|opgeheven|beeindigd|beindigd|ontbonden|gestaakt|surseance/.test(text);
  }

  function countCompleteCompanies(payload) {
    return getCompanies(payload).filter(isCompleteCompany).length;
  }

  function countCompaniesWithWebsite(payload) {
    return getCompanies(payload).filter(function (company) {
      return isCompleteCompany(company) && hasWebsite(company) && !looksInactive(company);
    }).length;
  }

  function countActiveCompaniesWithoutWebsite(payload) {
    return getCompanies(payload).filter(function (company) {
      return isCompleteCompany(company) && !hasWebsite(company) && !looksInactive(company);
    }).length;
  }

  function getActiveTarget(payload) {
    const targets = getTargets(payload);
    return targets.find(function (target) { return normalizeText(target.status).toLowerCase() === "active"; })
      || targets.find(function (target) { return normalizeText(target.status).toLowerCase() === "todo"; })
      || null;
  }

  function renderStats(payload) {
    const targets = getTargets(payload);
    const done = targets.filter(function (target) { return target.status === "done" || target.status === "previously_done"; }).length;
    const skipped = targets.filter(function (target) { return target.status === "skipped"; }).length;
    const active = targets.filter(function (target) { return target.status === "active"; }).length;
    const activeTarget = getActiveTarget(payload);
    const withWebsite = countCompaniesWithWebsite(payload);
    const withoutWebsite = countActiveCompaniesWithoutWebsite(payload);
    const workTotal = Math.max(1, targets.length - skipped);
    const percent = (done / workTotal) * 100;
    const formattedPercent = new Intl.NumberFormat("nl-NL", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(percent);

    byId("harvestTotalFoundCount").textContent = String(withWebsite + withoutWebsite);
    byId("harvestNoWebsiteStatCount").textContent = String(withoutWebsite);
    byId("harvestActiveCount").textContent = active && activeTarget ? activeTarget.label : "Geen actieve locatie";
    byId("harvestCompanyCount").textContent = String(withWebsite);
    byId("harvestUpdatedAt").textContent = formatDateTime(payload && payload.updatedAt);
    byId("harvestProgressText").textContent = formattedPercent + "%";
    byId("harvestProgressBar").style.width = percent + "%";
  }

  function renderLocations(payload) {
    const list = byId("harvestLocationList");
    const targets = getTargets(payload);
    const visible = targets;

    list.innerHTML = visible.map(function (target) {
      const status = statusClass(target.status);
      const isActive = status === "active";
      const isPrevious = status === "previous";
      const completeCount = Number.isFinite(Number(target.completeCompanyCount))
        ? Number(target.completeCompanyCount)
        : (target.status === "active" ? countCompleteCompanies(payload) : Number(target.companyCount || 0));
      const candidateCount = Number(target.candidateCount || target.rawCompanyCount || 0);
      const checkedCount = Number(target.checkedCompanyCount || 0);
      const label = statusLabel(target.status);
      const population = formatPopulation(target);
      const metaParts = [completeCount + " compleet"];
      if (candidateCount > completeCount) metaParts.push(candidateCount + " kandidaten");
      if (checkedCount > 0) metaParts.push(checkedCount + " gecontroleerd");
      const meta = metaParts.join(" · ");
      return [
        '<div class="harvest-location-item' + (isActive ? " is-active" : "") + (isPrevious ? " is-previous" : "") + '">',
        '<span class="harvest-location-index">' + escapeHtml(target.index) + '</span>',
        '<div class="harvest-location-copy">',
        '<div class="harvest-location-title">' + escapeHtml(target.label) + '</div>',
        '<div class="harvest-location-meta">' + escapeHtml(meta) + '</div>',
        '</div>',
        label ? '<span class="harvest-status ' + status + '">' + escapeHtml(label) + '</span>' : '<span class="harvest-status-spacer" aria-hidden="true"></span>',
        population ? '<span class="harvest-population">' + escapeHtml(population) + '</span>' : '<span class="harvest-population-spacer" aria-hidden="true"></span>',
        '</div>'
      ].join("");
    }).join("");
  }

  function renderCompanies(payload) {
    const body = byId("harvestCompanyTableBody");
    byId("harvestCurrentLocation").textContent = "Actief mét website";

    const query = normalizeSearch(state.query);
    const companies = getCompanies(payload).filter(function (company) {
      return isCompleteCompany(company) && hasWebsite(company) && !looksInactive(company);
    }).filter(function (company) {
      const companyText = normalizeSearch([
        company.companyName,
        company.phone,
        company.email,
        company.website,
        company.location
      ].join(" "));
      return !query || companyText.includes(query);
    });

    if (!companies.length) {
      body.innerHTML = '<tr><td colspan="5">Nog geen complete bedrijven met website gevonden. Een bedrijf telt hier pas mee wanneer bedrijfsnaam, telefoonnummer, mailadres, website en locatie gevuld zijn.</td></tr>';
      return;
    }

    body.innerHTML = companies.map(function (company) {
      const phone = normalizeText(company.phone);
      const email = normalizeText(company.email);
      const website = normalizeText(company.website);
      const websiteHref = normalizeWebsiteHref(website);
      const websiteLabel = formatWebsiteLabel(website);
      return [
        "<tr>",
        "<td>" + escapeHtml(company.companyName) + "</td>",
        '<td class="' + (phone ? "" : "harvest-missing") + '">' + escapeHtml(phone || "Nog niet gevonden") + "</td>",
        '<td class="' + (email ? "" : "harvest-missing") + '">' + escapeHtml(email || "Nog niet gevonden") + "</td>",
        '<td class="' + (website ? "" : "harvest-missing") + '">'
          + (websiteHref
            ? '<a class="harvest-website-link" href="' + escapeHtml(websiteHref) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(websiteLabel || websiteHref) + "</a>"
            : escapeHtml(website || "Nog niet gevonden"))
          + "</td>",
        "<td>" + escapeHtml(company.location) + "</td>",
        "</tr>"
      ].join("");
    }).join("");
  }

  function renderNoWebsiteCompanies(payload) {
    const body = byId("harvestNoWebsiteTableBody");
    if (!body) return;

    const query = normalizeSearch(state.query);
    const companies = getCompanies(payload)
      .filter(function (company) {
        return isCompleteCompany(company)
          && !hasWebsite(company)
          && !looksInactive(company);
      })
      .filter(function (company) {
        const companyText = normalizeSearch([
          company.companyName,
          company.phone,
          company.email,
          company.location
        ].join(" "));
        return !query || companyText.includes(query);
      });

    if (!companies.length) {
      body.innerHTML = '<tr><td colspan="4">Geen actieve complete bedrijven zonder website gevonden.</td></tr>';
      return;
    }

    body.innerHTML = companies.map(function (company) {
      return [
        "<tr>",
        "<td>" + escapeHtml(company.companyName) + "</td>",
        "<td>" + escapeHtml(company.phone) + "</td>",
        "<td>" + escapeHtml(company.email) + "</td>",
        "<td>" + escapeHtml(company.location) + "</td>",
        "</tr>"
      ].join("");
    }).join("");
  }

  function render(payload) {
    renderStats(payload);
    renderLocations(payload);
    renderCompanies(payload);
    renderNoWebsiteCompanies(payload);
  }

  function loadData() {
    return fetch(DATA_URL + "?t=" + encodeURIComponent(String(Date.now())), {
      headers: { Accept: "application/json" }
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Data niet beschikbaar");
        return response.json();
      })
      .then(function (payload) {
        state.payload = payload;
        render(payload);
      })
      .catch(function () {
        byId("harvestUpdatedAt").textContent = "Geen live data";
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    const input = byId("harvestSearchInput");
    if (input) {
      input.addEventListener("input", function () {
        state.query = input.value || "";
        if (state.payload) {
          renderCompanies(state.payload);
          renderNoWebsiteCompanies(state.payload);
        }
      });
    }
    loadData();
    window.setInterval(loadData, REFRESH_MS);
  });
})();
