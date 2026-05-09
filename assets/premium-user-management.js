// Premium gebruikersbeheer voor /premium-instellingen.

var team = [];
var pendingDelete = null;
var adminPinPending = null;
var canManageUsers = false;
var colors = ['#8b2252', '#16733c', '#1a5f7a', '#7b3f00', '#4a1a6b', '#b45a00'];
/** @type {'unchanged' | string} */
var editAvatarMutation = 'unchanged';
var editAvatarBaselineUrl = '';

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

function appendUserManagementTextElement(parent, tagName, className, text) {
  var el = document.createElement(tagName);
  if (className) el.className = className;
  el.textContent = String(text || '');
  parent.appendChild(el);
  return el;
}

function renderUserManagementEmptyState(container, message) {
  if (!container) return;
  var empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent = String(message || '');
  container.replaceChildren(empty);
}

function buildUserManagementRoleLabel(role) {
  return String(role || '').trim().toLowerCase() === 'admin' ? 'Full Acces' : 'Medewerker';
}

function buildUserManagementSidebarRenderKey(session) {
  var displayName = String((session && session.displayName) || 'Softora Premium').trim() || 'Softora Premium';
  var role = String((session && session.role) || 'admin').trim().toLowerCase() || 'admin';
  var avatarDataUrl = String((session && session.avatarDataUrl) || '').trim();
  return [displayName, role, avatarDataUrl].join('\u0001');
}

function syncPremiumSidebarAfterUserManagementSave(session) {
  if (!session || !session.authenticated) return false;
  var nameEl = document.querySelector('[data-sidebar-user-name]');
  var roleEl = document.querySelector('[data-sidebar-user-role]');
  var avatarEl = document.querySelector('[data-sidebar-avatar]');
  var sidebar = document.querySelector('.sidebar');
  if (!nameEl || !roleEl || !avatarEl) return true;

  var displayName = String(session.displayName || 'Softora Premium').trim() || 'Softora Premium';
  var avatarDataUrl = String(session.avatarDataUrl || '').trim();
  nameEl.textContent = displayName;
  roleEl.textContent = buildUserManagementRoleLabel(session.role);
  avatarEl.replaceChildren();
  if (avatarDataUrl) {
    var img = document.createElement('img');
    img.src = avatarDataUrl;
    img.alt = displayName + ' profielfoto';
    img.loading = 'eager';
    img.decoding = 'async';
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = initials(session.firstName || '', session.lastName || '', session.email || '');
  }
  if (sidebar) {
    sidebar.dataset.sidebarProfileRenderKey = buildUserManagementSidebarRenderKey(session);
  }
  return true;
}

function createUserManagementSvgElement(tagName, attributes) {
  var svgNs = 'http://www.w3.org/2000/svg';
  var el = document.createElementNS(svgNs, tagName);
  Object.keys(attributes || {}).forEach(function (key) {
    el.setAttribute(key, attributes[key]);
  });
  return el;
}

function createUserManagementIcon(kind) {
  var svg = createUserManagementSvgElement('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'aria-hidden': 'true'
  });

  if (kind === 'delete') {
    svg.appendChild(createUserManagementSvgElement('polyline', {
      points: '3 6 5 6 21 6'
    }));
    svg.appendChild(createUserManagementSvgElement('path', {
      d: 'M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2'
    }));
    return svg;
  }

  svg.appendChild(createUserManagementSvgElement('path', {
    d: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7'
  }));
  svg.appendChild(createUserManagementSvgElement('path', {
    d: 'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z'
  }));
  return svg;
}

function createPasswordVisibilityIcon(isVisible) {
  var svg = createUserManagementSvgElement('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'aria-hidden': 'true'
  });

  if (isVisible) {
    svg.appendChild(createUserManagementSvgElement('path', {
      d: 'M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24'
    }));
    svg.appendChild(createUserManagementSvgElement('line', {
      x1: '1',
      y1: '1',
      x2: '23',
      y2: '23'
    }));
    return svg;
  }

  svg.appendChild(createUserManagementSvgElement('path', {
    d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'
  }));
  svg.appendChild(createUserManagementSvgElement('circle', {
    cx: '12',
    cy: '12',
    r: '3'
  }));
  return svg;
}

function createUserManagementIconButton(kind, label, onClick) {
  var button = document.createElement('button');
  button.type = 'button';
  button.className = kind === 'delete' ? 'btn-icon del' : 'btn-icon';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.appendChild(createUserManagementIcon(kind));
  button.addEventListener('click', onClick);
  return button;
}

function normalizePersonStatusClass(value) {
  return String(value || '').trim() === 'active' ? 'active' : 'inactive';
}

function normalizePersonRoleClass(value) {
  return String(value || '').trim() === 'admin' ? 'admin' : 'medewerker';
}

function createPersonRow(persoon) {
  var id = String(persoon && persoon.id || '');
  var roleClass = normalizePersonRoleClass(persoon && persoon.rol);
  var avatarDataUrl = String((persoon && persoon.avatarDataUrl) || '').trim();
  var row = document.createElement('div');
  row.className = 'person-row';

  var status = document.createElement('div');
  status.className = 'status-dot ' + normalizePersonStatusClass(persoon && persoon.status);
  row.appendChild(status);

  var avatar = document.createElement('div');
  avatar.className = 'person-avatar';
  avatar.style.background = getColor(id);
  avatar.style.overflow = 'hidden';
  if (avatarDataUrl) {
    var avatarImg = document.createElement('img');
    avatarImg.src = avatarDataUrl;
    avatarImg.alt = getDisplayName(persoon) + ' profielfoto';
    avatarImg.loading = 'lazy';
    avatarImg.decoding = 'async';
    avatarImg.style.width = '100%';
    avatarImg.style.height = '100%';
    avatarImg.style.objectFit = 'cover';
    avatarImg.style.display = 'block';
    avatar.appendChild(avatarImg);
  } else {
    avatar.textContent = initials(persoon.voornaam || '', persoon.achternaam || '', persoon.email || '');
  }
  row.appendChild(avatar);

  var info = document.createElement('div');
  info.className = 'person-info';
  appendUserManagementTextElement(info, 'div', 'person-name', getDisplayName(persoon));
  appendUserManagementTextElement(info, 'div', 'person-email', persoon.email || '');
  row.appendChild(info);

  appendUserManagementTextElement(
    row,
    'span',
    'role-badge role-' + roleClass,
    roleClass === 'admin' ? 'Full Acces' : 'Medewerker'
  );

  var actions = document.createElement('div');
  actions.className = 'person-actions';
  actions.appendChild(createUserManagementIconButton('edit', 'Medewerker bewerken', function () {
    openEdit(id);
  }));
  actions.appendChild(createUserManagementIconButton('delete', 'Medewerker verwijderen', function () {
    openDelete(id);
  }));
  row.appendChild(actions);

  return row;
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
    var bootApi = window.SoftoraPremiumBoot;
    if (bootApi && typeof bootApi.setShellBooting === 'function') {
      bootApi.setShellBooting(true);
    }
    refreshTeam().finally(function () {
      if (bootApi && typeof bootApi.setShellBooting === 'function') {
        bootApi.setShellBooting(false);
      }
    });
  }
}

function backToInstellingenOverzicht() {
  try {
    closeOverlay('edit-overlay');
    closeOverlay('confirm-overlay');
  } catch (e) { /* ignore */ }
  goTo('screen-overzicht');
}

function mountExtraSettingsCategory() {
  var overviewScreen = document.getElementById('screen-overzicht');
  var personnelTile = overviewScreen && overviewScreen.querySelector('.tegel[data-settings-action="open-pin"]');
  if (!overviewScreen || !personnelTile || document.getElementById('screen-extra')) return;

  var extraItems = [
    "Servé's gezondheidsdossier",
    'Ruben zet toto',
    'world watcher',
    'Flynow',
    'Transfermarkt',
    'Net Worth Index',
    'Pulse',
    'Ruben’s Company',
    'Ruben’s Trading System',
  ];

  if (!document.getElementById('settings-extra-style')) {
    var style = document.createElement('style');
    style.id = 'settings-extra-style';
    style.textContent = [
      '.settings-tile-grid,.settings-extra-grid{display:grid;grid-template-columns:repeat(2,minmax(280px,280px));gap:20px;align-items:stretch;justify-content:start;}',
      '.settings-extra-grid{max-width:580px;}',
      '.settings-extra-card{cursor:default;}',
      '@media (max-width:720px){.settings-tile-grid,.settings-extra-grid{grid-template-columns:minmax(280px,280px);}}',
    ].join('');
    document.head.appendChild(style);
  }

  var tileParent = personnelTile.parentElement;
  if (tileParent) tileParent.classList.add('settings-tile-grid');

  var extraTile = document.createElement('button');
  extraTile.type = 'button';
  extraTile.className = 'tegel';
  extraTile.setAttribute('data-settings-extra-open', 'true');
  var arrowIcon = createUserManagementSvgElement('svg', {
    class: 'tegel-arrow',
    width: '16',
    height: '16',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'aria-hidden': 'true'
  });
  arrowIcon.appendChild(createUserManagementSvgElement('polyline', {
    points: '9 18 15 12 9 6'
  }));
  extraTile.appendChild(arrowIcon);

  var iconWrap = document.createElement('div');
  iconWrap.className = 'tegel-icon-wrap';
  var gridIcon = createUserManagementSvgElement('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'aria-hidden': 'true'
  });
  [
    ['4', '4'],
    ['14', '4'],
    ['4', '14'],
    ['14', '14']
  ].forEach(function (position) {
    gridIcon.appendChild(createUserManagementSvgElement('rect', {
      x: position[0],
      y: position[1],
      width: '6',
      height: '6',
      rx: '1.4'
    }));
  });
  iconWrap.appendChild(gridIcon);
  extraTile.appendChild(iconWrap);
  appendUserManagementTextElement(extraTile, 'div', 'tegel-label', 'Extra');
  appendUserManagementTextElement(
    extraTile,
    'div',
    'tegel-desc',
    'Losse interne modules en extra onderdelen die later verder ingevuld kunnen worden.'
  );
  appendUserManagementTextElement(extraTile, 'div', 'tegel-count', '9 onderdelen');
  extraTile.addEventListener('click', function () {
    goTo('screen-extra');
  });
  if (tileParent) tileParent.insertBefore(extraTile, personnelTile);

  var extraScreen = document.createElement('div');
  extraScreen.className = 'screen';
  extraScreen.id = 'screen-extra';

  var header = document.createElement('div');
  header.className = 'beheer-header';
  var headerText = document.createElement('div');
  appendUserManagementTextElement(headerText, 'div', 'beheer-title', 'Extra');
  appendUserManagementTextElement(headerText, 'div', 'beheer-subtitle', 'Interne modules en placeholders');
  header.appendChild(headerText);

  var headerActions = document.createElement('div');
  headerActions.className = 'beheer-header-actions';
  var backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'settings-lock-btn magnetic';
  backButton.setAttribute('data-settings-extra-back', 'true');
  backButton.title = 'Terug naar instellingenoverzicht';
  backButton.setAttribute('aria-label', 'Terug naar instellingen');
  var backIcon = createUserManagementSvgElement('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  });
  backIcon.appendChild(createUserManagementSvgElement('path', {
    d: 'M15 18l-6-6 6-6'
  }));
  backButton.appendChild(backIcon);
  backButton.appendChild(document.createTextNode('Naar instellingen'));
  backButton.addEventListener('click', backToInstellingenOverzicht);
  headerActions.appendChild(backButton);
  header.appendChild(headerActions);
  extraScreen.appendChild(header);

  var extraGrid = document.createElement('div');
  extraGrid.className = 'settings-extra-grid';
  extraItems.forEach(function (label, index) {
    var number = String(index + 1).padStart(2, '0');
    var card = document.createElement('div');
    card.className = 'tegel settings-extra-card';
    var moduleArrow = createUserManagementSvgElement('svg', {
      class: 'tegel-arrow',
      width: '16',
      height: '16',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'aria-hidden': 'true'
    });
    moduleArrow.appendChild(createUserManagementSvgElement('polyline', {
      points: '9 18 15 12 9 6'
    }));
    card.appendChild(moduleArrow);

    var moduleIconWrap = document.createElement('div');
    moduleIconWrap.className = 'tegel-icon-wrap';
    var moduleIcon = createUserManagementSvgElement('svg', {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.8',
      'aria-hidden': 'true'
    });
    moduleIcon.appendChild(createUserManagementSvgElement('rect', {
      x: '4',
      y: '4',
      width: '16',
      height: '16',
      rx: '3'
    }));
    moduleIcon.appendChild(createUserManagementSvgElement('path', {
      d: 'M8 9h8M8 13h5'
    }));
    moduleIconWrap.appendChild(moduleIcon);
    card.appendChild(moduleIconWrap);

    appendUserManagementTextElement(card, 'div', 'tegel-label', label);
    appendUserManagementTextElement(card, 'div', 'tegel-desc', 'Interne template-module die later verder ingevuld kan worden.');
    appendUserManagementTextElement(card, 'div', 'tegel-count', 'Extra ' + number);
    extraGrid.appendChild(card);
  });
  extraScreen.appendChild(extraGrid);
  overviewScreen.insertAdjacentElement('afterend', extraScreen);
}

function renderAccessDenied() {
  document.getElementById('list-count').textContent = '';
  document.getElementById('tegel-count').textContent = 'Geen toegang';
  renderUserManagementEmptyState(
    document.getElementById('personeel-list'),
    'Alleen Full Acces-accounts kunnen gebruikers beheren.'
  );
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
    renderUserManagementEmptyState(list, 'Nog geen medewerkers.');
    return;
  }
  list.replaceChildren(...team.map(createPersonRow));
}

async function refreshTeam() {
  if (!canManageUsers) {
    renderAccessDenied();
    return;
  }
  var list = document.getElementById('personeel-list');
  renderUserManagementEmptyState(list, 'Gebruikers laden...');
  try {
    var payload = await fetchJson('/api/premium-users', { method: 'GET' });
    team = Array.isArray(payload.users) ? payload.users : [];
    render();
  } catch (error) {
    renderUserManagementEmptyState(list, error.message || 'Gebruikers laden mislukt.');
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

function resizeImageToJpegDataUrl(file, maxDim, quality, callback) {
  var reader = new FileReader();
  reader.onload = function () {
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      var scale = Math.min(1, maxDim / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale));
      var ch = Math.max(1, Math.round(h * scale));
      var canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      var dataUrl;
      try {
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      } catch (err) {
        callback(err);
        return;
      }
      callback(null, dataUrl);
    };
    img.onerror = function () {
      callback(new Error('Afbeelding'));
    };
    img.src = reader.result;
  };
  reader.onerror = function () {
    callback(new Error('Lezen mislukt'));
  };
  reader.readAsDataURL(file);
}

function paintEditAvatarPreview() {
  var wrap = document.getElementById('edit-avatar-preview');
  if (!wrap) return;
  var id = document.getElementById('edit-id') && document.getElementById('edit-id').value;
  var vn = document.getElementById('edit-voornaam').value.trim();
  var an = document.getElementById('edit-achternaam').value.trim();
  var em = document.getElementById('edit-email').value.trim();
  var inn = initials(vn || ' ', an || ' ', em);
  wrap.replaceChildren();
  var src = '';
  var showImg = false;
  if (typeof editAvatarMutation === 'string') {
    src = editAvatarMutation;
    showImg = true;
  } else {
    src = editAvatarBaselineUrl || '';
    showImg = Boolean(src);
  }
  if (showImg && src) {
    var imgEl = document.createElement('img');
    imgEl.src = src;
    imgEl.alt = '';
    wrap.appendChild(imgEl);
  } else {
    var av = document.createElement('div');
    av.className = 'edit-avatar-initials';
    av.textContent = inn;
    av.style.background = getColor(id);
    wrap.appendChild(av);
  }
}

function pickEditAvatar() {
  var input = document.getElementById('edit-avatar-file');
  if (input) input.click();
}

function onEditAvatarPicked(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type)) {
    if (input) input.value = '';
    return showToast('Kies een PNG-, JPG-, WEBP- of GIF-bestand');
  }
  if (file.size > 6 * 1024 * 1024) {
    if (input) input.value = '';
    return showToast('Bestand te groot (max. 6 MB)');
  }
  resizeImageToJpegDataUrl(file, 480, 0.85, function (err, dataUrl) {
    if (input) input.value = '';
    if (err || !dataUrl) {
      return showToast('Afbeelding kon niet worden verwerkt');
    }
    if (dataUrl.length > 850000) {
      return showToast('Afbeelding te groot; kies een kleinere foto');
    }
    editAvatarMutation = dataUrl;
    paintEditAvatarPreview();
  });
}

function openEdit(id) {
  var persoon = team.find(function (item) { return item.id === id; });
  if (!persoon || !canManageUsers) {
    return;
  }
  editAvatarMutation = 'unchanged';
  editAvatarBaselineUrl = persoon.avatarDataUrl || '';
  var fileInput = document.getElementById('edit-avatar-file');
  if (fileInput) fileInput.value = '';
  document.getElementById('edit-id').value = id;
  document.getElementById('edit-voornaam').value = persoon.voornaam || '';
  document.getElementById('edit-achternaam').value = persoon.achternaam || '';
  document.getElementById('edit-email').value = persoon.email || '';
  document.getElementById('edit-pw').value = '';
  document.getElementById('edit-rol').value = persoon.rol || 'medewerker';
  document.getElementById('edit-status').value = persoon.status || 'active';
  paintEditAvatarPreview();
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
    var patchBody = {
      voornaam: document.getElementById('edit-voornaam').value.trim(),
      achternaam: document.getElementById('edit-achternaam').value.trim(),
      email: email,
      password: wachtwoord,
      rol: document.getElementById('edit-rol').value,
      status: document.getElementById('edit-status').value,
      actionConfirmPin: actionConfirmPin
    };
    if (editAvatarMutation !== 'unchanged') {
      patchBody.avatarDataUrl = editAvatarMutation;
    }
    var payload = await fetchJson('/api/premium-users/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: JSON.stringify(patchBody)
    });
    team = Array.isArray(payload.users) ? payload.users : team;
    render();
    closeOverlay('edit-overlay');
    showToast('✓ Opgeslagen');
    if (payload && payload.session) {
      syncPremiumSidebarAfterUserManagementSave(payload.session);
    }
    if (
      window.SoftoraPersonnelTheme &&
      typeof window.SoftoraPersonnelTheme.refreshPremiumSession === 'function'
    ) {
      void window.SoftoraPersonnelTheme.refreshPremiumSession();
    }
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
  btn.replaceChildren(createPasswordVisibilityIcon(show));
}

function showToast(msg) {
  var toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(function () {
    toast.classList.remove('show');
  }, 2800);
}

mountExtraSettingsCategory();

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
    renderUserManagementEmptyState(
      document.getElementById('personeel-list'),
      error.message || 'Instellingen laden mislukt.'
    );
  } finally {
    if (window.SoftoraPremiumBoot && typeof window.SoftoraPremiumBoot.setShellBooting === 'function') {
      window.SoftoraPremiumBoot.setShellBooting(false);
    }
  }
})();
