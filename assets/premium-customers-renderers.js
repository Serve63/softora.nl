(function (global) {
  "use strict";

  function normalize(value) {
    return String(value == null ? "" : value).trim();
  }

  function appendText(parent, tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function createCell(label, className) {
    const cell = document.createElement("td");
    cell.dataset.label = label;
    if (className) cell.className = className;
    return cell;
  }

  function createSvg(tagName, attributes) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tagName);
    Object.entries(attributes || {}).forEach(function ([name, value]) {
      element.setAttribute(name, value);
    });
    return element;
  }

  function createEditButton(customerId, helpers) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-edit";
    button.dataset.action = "edit";
    button.dataset.id = (helpers.normalizeString || normalize)(customerId);
    button.title = "Bewerken";
    button.setAttribute("aria-label", "Klant bewerken");
    const svg = createSvg("svg", {
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.8"
    });
    svg.append(
      createSvg("path", { d: "M12 20h9" }),
      createSvg("path", { d: "M16.5 3.5a2.12 2.12 0 113 3L7 19l-4 1 1-4 12.5-12.5z" })
    );
    button.appendChild(svg);
    return button;
  }

  function createServiceContent(customer, kind, helpers) {
    const isWebsite = kind === "website";
    const isApplicable = isWebsite
      ? helpers.customerHasWebsite(customer)
      : helpers.customerHasMaintenance(customer);
    if (!isApplicable) {
      const span = document.createElement("span");
      span.className = "service-na";
      span.textContent = isWebsite ? "Niet van toepassing" : "Nee";
      return span;
    }
    const amount = helpers.getServiceAmount(customer, kind);
    const label = amount !== null
      ? (isWebsite ? helpers.formatMoney(amount) : helpers.formatMoney(amount) + " p/m")
      : "Nog niet ingevuld";
    const stack = document.createElement("div");
    stack.className = "service-stack";
    appendText(stack, "div", amount !== null ? "service-price" : "service-price service-na", label);
    return stack;
  }

  function createPriceContent(customer, helpers) {
    const amount = helpers.getServiceAmount(customer, "website");
    if (!helpers.customerHasWebsite(customer) && amount === null) {
      const span = document.createElement("span");
      span.className = "service-na";
      span.textContent = "\u2014";
      return span;
    }
    if (amount === null) {
      const span = document.createElement("span");
      span.className = "service-price service-na";
      span.textContent = "Nog niet ingevuld";
      return span;
    }
    const price = document.createElement("div");
    price.className = "service-price";
    price.textContent = helpers.formatMoney(amount);
    return price;
  }

  function renderLeaderboard(target, entries) {
    target.replaceChildren();
    entries.forEach(function (entry, index) {
      const row = document.createElement("div");
      row.className = index === 0 ? "leaderboard-entry is-leading" : "leaderboard-entry";
      const assignmentLabel = entry.count === 1 ? "opdracht" : "opdrachten";
      appendText(row, "span", "leaderboard-entry-name", entry.displayName);
      appendText(row, "span", "leaderboard-entry-count", entry.count + " " + assignmentLabel);
      target.appendChild(row);
    });
  }

  function renderRows(target, customers, helpers) {
    target.replaceChildren();
    const normalizeString = helpers.normalizeString || normalize;
    const fragment = document.createDocumentFragment();
    customers.forEach(function (customer) {
      const row = document.createElement("tr");
      const websiteLabel = normalizeString(customer && customer.website);
      const companyLabel = normalizeString(customer && customer.bedrijf);
      const subLabel = websiteLabel && websiteLabel !== "-" ? websiteLabel : (companyLabel !== "-" ? companyLabel : "");
      const clientCell = createCell("Klant", "cell-client");
      appendText(clientCell, "div", "client-name", customer.naam);
      if (subLabel) appendText(clientCell, "div", "client-company", subLabel);
      row.appendChild(clientCell);
      [["Telefoonnummer", "muted-cell cell-phone", customer.telefoon], ["Service", "muted-cell", helpers.formatCustomerServiceLabel(customer.service)]].forEach(function (cellConfig) {
        const cell = createCell(cellConfig[0], cellConfig[1]);
        cell.textContent = cellConfig[2];
        row.appendChild(cell);
      });
      const priceCell = createCell("Prijs", "service-cell");
      priceCell.appendChild(createPriceContent(customer, helpers));
      row.appendChild(priceCell);
      const maintenanceCell = createCell("Onderhoud", "service-cell");
      maintenanceCell.appendChild(createServiceContent(customer, "maintenance", helpers));
      row.appendChild(maintenanceCell);
      const statusCell = createCell("Status", "");
      appendText(statusCell, "span", "status-text " + (customer.status === "Betaald" ? "is-paid" : "is-open"), customer.status);
      row.appendChild(statusCell);
      const assignedCell = createCell("Toegewezen aan", "muted-cell cell-assigned");
      assignedCell.textContent = helpers.formatResponsibleDisplayName(customer.verantwoordelijk || "Team");
      row.appendChild(assignedCell);
      [["Actief", customer.actief || "Ja", customer.actief === "Ja"], ["Review?", customer.review || "Nee", customer.review === "Ja"]].forEach(function (cellConfig) {
        const cell = createCell(cellConfig[0], "");
        appendText(cell, "span", "active-text " + (cellConfig[2] ? "is-yes" : "is-no"), cellConfig[1]);
        row.appendChild(cell);
      });
      const dateCell = createCell("Betaaldatum", "muted-cell");
      dateCell.textContent = helpers.formatDate(customer.datum);
      row.appendChild(dateCell);
      const actionsCell = createCell("Acties", "cell-actions");
      const actions = document.createElement("div");
      actions.className = "actions";
      actions.appendChild(createEditButton(customer.id, helpers));
      actionsCell.appendChild(actions);
      row.appendChild(actionsCell);
      fragment.appendChild(row);
    });
    target.appendChild(fragment);
  }

  global.SoftoraCustomersRenderers = { renderLeaderboard: renderLeaderboard, renderRows: renderRows };
})(window);
