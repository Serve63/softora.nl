(function (global) {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  function normalize(value) {
    return String(value == null ? "" : value).trim();
  }

  function createSvgElement(tagName, attributes) {
    var element = document.createElementNS(SVG_NS, tagName);
    Object.keys(attributes || {}).forEach(function (name) {
      element.setAttribute(name, attributes[name]);
    });
    return element;
  }

  function createIcon(parts) {
    var svg = createSvgElement("svg", {
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.8"
    });
    parts.forEach(function (part) {
      svg.appendChild(createSvgElement(part.tag || "path", part.attrs || {}));
    });
    return svg;
  }

  function createVisibilityIcon(isVisible) {
    if (isVisible) {
      return createIcon([
        { attrs: { d: "M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" } },
        { tag: "line", attrs: { x1: "1", y1: "1", x2: "23", y2: "23" } }
      ]);
    }
    return createIcon([
      { attrs: { d: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" } },
      { tag: "circle", attrs: { cx: "12", cy: "12", r: "3" } }
    ]);
  }

  function createActionIcon(action) {
    if (action === "edit") {
      return createIcon([
        { attrs: { d: "M12 20h9" } },
        { attrs: { d: "M16.5 3.5a2.12 2.12 0 113 3L7 19l-4 1 1-4 12.5-12.5z" } }
      ]);
    }
    return createIcon([
      { tag: "polyline", attrs: { points: "3 6 5 6 21 6" } },
      { attrs: { d: "M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2" } }
    ]);
  }

  function appendText(parent, tagName, className, text) {
    var element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = normalize(text);
    parent.appendChild(element);
    return element;
  }

  function createActionButton(config) {
    var button = document.createElement("button");
    button.className = config.className;
    button.type = "button";
    button.dataset.entryAction = config.action;
    button.dataset.entryId = String(config.entryId);
    button.title = config.title;
    button.setAttribute("aria-label", config.ariaLabel);
    button.appendChild(config.icon);
    return button;
  }

  function createEntryRow(entry, isVisible) {
    var id = Number(entry && entry.id) || 0;
    var row = document.createElement("div");
    row.className = "t-row";

    var nameCell = document.createElement("div");
    nameCell.className = "t-name";
    var nameWrap = document.createElement("div");
    appendText(nameWrap, "div", "t-label", entry && entry.naam);
    appendText(nameWrap, "div", "t-url", entry && entry.url);
    nameCell.appendChild(nameWrap);

    var userCell = document.createElement("div");
    userCell.className = "t-user";
    userCell.textContent = normalize(entry && entry.user);

    var passwordCell = document.createElement("div");
    passwordCell.className = "t-pw-wrap";
    var passwordText = document.createElement("span");
    passwordText.className = isVisible ? "t-pw" : "t-pw hidden";
    passwordText.id = "pw-" + id;
    passwordText.textContent = isVisible ? normalize(entry && entry.pw) : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
    passwordCell.append(
      passwordText,
      createActionButton({
        className: "btn-icon",
        action: "toggle",
        entryId: id,
        title: isVisible ? "Verbergen" : "Tonen",
        ariaLabel: isVisible ? "Wachtwoord verbergen" : "Wachtwoord tonen",
        icon: createVisibilityIcon(isVisible)
      })
    );

    var actionsCell = document.createElement("div");
    actionsCell.className = "row-actions";
    actionsCell.append(
      createActionButton({
        className: "btn-edit",
        action: "edit",
        entryId: id,
        title: "Bewerken",
        ariaLabel: "Inloggegevens bewerken",
        icon: createActionIcon("edit")
      }),
      createActionButton({
        className: "btn-del",
        action: "delete",
        entryId: id,
        title: "Verwijderen",
        ariaLabel: "Inloggegevens verwijderen",
        icon: createActionIcon("delete")
      })
    );

    row.append(nameCell, userCell, passwordCell, actionsCell);
    return row;
  }

  function createEmptyState(message) {
    var emptyState = document.createElement("div");
    emptyState.className = "empty";
    emptyState.textContent = normalize(message);
    return emptyState;
  }

  global.SoftoraPasswordRegisterRenderer = {
    createEmptyState: createEmptyState,
    createEntryRow: createEntryRow
  };
})(window);
