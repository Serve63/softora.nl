(function (global) {
  "use strict";

  var entries = [];
  var visible = {};
  /** @type {'closed' | 'edit' | 'create'} */
  var entryModalMode = "closed";
  var currentEditEntryId = null;
  var pendingDeleteEntryId = null;
  var pendingMasterSecretResolver = null;
  var masterSecretDialogMode = "unlock";
  var passwordRegisterAutoLock = null;
  var vaultSessionGeneration = 0;

  var registerStatusEl = document.getElementById("register-status");
  var searchInputEl = document.getElementById("search");
  var passwordListEl = document.getElementById("list");
  var pinNumpadEl = document.querySelector(".numpad");
  var lockRegisterBtnEl = document.getElementById("lock-register-btn");
  var addEntryBtnEl = document.getElementById("add-entry-btn");
  var masterSecretOverlayEl = document.getElementById("master-secret-overlay");
  var masterSecretFormEl = document.getElementById("master-secret-form");
  var masterSecretInputEl = document.getElementById("master-secret-input");
  var masterSecretInputLabelEl = document.getElementById("master-secret-input-label");
  var masterSecretCurrentFieldEl = document.getElementById("master-secret-current-field");
  var masterSecretCurrentInputEl = document.getElementById("master-secret-current-input");
  var masterSecretConfirmFieldEl = document.getElementById("master-secret-confirm-field");
  var masterSecretConfirmInputEl = document.getElementById("master-secret-confirm-input");
  var masterSecretPinFieldEl = document.getElementById("master-secret-pin-field");
  var masterSecretPinInputEl = document.getElementById("master-secret-pin-input");
  var masterSecretErrorEl = document.getElementById("master-secret-error");
  var masterSecretTitleEl = document.getElementById("master-secret-title");
  var masterSecretSubmitEl = document.getElementById("master-secret-submit");
  var masterSecretCloseEl = document.getElementById("master-secret-close");
  var entryModalBackdrop = document.getElementById("entry-modal-backdrop");
  var entryModalEl = document.getElementById("entry-modal");
  var entryModalCloseEl = document.getElementById("entry-modal-close");
  var entryCancelEl = document.getElementById("entry-cancel");
  var entryFormEl = document.getElementById("entry-form");
  var entryNameEl = document.getElementById("entry-name");
  var entryUrlEl = document.getElementById("entry-url");
  var entryUserEl = document.getElementById("entry-user");
  var entryPasswordEl = document.getElementById("entry-password");
  var entryPasswordToggleEl = document.getElementById("entry-password-toggle");
  var entryModalTitleEl = document.getElementById("entry-modal-title");
  var entryModalSubEl = document.getElementById("entry-modal-sub");
  var pwDeleteModalOverlay = document.getElementById("pw-delete-modal-overlay");
  var pwDeleteModalTextEl = document.getElementById("pw-delete-modal-text");
  var pwDeleteModalCancelEl = document.getElementById("pw-delete-modal-cancel");
  var pwDeleteModalConfirmEl = document.getElementById("pw-delete-modal-confirm");
  var changeMasterSecretBtnEl = document.getElementById("change-master-secret-btn");
  var toastEl = document.getElementById("toast");
  var pinMessageEl = document.getElementById("pin-msg");
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
      secureLockCleanup();
    }
  });
  passwordRegisterAutoLock = global.SoftoraPasswordRegisterAutoLock.create({
    document: document,
    window: global,
    inactivityMs: global.SoftoraPasswordRegisterAutoLock.DEFAULT_INACTIVITY_MS,
    onLock: function () {
      passwordRegisterPin.lock();
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

  function setMasterSecretError(message) {
    if (!masterSecretErrorEl) return;
    masterSecretErrorEl.textContent = normalizeString(message);
  }

  function isMasterSecretDialogOpen() {
    return Boolean(masterSecretOverlayEl && !masterSecretOverlayEl.hidden);
  }

  function resetEntryPasswordVisibility() {
    if (entryPasswordEl) entryPasswordEl.type = "password";
    if (entryPasswordToggleEl) {
      entryPasswordToggleEl.textContent = "Tonen";
      entryPasswordToggleEl.setAttribute("aria-pressed", "false");
      entryPasswordToggleEl.setAttribute("aria-label", "Wachtwoord tonen");
    }
  }

  function finishMasterSecretDialog(value) {
    if (!pendingMasterSecretResolver) return;
    var resolve = pendingMasterSecretResolver;
    pendingMasterSecretResolver = null;
    if (masterSecretOverlayEl) {
      masterSecretOverlayEl.hidden = true;
      masterSecretOverlayEl.setAttribute("aria-hidden", "true");
    }
    if (masterSecretInputEl) {
      masterSecretInputEl.value = "";
      masterSecretInputEl.removeAttribute("aria-invalid");
    }
    if (masterSecretConfirmInputEl) {
      masterSecretConfirmInputEl.value = "";
      masterSecretConfirmInputEl.removeAttribute("aria-invalid");
    }
    if (masterSecretCurrentInputEl) {
      masterSecretCurrentInputEl.value = "";
      masterSecretCurrentInputEl.removeAttribute("aria-invalid");
    }
    if (masterSecretPinInputEl) {
      masterSecretPinInputEl.value = "";
      masterSecretPinInputEl.removeAttribute("aria-invalid");
    }
    setMasterSecretError("");
    resolve(value);
  }

  function openMasterSecretDialog(mode) {
    if (!masterSecretOverlayEl || !masterSecretInputEl) {
      setRegisterStatus("Master-wachtzin kan niet worden gevraagd. Vernieuw de pagina.", "warning");
      return Promise.resolve("");
    }
    if (pendingMasterSecretResolver) {
      finishMasterSecretDialog("");
    }
    return new Promise(function (resolve) {
      masterSecretDialogMode = mode === "change" ? "change" : "unlock";
      pendingMasterSecretResolver = resolve;
      masterSecretInputEl.value = "";
      masterSecretInputEl.removeAttribute("aria-invalid");
      if (masterSecretConfirmInputEl) {
        masterSecretConfirmInputEl.value = "";
        masterSecretConfirmInputEl.removeAttribute("aria-invalid");
      }
      if (masterSecretCurrentInputEl) {
        masterSecretCurrentInputEl.value = "";
        masterSecretCurrentInputEl.removeAttribute("aria-invalid");
      }
      if (masterSecretPinInputEl) {
        masterSecretPinInputEl.value = "";
        masterSecretPinInputEl.removeAttribute("aria-invalid");
      }
      if (masterSecretCurrentFieldEl) masterSecretCurrentFieldEl.hidden = masterSecretDialogMode !== "change";
      if (masterSecretConfirmFieldEl) masterSecretConfirmFieldEl.hidden = masterSecretDialogMode !== "change";
      if (masterSecretPinFieldEl) masterSecretPinFieldEl.hidden = masterSecretDialogMode !== "change";
      if (masterSecretInputLabelEl) {
        masterSecretInputLabelEl.textContent = masterSecretDialogMode === "change"
          ? "Nieuwe master-wachtzin"
          : "Master-wachtzin";
      }
      if (masterSecretTitleEl) {
        masterSecretTitleEl.textContent = masterSecretDialogMode === "change"
          ? "Nieuwe master-wachtzin"
          : "Master-wachtzin";
      }
      if (masterSecretSubmitEl) {
        masterSecretSubmitEl.textContent = masterSecretDialogMode === "change"
          ? "Wachtzin wijzigen"
          : "Ontgrendelen";
      }
      setMasterSecretError("");
      masterSecretOverlayEl.hidden = false;
      masterSecretOverlayEl.setAttribute("aria-hidden", "false");
      window.setTimeout(function () {
        if (masterSecretDialogMode === "change" && masterSecretCurrentInputEl) {
          masterSecretCurrentInputEl.focus();
        } else {
          masterSecretInputEl.focus();
        }
      }, 0);
    });
  }

  async function persistPasswordEntries(actor) {
    try {
      var result = await passwordRegisterStore.persist(entries, actor || "save");
      if (result.stale) {
        var staleError = new Error("De kluis is tijdens het opslaan vergrendeld.");
        staleError.code = "PASSWORD_REGISTER_LOCKED";
        throw staleError;
      }
      entries = result.entries;
      return result.response;
    } catch (error) {
      if (error && error.forceLock) forceLockAfterVaultFailure(error);
      throw error;
    }
  }

  async function ensurePasswordEntriesLoaded(masterSecret) {
    return passwordRegisterStore.unlock(masterSecret);
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

  function renderLockedState() {
    var renderer = global.SoftoraPasswordRegisterRenderer;
    if (!passwordListEl || !renderer) return;
    passwordListEl.replaceChildren(renderer.createEmptyState("Kluis vergrendeld."));
  }

  function getVaultFailureMessage(error) {
    var code = normalizeString(error && error.code);
    if (code === "PASSWORD_REGISTER_CURRENT_MASTER_INVALID") {
      return "Huidige master-wachtzin onjuist. De kluis is voor de zekerheid vergrendeld.";
    }
    if (code === "PASSWORD_REGISTER_REKEY_UNCERTAIN" || code === "PASSWORD_REGISTER_WRITE_UNCERTAIN") {
      return "Opslaguitkomst onzeker. Ontgrendel opnieuw; probeer na een wachtzinwijziging eerst de nieuwe wachtzin.";
    }
    return "Kluis voor de zekerheid vergrendeld. Ontgrendel opnieuw voor een verse Supabase-controle.";
  }

  function forceLockAfterVaultFailure(error) {
    var message = getVaultFailureMessage(error);
    passwordRegisterPin.lock();
    if (pinMessageEl) pinMessageEl.textContent = message;
  }

  function secureLockCleanup() {
    vaultSessionGeneration += 1;
    if (passwordRegisterAutoLock) passwordRegisterAutoLock.stop();
    passwordRegisterStore.lock();
    if (global.SoftoraPasswordRegisterSecurity) {
      global.SoftoraPasswordRegisterSecurity.wipeEntries(entries);
    }
    entries = [];
    visible = {};
    if (pendingMasterSecretResolver) finishMasterSecretDialog("");
    closeEditModal();
    closeDeleteEntryModal();
    if (global.SoftoraPasswordRegisterSecurity) {
      global.SoftoraPasswordRegisterSecurity.clearSensitiveUi({
        inputs: [masterSecretInputEl, masterSecretCurrentInputEl, masterSecretConfirmInputEl, masterSecretPinInputEl, entryNameEl, entryUrlEl, entryUserEl, entryPasswordEl, searchInputEl],
        entryForm: entryFormEl,
        passwordInput: entryPasswordEl,
        passwordToggle: entryPasswordToggleEl,
        deleteModalText: pwDeleteModalTextEl,
        status: registerStatusEl,
        toast: toastEl,
        list: passwordListEl,
        createLockedState: global.SoftoraPasswordRegisterRenderer.createEmptyState
      });
    } else {
      renderLockedState();
    }
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
    var expectedGeneration = vaultSessionGeneration;
    entries = entries.filter(function (entryItem) {
      return Number(entryItem && entryItem.id) !== Number(id);
    });
    delete visible[id];
    closeDeleteEntryModal();
    render();
    try {
      await persistPasswordEntries("delete");
      if (expectedGeneration !== vaultSessionGeneration) return;
      toast("\u2713 Inlog verwijderd");
    } catch (_) {
      if (expectedGeneration !== vaultSessionGeneration) {
        if (global.SoftoraPasswordRegisterSecurity) {
          global.SoftoraPasswordRegisterSecurity.wipeEntries(snapshot);
        }
        return;
      }
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
    resetEntryPasswordVisibility();
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
    resetEntryPasswordVisibility();
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
    resetEntryPasswordVisibility();
  }

  function toggleEntryPasswordVisibility() {
    if (!entryPasswordEl || !entryPasswordToggleEl) return;
    var willShow = entryPasswordEl.type === "password";
    entryPasswordEl.type = willShow ? "text" : "password";
    entryPasswordToggleEl.textContent = willShow ? "Verbergen" : "Tonen";
    entryPasswordToggleEl.setAttribute("aria-pressed", willShow ? "true" : "false");
    entryPasswordToggleEl.setAttribute("aria-label", willShow ? "Wachtwoord verbergen" : "Wachtwoord tonen");
  }

  async function changeMasterSecret() {
    var request = await openMasterSecretDialog("change");
    if (!request || typeof request !== "object") return;
    var expectedGeneration = vaultSessionGeneration;
    var rawPin = String(request.pin || "");
    request.pin = "";
    try {
      var verification = await passwordRegisterPin.verifyFreshPin(rawPin);
      rawPin = "";
      if (!verification || verification.ok !== true) {
        throw new Error("De verse beveiligings-PIN is niet bevestigd.");
      }
      if (expectedGeneration !== vaultSessionGeneration) return;
      var result = await passwordRegisterStore.changeMasterSecret(
        request.currentMasterSecret,
        request.newMasterSecret,
        entries,
        "master-secret-change"
      );
      if (result.stale || expectedGeneration !== vaultSessionGeneration) return;
      entries = result.entries;
      render();
      toast("\u2713 Master-wachtzin gewijzigd; v2-migratie volgt in de beveiligde eindstap");
    } catch (error) {
      if (expectedGeneration !== vaultSessionGeneration) return;
      forceLockAfterVaultFailure(error);
    } finally {
      rawPin = "";
      request.currentMasterSecret = "";
      request.newMasterSecret = "";
      request.pin = "";
    }
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
      var createGeneration = vaultSessionGeneration;
      entries = entries.concat(newEntry);
      try {
        await persistPasswordEntries("create");
        if (createGeneration !== vaultSessionGeneration) return;
        closeEditModal();
        render();
        toast("\u2713 Nieuwe inlog opgeslagen");
      } catch (_) {
        if (createGeneration !== vaultSessionGeneration) {
          if (global.SoftoraPasswordRegisterSecurity) {
            global.SoftoraPasswordRegisterSecurity.wipeEntries(previousEntries);
          }
          return;
        }
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
    var editGeneration = vaultSessionGeneration;

    try {
      await persistPasswordEntries("edit");
      if (editGeneration !== vaultSessionGeneration) return;
      closeEditModal();
      render();
      toast("\u2713 Inloggegevens opgeslagen");
    } catch (_) {
      if (editGeneration !== vaultSessionGeneration) {
        if (global.SoftoraPasswordRegisterSecurity) {
          global.SoftoraPasswordRegisterSecurity.wipeEntries([existingEntry]);
        }
        return;
      }
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
      if (isMasterSecretDialogOpen()) {
        event.preventDefault();
        finishMasterSecretDialog("");
        return;
      }
      if (pwDeleteModalOverlay && pwDeleteModalOverlay.classList.contains("open")) {
        closeDeleteEntryModal();
        return;
      }
      if (!entryModalEl.hidden) {
        closeEditModal();
      }
    });

    if (masterSecretFormEl) {
      masterSecretFormEl.addEventListener("submit", function (event) {
        event.preventDefault();
        var nextSecret = normalizeString(masterSecretInputEl && masterSecretInputEl.value);
        if (!nextSecret) {
          if (masterSecretInputEl) masterSecretInputEl.setAttribute("aria-invalid", "true");
          setMasterSecretError("Vul je master-wachtzin in.");
          if (masterSecretInputEl) masterSecretInputEl.focus();
          return;
        }
        if (masterSecretDialogMode === "change") {
          var policy = passwordRegisterStore.validateNewMasterSecret(nextSecret);
          var currentSecret = normalizeString(masterSecretCurrentInputEl && masterSecretCurrentInputEl.value);
          var confirmedSecret = normalizeString(masterSecretConfirmInputEl && masterSecretConfirmInputEl.value);
          var freshPin = normalizeString(masterSecretPinInputEl && masterSecretPinInputEl.value);
          if (!currentSecret) {
            if (masterSecretCurrentInputEl) masterSecretCurrentInputEl.setAttribute("aria-invalid", "true");
            setMasterSecretError("Vul eerst je huidige master-wachtzin in.");
            if (masterSecretCurrentInputEl) masterSecretCurrentInputEl.focus();
            return;
          }
          if (!policy.ok) {
            masterSecretInputEl.setAttribute("aria-invalid", "true");
            setMasterSecretError(policy.error);
            masterSecretInputEl.focus();
            return;
          }
          if (confirmedSecret !== nextSecret) {
            if (masterSecretConfirmInputEl) masterSecretConfirmInputEl.setAttribute("aria-invalid", "true");
            setMasterSecretError("De twee master-wachtzinnen zijn niet gelijk.");
            if (masterSecretConfirmInputEl) masterSecretConfirmInputEl.focus();
            return;
          }
          if (!/^\d{6}$/.test(freshPin)) {
            if (masterSecretPinInputEl) masterSecretPinInputEl.setAttribute("aria-invalid", "true");
            setMasterSecretError("Vul de verse zescijferige beveiligings-PIN in.");
            if (masterSecretPinInputEl) masterSecretPinInputEl.focus();
            return;
          }
          finishMasterSecretDialog({
            currentMasterSecret: currentSecret,
            newMasterSecret: nextSecret,
            pin: freshPin
          });
          return;
        }
        finishMasterSecretDialog(nextSecret);
      });
    }
    if (masterSecretCloseEl) {
      masterSecretCloseEl.addEventListener("click", function () {
        finishMasterSecretDialog("");
      });
    }
    if (masterSecretOverlayEl) {
      masterSecretOverlayEl.addEventListener("click", function (event) {
        if (event.target === masterSecretOverlayEl) finishMasterSecretDialog("");
      });
    }

    entryModalBackdrop.addEventListener("click", closeEditModal);
    entryModalCloseEl.addEventListener("click", closeEditModal);
    entryCancelEl.addEventListener("click", closeEditModal);
    entryFormEl.addEventListener("submit", saveEntryFromModal);
    if (entryPasswordToggleEl) {
      entryPasswordToggleEl.addEventListener("click", toggleEntryPasswordVisibility);
    }
    passwordRegisterPin.bindNumpad(pinNumpadEl);
    passwordRegisterPin.bindKeyboard(document);
    if (lockRegisterBtnEl) {
      lockRegisterBtnEl.addEventListener("click", passwordRegisterPin.lock);
    }
    if (changeMasterSecretBtnEl) {
      changeMasterSecretBtnEl.addEventListener("click", changeMasterSecret);
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
    var masterSecret = "";
    var loaderEl = null;
    try {
      passwordRegisterAutoLock.start();
      if (!passwordRegisterAutoLock.isActive()) return;
      var expectedGeneration = vaultSessionGeneration;
      masterSecret = normalizeString(await openMasterSecretDialog("unlock"));
      if (!masterSecret || expectedGeneration !== vaultSessionGeneration) {
        passwordRegisterAutoLock.stop();
        if (!masterSecret) {
          setRegisterStatus("Master-wachtzin is nodig om de kluis te openen.", "warning");
        }
        return;
      }
      document.getElementById("screen-pin").style.display = "none";
      document.getElementById("screen-register").style.display = "block";
      loaderEl = document.getElementById("register-data-loader");
      if (loaderEl) {
        loaderEl.hidden = false;
        loaderEl.setAttribute("aria-hidden", "false");
      }
      try {
        var loadedEntries = await ensurePasswordEntriesLoaded(masterSecret);
        if (expectedGeneration !== vaultSessionGeneration) {
          if (global.SoftoraPasswordRegisterSecurity) {
            global.SoftoraPasswordRegisterSecurity.wipeEntries(loadedEntries);
          }
          return;
        }
        entries = loadedEntries;
        render();
        passwordRegisterAutoLock.start();
      } catch (error) {
        passwordRegisterPin.lock();
        if (pinMessageEl) {
          pinMessageEl.textContent = normalizeString(error && error.message) || "Ontgrendelen mislukt.";
        }
      }
    } finally {
      masterSecret = "";
      if (loaderEl) {
        loaderEl.hidden = true;
        loaderEl.setAttribute("aria-hidden", "true");
      }
    }
  }

  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("show");
    window.setTimeout(function () {
      toastEl.classList.remove("show");
    }, 2500);
  }

  bindEvents();
  renderLockedState();
})(window);
