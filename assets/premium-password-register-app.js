(function (global) {
  "use strict";

  var entries = [];
  var visible = {};
  /** @type {'closed' | 'edit' | 'create'} */
  var entryModalMode = "closed";
  var currentEditEntryId = null;
  var pendingDeleteEntryId = null;

  var registerStatusEl = document.getElementById("register-status");
  var searchInputEl = document.getElementById("search");
  var passwordListEl = document.getElementById("list");
  var pinNumpadEl = document.querySelector(".numpad");
  var lockRegisterBtnEl = document.getElementById("lock-register-btn");
  var addEntryBtnEl = document.getElementById("add-entry-btn");
  var entryModalBackdrop = document.getElementById("entry-modal-backdrop");
  var entryModalEl = document.getElementById("entry-modal");
  var entryModalCloseEl = document.getElementById("entry-modal-close");
  var entryCancelEl = document.getElementById("entry-cancel");
  var entryFormEl = document.getElementById("entry-form");
  var entryNameEl = document.getElementById("entry-name");
  var entryUrlEl = document.getElementById("entry-url");
  var entryUserEl = document.getElementById("entry-user");
  var entryPasswordEl = document.getElementById("entry-password");
  var entryModalTitleEl = document.getElementById("entry-modal-title");
  var entryModalSubEl = document.getElementById("entry-modal-sub");
  var pwDeleteModalOverlay = document.getElementById("pw-delete-modal-overlay");
  var pwDeleteModalTextEl = document.getElementById("pw-delete-modal-text");
  var pwDeleteModalCancelEl = document.getElementById("pw-delete-modal-cancel");
  var pwDeleteModalConfirmEl = document.getElementById("pw-delete-modal-confirm");
  var passwordRegisterStore = global.SoftoraPasswordRegisterStore.create({
    setStatus: setRegisterStatus
  });
  var passwordRegisterPin = global.SoftoraPasswordRegisterPin.create({
    pinScreen: "screen-pin",
    registerScreen: "screen-register",
    messageEl: "pin-msg",
    dotSelector: ".pin-dot",
    unlock: unlockRegister,
    onBeforeLock: function () {
      passwordRegisterStore.lock();
      entries = [];
      visible = {};
      closeEditModal();
      closeDeleteEntryModal();
    }
  });

  function normalizeString(value) {
    return passwordRegisterStore.normalizeString(value);
  }

  function sanitizePasswordEntry(entry, index) {
    return passwordRegisterStore.sanitizeEntry(entry, index);
  }

  function getNextPasswordEntryId() {
    return passwordRegisterStore.getNextId(entries);
  }

  function setRegisterStatus(message, tone) {
    if (!registerStatusEl) return;
    registerStatusEl.textContent = normalizeString(message);
    registerStatusEl.style.color = tone === "warning" ? "var(--red)" : "var(--text-tertiary)";
  }

  async function persistPasswordEntries(actor) {
    var result = await passwordRegisterStore.persist(entries, actor || "save");
    entries = result.entries;
    return result.response;
  }

  async function ensurePasswordEntriesLoaded(masterSecret) {
    entries = await passwordRegisterStore.unlock(masterSecret);
    return entries;
  }

  function getEntryById(id) {
    return entries.find(function (entry) {
      return Number(entry && entry.id) === Number(id);
    }) || null;
  }

  function render() {
    var renderer = global.SoftoraPasswordRegisterRenderer;
    if (!passwordListEl || !renderer) return;
    var q = normalizeString(searchInputEl && searchInputEl.value).toLowerCase();
    var filtered = entries.filter(function (entry) {
      if (!q) return true;
      return [entry.naam, entry.url, entry.user].some(function (value) {
        return normalizeString(value).toLowerCase().includes(q);
      });
    });

    if (!filtered.length) {
      passwordListEl.replaceChildren(renderer.createEmptyState("Geen resultaten gevonden."));
      return;
    }

    var fragment = document.createDocumentFragment();
    filtered.forEach(function (entry) {
      fragment.appendChild(renderer.createEntryRow(entry, Boolean(visible[entry.id])));
    });
    passwordListEl.replaceChildren(fragment);
  }

  function toggleVis(id) {
    visible[id] = !visible[id];
    render();
  }

  function openDeleteEntryModal(id) {
    var entry = getEntryById(id);
    if (!entry) return;
    pendingDeleteEntryId = entry.id;
    if (pwDeleteModalTextEl) {
      pwDeleteModalTextEl.textContent = 'Weet je zeker dat je "' + entry.naam + '" wilt verwijderen?';
    }
    if (pwDeleteModalOverlay) {
      pwDeleteModalOverlay.classList.add("open");
      pwDeleteModalOverlay.setAttribute("aria-hidden", "false");
    }
    if (pwDeleteModalConfirmEl) pwDeleteModalConfirmEl.focus();
  }

  function closeDeleteEntryModal() {
    pendingDeleteEntryId = null;
    if (pwDeleteModalOverlay) {
      pwDeleteModalOverlay.classList.remove("open");
      pwDeleteModalOverlay.setAttribute("aria-hidden", "true");
    }
  }

  async function confirmDeletePasswordEntry() {
    if (pendingDeleteEntryId == null) return;
    var id = pendingDeleteEntryId;
    var entry = getEntryById(id);
    if (!entry) {
      closeDeleteEntryModal();
      return;
    }
    var snapshot = entries.slice();
    entries = entries.filter(function (entryItem) {
      return Number(entryItem && entryItem.id) !== Number(id);
    });
    delete visible[id];
    closeDeleteEntryModal();
    render();
    try {
      await persistPasswordEntries("delete");
      toast("\u2713 Inlog verwijderd");
    } catch (_) {
      entries = snapshot;
      render();
      toast("Opslaan mislukt");
      setRegisterStatus("Opslaan in Supabase mislukt. Probeer het opnieuw.", "warning");
    }
  }

  function openCreateModal() {
    entryModalMode = "create";
    currentEditEntryId = null;
    entryFormEl.reset();
    if (entryModalTitleEl) entryModalTitleEl.textContent = "Nieuwe inlog";
    if (entryModalSubEl) {
      entryModalSubEl.textContent = "Vul naam, website, gebruikersnaam en wachtwoord in.";
    }
    entryModalBackdrop.hidden = false;
    entryModalEl.hidden = false;
    entryNameEl.focus();
  }

  function openEditModal(id) {
    var entry = getEntryById(id);
    if (!entry) return;

    entryModalMode = "edit";
    currentEditEntryId = entry.id;
    if (entryModalTitleEl) entryModalTitleEl.textContent = "Inloggegevens wijzigen";
    if (entryModalSubEl) {
      entryModalSubEl.textContent = "Pas naam, website, gebruikersnaam en wachtwoord aan.";
    }
    entryNameEl.value = entry.naam;
    entryUrlEl.value = entry.url;
    entryUserEl.value = entry.user;
    entryPasswordEl.value = entry.pw;
    entryModalBackdrop.hidden = false;
    entryModalEl.hidden = false;
    entryNameEl.focus();
  }

  function closeEditModal() {
    entryModalMode = "closed";
    currentEditEntryId = null;
    entryModalBackdrop.hidden = true;
    entryModalEl.hidden = true;
    entryFormEl.reset();
  }

  async function saveEntryFromModal(event) {
    event.preventDefault();

    if (entryModalMode === "create") {
      var newEntry = sanitizePasswordEntry(
        {
          id: getNextPasswordEntryId(),
          naam: entryNameEl.value,
          url: entryUrlEl.value,
          user: entryUserEl.value,
          pw: entryPasswordEl.value,
          cat: "Overig"
        },
        entries.length
      );
      var previousEntries = entries.slice();
      entries = entries.concat(newEntry);
      try {
        await persistPasswordEntries("create");
        closeEditModal();
        render();
        toast("\u2713 Nieuwe inlog opgeslagen");
      } catch (_) {
        entries = previousEntries;
        render();
        toast("Opslaan mislukt");
        setRegisterStatus("Opslaan in Supabase mislukt. Probeer het opnieuw.", "warning");
      }
      return;
    }

    if (entryModalMode !== "edit" || !currentEditEntryId) return;

    var existingEntry = getEntryById(currentEditEntryId);
    if (!existingEntry) {
      closeEditModal();
      return;
    }

    var updatedEntry = sanitizePasswordEntry(
      {
        id: existingEntry.id,
        naam: entryNameEl.value,
        url: entryUrlEl.value,
        user: entryUserEl.value,
        pw: entryPasswordEl.value,
        cat: existingEntry.cat
      },
      entries.findIndex(function (entry) {
        return entry.id === existingEntry.id;
      })
    );

    entries = entries.map(function (entry) {
      return entry.id === updatedEntry.id ? updatedEntry : entry;
    });

    try {
      await persistPasswordEntries("edit");
      closeEditModal();
      render();
      toast("\u2713 Inloggegevens opgeslagen");
    } catch (_) {
      entries = entries.map(function (entry) {
        return entry.id === existingEntry.id ? existingEntry : entry;
      });
      render();
      toast("Opslaan mislukt");
      setRegisterStatus("Opslaan in Supabase mislukt. Probeer het opnieuw.", "warning");
    }
  }

  function bindEntryListActions() {
    if (!passwordListEl) return;
    passwordListEl.addEventListener("click", function (event) {
      var target = event.target;
      var button = target && typeof target.closest === "function"
        ? target.closest("[data-entry-action][data-entry-id]")
        : null;
      if (!button) return;
      var id = Number(button.dataset.entryId || 0);
      if (!id) return;
      if (button.dataset.entryAction === "toggle") {
        toggleVis(id);
      } else if (button.dataset.entryAction === "edit") {
        openEditModal(id);
      } else if (button.dataset.entryAction === "delete") {
        openDeleteEntryModal(id);
      }
    });
  }

  function bindEvents() {
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (pwDeleteModalOverlay && pwDeleteModalOverlay.classList.contains("open")) {
        closeDeleteEntryModal();
        return;
      }
      if (!entryModalEl.hidden) {
        closeEditModal();
      }
    });

    entryModalBackdrop.addEventListener("click", closeEditModal);
    entryModalCloseEl.addEventListener("click", closeEditModal);
    entryCancelEl.addEventListener("click", closeEditModal);
    entryFormEl.addEventListener("submit", saveEntryFromModal);
    passwordRegisterPin.bindNumpad(pinNumpadEl);
    passwordRegisterPin.bindKeyboard(document);
    if (lockRegisterBtnEl) {
      lockRegisterBtnEl.addEventListener("click", passwordRegisterPin.lock);
    }
    if (addEntryBtnEl) {
      addEntryBtnEl.addEventListener("click", openCreateModal);
    }
    if (searchInputEl) {
      searchInputEl.addEventListener("input", render);
    }
    bindEntryListActions();

    if (pwDeleteModalOverlay) {
      pwDeleteModalOverlay.addEventListener("click", function (event) {
        if (event.target === pwDeleteModalOverlay) closeDeleteEntryModal();
      });
    }
    if (pwDeleteModalCancelEl) {
      pwDeleteModalCancelEl.addEventListener("click", closeDeleteEntryModal);
    }
    if (pwDeleteModalConfirmEl) {
      pwDeleteModalConfirmEl.addEventListener("click", function () {
        confirmDeletePasswordEntry();
      });
    }
  }

  async function unlockRegister() {
    var masterSecret = normalizeString(
      global.prompt(
        "Voer je master-wachtzin in. Deze wordt niet opgeslagen en kan niet worden hersteld."
      )
    );
    if (!masterSecret) {
      setRegisterStatus("Master-wachtzin is nodig om de kluis te openen.", "warning");
      return;
    }
    document.getElementById("screen-pin").style.display = "none";
    document.getElementById("screen-register").style.display = "block";
    var loaderEl = document.getElementById("register-data-loader");
    if (loaderEl) {
      loaderEl.hidden = false;
      loaderEl.setAttribute("aria-hidden", "false");
    }
    try {
      await ensurePasswordEntriesLoaded(masterSecret);
      render();
    } catch (error) {
      entries = [];
      render();
      document.getElementById("screen-register").style.display = "none";
      document.getElementById("screen-pin").style.display = "grid";
      setRegisterStatus(normalizeString(error && error.message) || "Kluis openen mislukt.", "warning");
      toast("Kluis openen mislukt");
    } finally {
      if (loaderEl) {
        loaderEl.hidden = true;
        loaderEl.setAttribute("aria-hidden", "true");
      }
    }
  }

  function toast(message) {
    var toastEl = document.getElementById("toast");
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("show");
    window.setTimeout(function () {
      toastEl.classList.remove("show");
    }, 2500);
  }

  bindEvents();
  render();
})(window);
