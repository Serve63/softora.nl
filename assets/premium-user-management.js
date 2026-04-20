// Premium gebruikersbeheer voor /premium-instellingen.

var team = [];
var pendingDelete = null;
var adminPinPending = null;
var canManageUsers = false;
var colors = ['#8b2252', '#16733c', '#1a5f7a', '#7b3f00', '#4a1a6b', '#b45a00'];

function getColor(id) {
  var raw = String(id || '');
  var total = 0;
  for (var index = 0; index < raw.length; index += 1) total += raw.charCodeAt(index);
  return colors[total % colors.length];
}

function initials(voornaam, achternaam, email) {
  var fallback = String(email || '').trim().charAt(0).toUpperCase();
  return ((voornaam[0] || fallback || '') + (achternaam[0] || '')).toUpperCase() || 'U';
}

function getDisplayName(persoon) {
  var naam = [persoon.voornaam || '', persoon.achternaam || ''].join(' ').trim();
  return naam || persoon.displayName || persoon.email || 'Onbekende gebruiker';
}

function setPrimaryButtonLoading(button, isLoading, loadingText) {
  if (!button) return;
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
  button.disabled = Boolean(isLoading);
  button.style.opacity = isLoading ? '0.7' : '1';
  button.textContent = isLoading ? loadingText : button.dataset.originalText;
}

async function fetchJson(url, options) {
  var response = await fetch(url, Object.assign({
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }
  }, options || {}));
  var payload = await response.json().catch(function () { return {}; });
  if (!response.ok || !payload.ok) {
    throw new Error((payload && payload.error) || 'Verzoek mislukt.');
  }
  return payload;
}

function goTo(id) {
  document.querySelectorAll('.screen').forEach(function (screen) {
    screen.classList.remove('active');
  });
  document.getElementById(id).classList.add('active');
  if (id === 'screen-personeel') {
    refreshTeam();
  }
}

function backToInstellingenOverzicht() {
  try {
    closeOverlay('edit-overlay');
    closeOverlay('confirm-overlay');
  } catch (e) { /* ignore */ }
  goTo('screen-overzicht');
}

function renderAccessDenied() {
  document.getElementById('list-count').textContent = '';
  document.getElementById('tegel-count').textContent = 'Geen toegang';
  document.getElementById('personeel-list').innerHTML = '<div class="empty-state">Alleen Full Acces-accounts kunnen gebruikers beheren.</div>';
  document.querySelectorAll('#screen-personeel input, #screen-personeel select, #screen-personeel button').forEach(function (element) {
    if (element.classList.contains('modal-x') || element.classList.contains('btn-cancel')) return;
    element.disabled = true;
  });
}

function render() {
  var list = document.getElementById('personeel-list');
  var activeCount = team.filter(function (persoon) { return persoon.status === 'active'; }).length;
  document.getElementById('list-count').textContent = activeCount + ' actief';
  document.getElementById('tegel-count').textContent = team.length + ' medewerker' + (team.length !== 1 ? 's' : '');
  if (!canManageUsers) {
    renderAccessDenied();
    return;
  }
  if (team.length === 0) {
    list.innerHTML = '<div class="empty-state">Nog geen medewerkers.</div>';
    return;
  }
  list.innerHTML = team.map(function (persoon) {
    return '<div class="person-row">'
      + '<div class="status-dot ' + persoon.status + '"></div>'
      + '<div class="person-avatar" style="background:' + getColor(persoon.id) + '">' + initials(persoon.voornaam || '', persoon.achternaam || '', persoon.email || '') + '</div>'
      + '<div class="person-info"><div class="person-name">' + escapeHtml(getDisplayName(persoon)) + '</div><div class="person-email">' + escapeHtml(persoon.email) + '</div></div>'
      + '<span class="role-badge role-' + persoon.rol + '">' + (persoon.rol === 'admin' ? 'Full Acces' : 'Medewerker') + '</span>'
      + '<div class="person-actions">'
      + '<button class="btn-icon" onclick="openEdit(\'' + escapeJsString(persoon.id) + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'
      + '<button class="btn-icon del" onclick="openDelete(\'' + escapeJsString(persoon.id) + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>'
      + '</div>'
      + '</div>';
  }).join('');
}

async function refreshTeam() {
  if (!canManageUsers) {
    renderAccessDenied();
    return;
  }
  var list = document.getElementById('personeel-list');
  list.innerHTML = '<div class="empty-state">Gebruikers laden...</div>';
  try {
    var payload = await fetchJson('/api/premium-users', { method: 'GET' });
    team = Array.isArray(payload.users) ? payload.users : [];
    render();
  } catch (error) {
    list.innerHTML = '<div class="empty-state">' + escapeHtml(error.message || 'Gebruikers laden mislukt.') + '</div>';
  }
}

function setAdminPinDescForTitle(title) {
  var descEl = document.getElementById('admin-pin-desc');
  if (!descEl) return;
  var t = String(title || '');
  if (t.indexOf('Toevoegen') !== -1) {
    descEl.textContent = 'Typ je zes cijfers. Daarna wordt de medewerker toegevoegd.';
  } else if (t.indexOf('Opslaan') !== -1) {
    descEl.textContent = 'Typ je zes cijfers. Daarna worden je wijzigingen opgeslagen.';
  } else {
    descEl.textContent = 'Typ je zes cijfers. Daarna wordt je actie uitgevoerd.';
  }
}

function clearAdminPinMsg() {
  var msg = document.getElementById('admin-pin-msg');
  if (msg) msg.textContent = '';
}

function requestAdminActionPin(title) {
  if (window.__premiumSettingsSessionActive && window.__premiumSettingsUnlockedPin) {
    return Promise.resolve(String(window.__premiumSettingsUnlockedPin));
  }
  return new Promise(function (resolve, reject) {
    if (adminPinPending) {
      reject(new Error('Bezig met bevestigen'));
      return;
    }
    adminPinPending = { resolve: resolve, reject: reject };
    var titleEl = document.getElementById('admin-pin-modal-title');
    if (titleEl) titleEl.textContent = 'PIN invoeren';
    setAdminPinDescForTitle(title);
    clearAdminPinMsg();
    var input = document.getElementById('admin-action-pin-input');
    if (input) input.value = '';
    updateAdminPinDots('');
    openOverlay('admin-pin-overlay');
  });
}

function cancelAdminActionPin() {
  closeOverlay('admin-pin-overlay');
  var input = document.getElementById('admin-action-pin-input');
  if (input) input.value = '';
  updateAdminPinDots('');
  clearAdminPinMsg();
  if (adminPinPending) {
    adminPinPending.reject(new Error('Geannuleerd'));
    adminPinPending = null;
  }
}

function confirmAdminActionPin() {
  if (!adminPinPending) return;
  var input = document.getElementById('admin-action-pin-input');
  var pin = input ? String(input.value || '').replace(/\D+/g, '').trim() : '';
  if (!pin) {
    return showToast('Pincode invullen');
  }
  if (pin.length !== 6) {
    return showToast('Pincode moet 6 cijfers zijn');
  }
  var resolve = adminPinPending.resolve;
  adminPinPending = null;
  clearAdminPinMsg();
  closeOverlay('admin-pin-overlay');
  if (input) input.value = '';
  updateAdminPinDots('');
  resolve(pin);
}

async function addPersoneel() {
  function value(id) {
    return document.getElementById(id).value.trim();
  }
  if (!canManageUsers) {
    return showToast('Alleen Full Acces-accounts kunnen gebruikers beheren');
  }
  var voornaam = value('new-voornaam');
  var email = value('new-email');
  var wachtwoord = document.getElementById('new-pw').value;
  var submitButton = document.querySelector('.btn-add');
  if (!voornaam || !email || !wachtwoord) {
    return showToast('Vul naam, e-mail en wachtwoord in');
  }
  if (wachtwoord.length < 8) {
    return showToast('Wachtwoord minimaal 8 tekens');
  }
  var actionConfirmPin;
  try {
    actionConfirmPin = await requestAdminActionPin('Toevoegen bevestigen');
  } catch (error) {
    if (error && error.message === 'Geannuleerd') return;
    showToast((error && error.message) || 'Bevestigen mislukt');
    return;
  }
  setPrimaryButtonLoading(submitButton, true, 'Toevoegen...');
  try {
    var payload = await fetchJson('/api/premium-users', {
      method: 'POST',
      body: JSON.stringify({
        voornaam: voornaam,
        achternaam: value('new-achternaam'),
        email: email,
        password: wachtwoord,
        rol: document.getElementById('new-rol').value,
        actionConfirmPin: actionConfirmPin
      })
    });
    team = Array.isArray(payload.users) ? payload.users : team;
    render();
    ['new-voornaam', 'new-achternaam', 'new-email', 'new-pw'].forEach(function (id) {
      document.getElementById(id).value = '';
    });
    showToast('✓ ' + voornaam + ' toegevoegd');
  } catch (error) {
    showToast(error.message || 'Toevoegen mislukt');
  } finally {
    setPrimaryButtonLoading(submitButton, false, 'Toevoegen');
  }
}

function openEdit(id) {
  var persoon = team.find(function (item) { return item.id === id; });
  if (!persoon || !canManageUsers) {
    return;
  }
  document.getElementById('edit-id').value = id;
  document.getElementById('edit-voornaam').value = persoon.voornaam || '';
  document.getElementById('edit-achternaam').value = persoon.achternaam || '';
  document.getElementById('edit-email').value = persoon.email || '';
  document.getElementById('edit-pw').value = '';
  document.getElementById('edit-rol').value = persoon.rol || 'medewerker';
  document.getElementById('edit-status').value = persoon.status || 'active';
  openOverlay('edit-overlay');
}

async function saveEdit() {
  if (!canManageUsers) {
    return showToast('Alleen Full Acces-accounts kunnen gebruikers beheren');
  }
  var id = document.getElementById('edit-id').value.trim();
  var email = document.getElementById('edit-email').value.trim();
  var wachtwoord = document.getElementById('edit-pw').value;
  var saveButton = document.querySelector('#edit-overlay .btn-save');
  if (!email) {
    return showToast('E-mail is verplicht');
  }
  if (wachtwoord && wachtwoord.length < 8) {
    return showToast('Wachtwoord minimaal 8 tekens');
  }
  var actionConfirmPin;
  try {
    actionConfirmPin = await requestAdminActionPin('Opslaan bevestigen');
  } catch (error) {
    if (error && error.message === 'Geannuleerd') return;
    showToast((error && error.message) || 'Bevestigen mislukt');
    return;
  }
  setPrimaryButtonLoading(saveButton, true, 'Opslaan...');
  try {
    var payload = await fetchJson('/api/premium-users/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: JSON.stringify({
        voornaam: document.getElementById('edit-voornaam').value.trim(),
        achternaam: document.getElementById('edit-achternaam').value.trim(),
        email: email,
        password: wachtwoord,
        rol: document.getElementById('edit-rol').value,
        status: document.getElementById('edit-status').value,
        actionConfirmPin: actionConfirmPin
      })
    });
    team = Array.isArray(payload.users) ? payload.users : team;
    render();
    closeOverlay('edit-overlay');
    showToast('✓ Opgeslagen');
  } catch (error) {
    showToast(error.message || 'Opslaan mislukt');
  } finally {
    setPrimaryButtonLoading(saveButton, false, 'Opslaan');
  }
}

function openDelete(id) {
  var persoon = team.find(function (item) { return item.id === id; });
  if (!persoon || !canManageUsers) {
    return;
  }
  pendingDelete = id;
  document.getElementById('confirm-name').textContent = getDisplayName(persoon);
  openOverlay('confirm-overlay');
}

async function confirmDelete() {
  if (!pendingDelete || !canManageUsers) {
    return;
  }
  var deleteButton = document.querySelector('#confirm-overlay .btn-del');
  setPrimaryButtonLoading(deleteButton, true, 'Verwijderen...');
  try {
    var payload = await fetchJson('/api/premium-users/' + encodeURIComponent(pendingDelete), {
      method: 'DELETE'
    });
    team = Array.isArray(payload.users) ? payload.users : team;
    pendingDelete = null;
    render();
    closeOverlay('confirm-overlay');
    showToast('✓ Verwijderd');
  } catch (error) {
    showToast(error.message || 'Verwijderen mislukt');
  } finally {
    setPrimaryButtonLoading(deleteButton, false, 'Verwijderen');
  }
}

function openOverlay(id) {
  document.getElementById(id).classList.add('open');
}

function closeOverlay(id) {
  document.getElementById(id).classList.remove('open');
}

document.querySelectorAll('.overlay').forEach(function (overlay) {
  overlay.addEventListener('click', function (event) {
    if (event.target === overlay) {
      if (overlay.id === 'admin-pin-overlay') {
        cancelAdminActionPin();
        return;
      }
      overlay.classList.remove('open');
    }
  });
});

function adminPinSyncFromInput() {
  var input = document.getElementById('admin-action-pin-input');
  if (!input) return;
  var digits = String(input.value || '').replace(/\D+/g, '').slice(0, 6);
  input.value = digits;
  updateAdminPinDots(digits);
  return digits;
}

function adminPinAppendDigit(d) {
  if (!adminPinPending) return;
  var input = document.getElementById('admin-action-pin-input');
  if (!input) return;
  clearAdminPinMsg();
  var v = String(input.value || '').replace(/\D+/g, '');
  if (v.length >= 6) return;
  v += String(d || '').replace(/\D+/g, '').slice(0, 1);
  input.value = v.slice(0, 6);
  updateAdminPinDots(input.value);
  if (input.value.length === 6) {
    setTimeout(function () {
      confirmAdminActionPin();
    }, 120);
  }
}

function adminPinBackspace() {
  if (!adminPinPending) return;
  var input = document.getElementById('admin-action-pin-input');
  if (!input) return;
  clearAdminPinMsg();
  var v = String(input.value || '').replace(/\D+/g, '');
  input.value = v.slice(0, -1);
  updateAdminPinDots(input.value);
}

function adminPinClearDigits() {
  if (!adminPinPending) return;
  var input = document.getElementById('admin-action-pin-input');
  if (input) input.value = '';
  updateAdminPinDots('');
  clearAdminPinMsg();
}

var adminActionPinInput = document.getElementById('admin-action-pin-input');
if (adminActionPinInput) {
  adminActionPinInput.addEventListener('input', function () {
    adminPinSyncFromInput();
    var v = String(adminActionPinInput.value || '');
    if (v.length === 6) {
      setTimeout(function () {
        confirmAdminActionPin();
      }, 120);
    }
  });
}

function updateAdminPinDots(value) {
  var dots = document.querySelectorAll('#admin-pin-dots .admin-pin-dot');
  var filled = String(value || '').length;
  dots.forEach(function (dot, index) {
    dot.classList.toggle('filled', index < filled);
  });
}

var adminPinNumpad = document.querySelector('#admin-pin-overlay .admin-pin-numpad');
if (adminPinNumpad) {
  adminPinNumpad.addEventListener('click', function (event) {
    var digitBtn = event.target.closest('[data-admin-pin-digit]');
    if (digitBtn && digitBtn.getAttribute('data-admin-pin-digit') != null) {
      adminPinAppendDigit(digitBtn.getAttribute('data-admin-pin-digit'));
      return;
    }
    if (event.target.closest('[data-admin-pin-back]')) {
      adminPinBackspace();
      return;
    }
    if (event.target.closest('[data-admin-pin-clear]')) {
      adminPinClearDigits();
    }
  });
}

document.addEventListener('keydown', function (event) {
  var overlay = document.getElementById('admin-pin-overlay');
  if (!overlay || !overlay.classList.contains('open')) return;
  if (!adminPinPending) return;
  if (event.key >= '0' && event.key <= '9') {
    event.preventDefault();
    adminPinAppendDigit(event.key);
    return;
  }
  if (event.key === 'Backspace') {
    event.preventDefault();
    adminPinBackspace();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    adminPinClearDigits();
  }
});

function togglePw(inputId, btn) {
  var input = document.getElementById(inputId);
  var show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.innerHTML = show
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
}

function showToast(msg) {
  var toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(function () {
    toast.classList.remove('show');
  }, 2800);
}

function escapeJsString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

(async function bootstrapPersoneelManager() {
  try {
    var session = await fetchJson('/api/auth/session', { method: 'GET' });
    canManageUsers = Boolean(session.canManageUsers);
    if (canManageUsers) {
      await refreshTeam();
      return;
    }
    renderAccessDenied();
  } catch (error) {
    document.getElementById('personeel-list').innerHTML = '<div class="empty-state">' + escapeHtml(error.message || 'Instellingen laden mislukt.') + '</div>';
  }
})();
