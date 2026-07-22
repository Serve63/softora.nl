(() => {
  const CARD_CATALOG = [
    { id: 'oktober-2024', title: 'Oktober 2024…', type: 'origin' },
    { id: 'eigen-automaat-rijden', title: 'Eigen automaat rijden' },
    { id: 'prp-behandeling', title: 'PRP Behandeling' },
    { id: 'ketting-armband', title: 'Ketting & Armband' },
    { id: 'haartransplantatie', title: 'Haartransplantatie' },
    { id: 'bodyfat-onder-13', title: '<13% bodyfat' },
    { id: 'vijf-kilo-spiermassa', title: '+5KG Spiermassa' },
    { id: 'tanden-rechtzetten', title: 'Tanden rechtzetten' },
    { id: 'black-gel-voorraad', title: 'Black Gel voorraad' },
    { id: 'tandenbleek-voorraad', title: 'Tandenbleek voorraad' },
    { id: 'gezichtsbeharing-naar-wens', title: 'Gezichtsbeharing naar wens' },
    { id: 'bestaanszekerheid-bedrijf', title: 'Bestaanszekerheid bedrijf' },
    { id: 'eigen-koophuis-kopen', title: 'Eigen koophuis kopen' },
    { id: 'leuke-vriendin', title: 'Leuke vriendin' },
    { id: 'eigen-cinema', title: 'Eigen Cinema' },
    { id: 'eigen-kantoor', title: 'Eigen kantoor' },
    { id: 'kantoorpand-in-haaren', title: 'Kantoorpand in Haaren' },
    { id: 'nieuwe-whoop', title: 'Nieuwe Whoop' },
    { id: 'gezondheidscenter', title: 'Gezondheidscenter' },
    { id: 'serves-gezondheidsdossier', title: "Servé's gezondheidsdossier" },
    { id: 'ruben-zet-toto', title: 'Ruben zet toto' },
    { id: 'world-watcher', title: 'world watcher' },
    { id: 'transfermarkt', title: 'Transfermarkt' },
    { id: 'rubens-company', title: 'Ruben’s Company' },
    { id: 'rubens-trading-system', title: 'Ruben’s Trading System' },
    { id: 'gewenst-lang-kapsel', title: 'Gewenst lang kapsel' },
    { id: 'gewenste-kledingkast', title: 'Gewenste kledingkast' },
    { id: '2030', title: '2030...', type: 'destination' }
  ];
  const ORIGIN_CARD_ID = 'oktober-2024';
  const DESTINATION_CARD_ID = '2030';
  const LEGACY_MISSION_ID = 'eigen-automaat-rijden';
  const DEFAULT_CARD_ORDER = CARD_CATALOG.map((card) => card.id);

  function normalizeOrder(value) {
    const validIds = new Set(DEFAULT_CARD_ORDER);
    const requestedOrder = Array.from(new Set((Array.isArray(value) ? value : [])
      .filter((id) => validIds.has(id) && ![ORIGIN_CARD_ID, DESTINATION_CARD_ID].includes(id))));
    const remainingOrder = DEFAULT_CARD_ORDER.filter((id) => (
      ![ORIGIN_CARD_ID, DESTINATION_CARD_ID].includes(id) && !requestedOrder.includes(id)
    ));
    return [ORIGIN_CARD_ID, ...requestedOrder, ...remainingOrder, DESTINATION_CARD_ID];
  }

  function normalizeCardState(value) {
    return { completed: value?.completed === true, deleted: value?.deleted === true };
  }

  function normalizeState(value, legacyMissionState) {
    const normalized = Object.fromEntries(CARD_CATALOG.map((card) => [
      card.id,
      [ORIGIN_CARD_ID, DESTINATION_CARD_ID].includes(card.id)
        ? { completed: false, deleted: false }
        : normalizeCardState(card.id === LEGACY_MISSION_ID && !value?.[card.id] ? legacyMissionState : value?.[card.id])
    ]));
    normalized.__order = normalizeOrder(value?.__order);
    return normalized;
  }

  function createTargetIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<circle cx="11" cy="13" r="7"/><circle cx="11" cy="13" r="3"/><path d="m14 10 6-6m-4 0h4v4"/>';
    return svg;
  }

  function createCompletionOverlay() {
    const overlay = document.createElement('div');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const label = document.createElement('strong');
    overlay.className = 'end-game-mission-complete';
    overlay.setAttribute('aria-hidden', 'true');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<path d="m5 12.5 4.2 4.2L19 7" />';
    label.textContent = 'AFGEROND';
    overlay.append(icon, label);
    return overlay;
  }

  function createActions(card, completed) {
    const actions = document.createElement('div');
    const completeButton = document.createElement('button');
    const removeButton = document.createElement('button');
    actions.className = 'end-game-mission-actions';
    actions.hidden = true;
    actions.setAttribute('role', 'menu');
    actions.setAttribute('aria-label', `Acties voor ${card.title}`);
    completeButton.type = 'button';
    completeButton.setAttribute('role', 'menuitem');
    completeButton.dataset.endGameCardAction = 'toggle-complete';
    completeButton.textContent = completed ? 'Afronding ongedaan maken' : 'Afronden';
    removeButton.type = 'button';
    removeButton.className = 'is-remove';
    removeButton.setAttribute('role', 'menuitem');
    removeButton.dataset.endGameCardAction = 'remove';
    removeButton.dataset.confirmRemove = 'false';
    removeButton.textContent = 'Verwijderen';
    actions.append(completeButton, removeButton);
    return actions;
  }

  function createCardArtwork(card) {
    const artwork = document.createElement('div');
    const image = document.createElement('img');
    const shade = document.createElement('div');
    const top = document.createElement('span');
    const title = document.createElement('strong');
    const mission = document.createElement('span');
    const target = document.createElement('span');
    artwork.className = 'end-game-card-photo';
    image.className = 'end-game-card-photo-image';
    image.src = `/assets/live-momentum-endgame-cards/${card.id}.png?v=20260717c`;
    image.alt = '';
    image.width = 205;
    image.height = 307;
    image.loading = 'lazy';
    image.decoding = 'async';
    shade.className = 'end-game-card-photo-shade';
    top.className = 'end-game-card-kicker';
    top.textContent = card.type === 'origin' ? 'STARTPUNT' : card.type === 'destination' ? 'EINDPUNT' : 'END GAME';
    title.className = 'end-game-card-name';
    title.textContent = card.title;
    if (['origin', 'destination'].includes(card.type)) {
      const specialLabel = document.createElement('span');
      specialLabel.className = `end-game-card-special-label end-game-card-${card.type}-label`;
      specialLabel.textContent = card.type === 'origin' ? 'HIER BEGON HET' : 'WIE BEN IK DAN?';
      artwork.classList.add(`end-game-card-photo--${card.type}`);
      artwork.append(image, shade, top, title, specialLabel);
    } else {
      mission.className = 'end-game-card-mission';
      mission.textContent = 'MISSIE';
      target.className = 'end-game-card-target';
      target.append(createTargetIcon());
      artwork.append(image, shade, top, title, mission, target);
    }
    return artwork;
  }

  function createMissionNumber(number) {
    const label = document.createElement('span');
    label.className = 'end-game-card-number';
    label.textContent = String(number);
    label.setAttribute('aria-hidden', 'true');
    return label;
  }

  function createCard(card, state, missionNumber) {
    const slot = document.createElement('div');
    const article = document.createElement('article');
    const isOrigin = card.type === 'origin';
    const isDestination = card.type === 'destination';
    const isFixed = isOrigin || isDestination;
    slot.className = `end-game-card-slot${isOrigin ? ' end-game-card-slot--origin' : ''}${isDestination ? ' end-game-card-slot--destination' : ''}`;
    slot.dataset.endGameCardId = card.id;
    article.className = `end-game-goal-card end-game-goal-card--mission${isOrigin ? ' end-game-goal-card--origin' : ''}${isDestination ? ' end-game-goal-card--destination' : ''}`;
    if (isFixed) {
      slot.dataset.endGameCardFixed = 'true';
      slot.setAttribute('role', 'img');
      slot.setAttribute('aria-label', isOrigin
        ? 'Startpunt: Oktober 2024. Hier begon het. Deze kaart staat vast op de eerste positie.'
        : 'Eindpunt: 2030. Wie ben ik dan? Deze kaart staat vast op de laatste positie.');
    } else {
      slot.tabIndex = 0;
      slot.setAttribute('role', 'button');
      slot.setAttribute('aria-haspopup', 'menu');
      slot.setAttribute('aria-expanded', 'false');
      slot.setAttribute('aria-label', state.completed
        ? `Missie ${missionNumber}: ${card.title}, afgerond. Sleep om te verplaatsen of klik voor acties.`
        : `Missie ${missionNumber}: ${card.title}. Sleep om te verplaatsen of klik voor acties.`);
    }
    article.classList.toggle('is-completed', state.completed);
    article.append(createCardArtwork(card));
    if (!isFixed) article.append(createCompletionOverlay(), createActions(card, state.completed));
    slot.append(article);
    if (!isFixed) slot.append(createMissionNumber(missionNumber));
    return slot;
  }

  function updateMissionNumbers(track) {
    let missionNumber = 0;
    track.querySelectorAll('[data-end-game-card-id]').forEach((slot) => {
      if (slot.dataset.endGameCardFixed === 'true') return;
      missionNumber += 1;
      const number = slot.querySelector('.end-game-card-number');
      const card = CARD_CATALOG.find((item) => item.id === slot.dataset.endGameCardId);
      if (number) number.textContent = String(missionNumber);
      if (card) slot.setAttribute('aria-label', slot.getAttribute('aria-label')
        .replace(/^Missie \d+:/, `Missie ${missionNumber}:`));
    });
  }

  function createController({ track, isReady, onStateChange }) {
    let state = normalizeState();
    const interactions = window.SoftoraMomentumEndGameInteractions?.createController({
      track,
      scrollContainer: track.closest('.end-game-goals'),
      isReady,
      onOrderChange(visibleOrder) {
        updateMissionNumbers(track);
        const visibleIds = new Set(visibleOrder);
        const hiddenOrder = state.__order.filter((id) => !visibleIds.has(id));
        state = { ...state, __order: normalizeOrder(visibleOrder.concat(hiddenOrder)) };
        onStateChange();
      }
    });

    function render(value = state) {
      state = normalizeState(value);
      const fragment = document.createDocumentFragment();
      let missionNumber = 0;
      state.__order.forEach((cardId) => {
        const card = CARD_CATALOG.find((item) => item.id === cardId);
        if (!card) return;
        if (state[card.id].deleted) return;
        if (![ORIGIN_CARD_ID, DESTINATION_CARD_ID].includes(card.id)) missionNumber += 1;
        fragment.append(createCard(card, state[card.id], missionNumber));
      });
      track.replaceChildren(fragment);
    }

    function close(options = {}) {
      track.querySelectorAll('.end-game-mission-actions:not([hidden])').forEach((actions) => {
        const card = actions.closest('[data-end-game-card-id]');
        const removeButton = actions.querySelector('[data-end-game-card-action="remove"]');
        actions.hidden = true;
        card?.setAttribute('aria-expanded', 'false');
        if (removeButton) {
          removeButton.dataset.confirmRemove = 'false';
          removeButton.textContent = 'Verwijderen';
        }
        if (options.restoreFocus === true && card?.dataset.endGameCardId === options.cardId) card.focus();
      });
    }

    function open(cardElement) {
      if (!isReady()) return;
      const actions = cardElement.querySelector('.end-game-mission-actions');
      const completeButton = actions?.querySelector('[data-end-game-card-action="toggle-complete"]');
      if (!actions || !completeButton) return;
      close();
      actions.hidden = false;
      cardElement.setAttribute('aria-expanded', 'true');
      completeButton.focus();
    }

    function updateCard(cardId, patch) {
      if (!state[cardId]) return;
      state = { ...state, [cardId]: normalizeCardState({ ...state[cardId], ...patch }) };
      render(state);
      onStateChange();
    }

    track.addEventListener('click', (event) => {
      if (interactions?.shouldSuppressClick()) {
        event.preventDefault();
        return;
      }
      const action = event.target.closest('[data-end-game-card-action]');
      const cardElement = event.target.closest('[data-end-game-card-id]');
      const cardId = cardElement?.dataset.endGameCardId;
      if (!cardElement || !cardId || !state[cardId] || !isReady()) return;
      if (action) {
        event.stopPropagation();
        if (action.dataset.endGameCardAction === 'toggle-complete') {
          updateCard(cardId, { completed: !state[cardId].completed });
          return;
        }
        if (action.dataset.endGameCardAction === 'remove') {
          if (action.dataset.confirmRemove !== 'true') {
            action.dataset.confirmRemove = 'true';
            action.textContent = 'Nogmaals: verwijderen';
            return;
          }
          updateCard(cardId, { deleted: true });
        }
        return;
      }
      const actions = cardElement.querySelector('.end-game-mission-actions');
      if (actions?.hidden) open(cardElement); else close({ restoreFocus: true, cardId });
    });

    track.addEventListener('keydown', (event) => {
      const cardElement = event.target.closest('[data-end-game-card-id]');
      if (!cardElement) return;
      if (event.target === cardElement && [' ', 'Enter'].includes(event.key)) {
        event.preventDefault();
        open(cardElement);
      }
      if (event.key === 'Escape') close({ restoreFocus: true, cardId: cardElement.dataset.endGameCardId });
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('[data-end-game-card-id]')) close();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });

    return {
      getLegacyMissionState: () => ({ ...state[LEGACY_MISSION_ID] }),
      getState: () => ({
        ...Object.fromEntries(CARD_CATALOG.map((card) => [card.id, { ...state[card.id] }])),
        __order: [...state.__order]
      }),
      needsMigration: (value) => !value || typeof value !== 'object' || !Array.isArray(value.__order),
      normalize: normalizeState,
      render
    };
  }

  window.SoftoraMomentumEndGameCards = { CARD_CATALOG, createController, normalizeState };
})();
