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
    { id: 'vaste-parfum-voorraad', title: 'Vaste Parfum voorraad', imageId: 'eigen-parfum' },
    { id: 'alle-formaten-scheermesjes', title: 'Alle formaten scheermesjes' },
    { id: 'gezichtsbeharing-naar-wens', title: 'Gezichtsbeharing naar wens' },
    { id: 'bestaanszekerheid-bedrijf', title: 'Bestaanszekerheid bedrijf' },
    { id: 'softora-apple-kwaliteit-software', title: 'Softora Apple kwaliteit software' },
    { id: 'softora-gpt-af', title: 'Softora GPT af', imageId: 'softora-apple-kwaliteit-software' },
    { id: 'impactbox-draaiend', title: 'Impactbox draaiend', imageId: 'softora-apple-kwaliteit-software' },
    { id: 'vitalora-draaiend', title: 'Vitalora draaiend', imageId: 'vitalora-draaiend' },
    { id: 'eigen-koophuis-kopen', title: 'Eigen koophuis kopen' },
    { id: 'leuke-vriendin', title: 'Leuke vriendin' },
    { id: 'eigen-cinema', title: 'Eigen Cinema' },
    { id: 'eigen-kantoor', title: 'Eigen kantoor' },
    { id: 'tv-scherm-op-kantoor', title: 'TV-scherm aan muur op kantoor', imageId: 'eigen-kantoor', officeDetail: 'tv' },
    { id: 'prikbord-op-kantoor', title: 'Prikbord op kantoor', imageId: 'eigen-kantoor', officeDetail: 'noticeboard' },
    { id: 'kapstok-op-kantoor', title: 'Kapstok op kantoor', imageId: 'eigen-kantoor', officeDetail: 'coat-rack' },
    { id: 'zelfde-bureau-als-martijn', title: 'Zelfde bureau als Martijn', imageId: 'eigen-kantoor', officeDetail: 'matching-desk' },
    { id: 'kantoor-aangekleed-met-planten', title: 'Kantoor aangekleed met planten', imageId: 'eigen-kantoor', officeDetail: 'plants' },
    { id: 'verfvlekken-weg', title: 'Verfvlekken weg', imageId: 'eigen-kantoor', officeDetail: 'clean-paint' },
    { id: 'boekhouding-naar-boven', title: 'Boekhouding verplaatst naar boven', imageId: 'eigen-kantoor', officeDetail: 'accounting-upstairs' },
    { id: 'kantoorpand-in-haaren', title: 'Kantoorpand in Haaren' },
    { id: 'nieuwe-whoop', title: 'Nieuwe Whoop' },
    { id: 'nieuwe-fiets', title: 'Nieuwe fiets' },
    { id: 'dertig-dagen-streak', title: '30 dagen streak' },
    { id: 'gezondheidscenter', title: 'Gezondheidscenter' },
    { id: 'serves-gezondheidsdossier', title: "Servé's gezondheidsdossier" },
    { id: 'ruben-zet-toto', title: 'Ruben zet toto' },
    { id: 'kantoor-a-af', title: 'Kantoor A af' },
    { id: 'kantoor-b-af', title: 'Kantoor B af' },
    { id: 'world-watcher', title: "Ruben's World Watcher" },
    { id: 'rubens-vakantieradar', title: "Ruben's vakantieradar" },
    { id: 'transfermarkt', title: 'Ruben Romano' },
    { id: 'rubens-company', title: 'Ruben’s Company' },
    { id: 'rubens-trading-system', title: 'Ruben’s Trading System' },
    { id: 'jurisalem-af', title: 'Jurisalem af' },
    { id: 'gewenst-lang-kapsel', title: 'Gewenst lang kapsel' },
    { id: 'gewenste-kledingkast', title: 'Gewenste kledingkast' },
    { id: 'droomfysiek-2028', title: 'Droomfysiek', timeframe: 2028, imageId: 'bodyfat-onder-13' },
    { id: 'tweede-haartransplantatie-2028', title: '2e haartransplantatie', timeframe: 2028, imageId: 'haartransplantatie' },
    { id: 'droomkapsel-2028', title: 'Droomkapsel', timeframe: 2028, imageId: 'gewenst-lang-kapsel' },
    { id: 'eigen-parfum-2028', title: 'Eigen parfum', timeframe: 2028, imageId: 'eigen-parfum' },
    { id: 'kledingstijl-upgraden-2028', title: 'Kledingstijl upgraden', timeframe: 2028, imageId: 'gewenste-kledingkast' },
    { id: 'inloopkast-2028', title: 'Inloopkast', timeframe: 2028, imageId: 'gewenste-kledingkast' },
    { id: 'eigen-automaat-2028', title: 'Eigen automaat', timeframe: 2028, imageId: 'eigen-automaat-rijden' },
    { id: 'starterswoning-kopen-2028', title: 'Starterswoning kopen', timeframe: 2028, imageId: 'eigen-koophuis-kopen' },
    { id: 'eigen-kantoor-2028', title: 'Eigen kantoor', timeframe: 2028, imageId: 'eigen-kantoor' },
    { id: 'maatpak-2028', title: 'Maatpak', timeframe: 2028, imageId: 'maatpak' },
    { id: 'fotomuur-2028', title: 'Fotomuur', timeframe: 2028, imageId: 'fotomuur' },
    { id: 'israel-bezoeken-2028', title: 'Israël bezoeken', timeframe: 2028, imageId: 'israel-bezoeken' },
    { id: 'wereldkaart-bezochte-landen-2028', title: "Ruben's wereldkaart", timeframe: 2028, imageId: 'wereldkaart-bezochte-landen' },
    { id: 'professionele-fotoshoot-2028', title: 'Professionele fotoshoot', timeframe: 2028, imageId: 'professionele-fotoshoot' },
    { id: 'persoonlijke-handtekening-2028', title: 'Persoonlijke handtekening', timeframe: 2028, imageId: 'persoonlijke-handtekening' },
    { id: 'sponsorbord-nemelaer-2028', title: 'Sponsorbord bij Nemelaer', timeframe: 2028, imageId: 'sponsorbord-nemelaer' },
    { id: 'vip-box-willem-2-2028', title: 'VIP-box Willem II', timeframe: 2028, imageId: 'vip-box-willem-2' },
    { id: 'instagram-post-2027', title: 'Jaarlijkse Instagram-post 2027', timeframe: 2028, imageId: 'jaarlijkse-instagram-post' },
    { id: 'instagram-post-2028', title: 'Jaarlijkse Instagram-post 2028', timeframe: 2028, imageId: 'jaarlijkse-instagram-post' },
    { id: 'sertraline-vrij', title: 'Sertraline vrij' },
    { id: 'gratis-opleiding-via-gemeente', title: 'Gratis opleiding via gemeente', imageId: 'jurisalem-af' },
    { id: 'silence-controle', title: 'Silence controle', imageId: 'silence-controle' },
    { id: 'funnel-sites-live', title: 'Funnel Sites Live', imageId: 'softora-apple-kwaliteit-software' },
    { id: 'vijf-dagen-streak', title: '5 dagen streak', imageId: 'dertig-dagen-streak' },
    { id: 'tien-dagen-streak', title: '10 dagen streak', imageId: 'dertig-dagen-streak' },
    { id: 'twintig-dagen-streak', title: '20 dagen streak', imageId: 'dertig-dagen-streak' },
    { id: 'vijftig-dagen-streak', title: '50 dagen streak', imageId: 'dertig-dagen-streak' },
    { id: 'honderd-dagen-streak', title: '100 dagen streak', imageId: 'dertig-dagen-streak' },
    { id: 'driehonderdvijfenzestig-dagen-streak', title: '365 dagen streak', imageId: 'dertig-dagen-streak' },
    { id: 'checkpoint-2028', title: '2028...', type: 'checkpoint', imageId: '2030' },
    { id: 'lijpe-instagram-feed-2035', title: 'Lijpe Instagram feed', subtitle: '3 posts · 6 slides', timeframe: 2035, imageId: 'lijpe-instagram-feed' },
    { id: 'eigen-boot-2035', title: 'Eigen boot', timeframe: 2035, imageId: 'eigen-boot' },
    { id: 'range-rover-sport-2035', title: 'Range Rover Sport kopen', timeframe: 2035, imageId: 'range-rover-sport' },
    { id: 'rolex-datejust-2035', title: 'Rolex Datejust kopen', timeframe: 2035, imageId: 'rolex-datejust' },
    { id: 'vip-box-psv-2035', title: 'VIP-box bij PSV', timeframe: 2035, imageId: 'vip-box-psv' },
    { id: 'instagram-post-2029', title: 'Jaarlijkse Instagram-post 2029', timeframe: 2035, imageId: 'jaarlijkse-instagram-post' },
    { id: 'instagram-post-2030', title: 'Jaarlijkse Instagram-post 2030', timeframe: 2035, imageId: 'jaarlijkse-instagram-post' },
    { id: 'vakantiehuis-kopen-2035', title: 'Vakantiehuis kopen', timeframe: 2035, imageId: 'vakantiehuis-kopen' },
    { id: 'huis-miljoen-plus-2035', title: 'Huis van €1 miljoen+ kopen', timeframe: 2035, imageId: 'huis-miljoen-plus' },
    { id: '2035', title: '2035...', type: 'destination', imageId: '2035' }
  ];
  const ORIGIN_CARD_ID = 'oktober-2024';
  const CHECKPOINT_CARD_ID = 'checkpoint-2028';
  const DESTINATION_CARD_ID = '2035';
  const FIXED_CARD_IDS = [ORIGIN_CARD_ID, CHECKPOINT_CARD_ID, DESTINATION_CARD_ID];
  const LEGACY_MISSION_ID = 'eigen-automaat-rijden';
  const DEFAULT_CARD_ORDER = CARD_CATALOG.map((card) => card.id);

  function normalizeOrder(value) {
    const validIds = new Set(DEFAULT_CARD_ORDER);
    const requestedOrder = Array.from(new Set((Array.isArray(value) ? value : [])
      .filter((id) => validIds.has(id) && ![ORIGIN_CARD_ID, DESTINATION_CARD_ID].includes(id))));
    const requestedCheckpointIndex = requestedOrder.indexOf(CHECKPOINT_CARD_ID);
    const requestedMissionOrder = requestedOrder.filter((id) => !FIXED_CARD_IDS.includes(id));
    const remainingOrder = DEFAULT_CARD_ORDER.filter((id) => (
      !FIXED_CARD_IDS.includes(id) && !requestedMissionOrder.includes(id)
    ));
    if (requestedCheckpointIndex < 0) {
      const missionOrder = requestedMissionOrder.concat(remainingOrder);
      const through2028 = missionOrder.filter((id) => CARD_CATALOG.find((card) => card.id === id)?.timeframe !== 2035);
      const through2035 = missionOrder.filter((id) => CARD_CATALOG.find((card) => card.id === id)?.timeframe === 2035);
      return [ORIGIN_CARD_ID, ...through2028, CHECKPOINT_CARD_ID, ...through2035, DESTINATION_CARD_ID];
    }
    const requestedThrough2028 = requestedOrder
      .slice(0, requestedCheckpointIndex)
      .filter((id) => !FIXED_CARD_IDS.includes(id));
    const requestedThrough2035 = requestedOrder
      .slice(requestedCheckpointIndex + 1)
      .filter((id) => !FIXED_CARD_IDS.includes(id));
    const missingThrough2028 = remainingOrder.filter((id) => CARD_CATALOG.find((card) => card.id === id)?.timeframe !== 2035);
    const missingThrough2035 = remainingOrder.filter((id) => CARD_CATALOG.find((card) => card.id === id)?.timeframe === 2035);
    return [
      ORIGIN_CARD_ID,
      ...requestedThrough2028,
      ...missingThrough2028,
      CHECKPOINT_CARD_ID,
      ...requestedThrough2035,
      ...missingThrough2035,
      DESTINATION_CARD_ID
    ];
  }

  function normalizeCardState(value) {
    return { completed: value?.completed === true, deleted: value?.deleted === true };
  }

  function normalizeState(value, legacyMissionState) {
    const normalized = Object.fromEntries(CARD_CATALOG.map((card) => [
      card.id,
      FIXED_CARD_IDS.includes(card.id)
        ? { completed: false, deleted: false }
        : normalizeCardState(card.id === LEGACY_MISSION_ID && !value?.[card.id] ? legacyMissionState : value?.[card.id])
    ]));
    normalized.__order = normalizeOrder(value?.__order);
    return normalized;
  }

  function groupByCompletion(cardIds, value) {
    const visibleCardIds = cardIds.filter((cardId) => !value[cardId]?.deleted);
    return visibleCardIds
      .filter((cardId) => value[cardId]?.completed)
      .concat(visibleCardIds.filter((cardId) => !value[cardId]?.completed));
  }

  function getDisplayOrder(value) {
    const normalized = normalizeState(value);
    const checkpointIndex = normalized.__order.indexOf(CHECKPOINT_CARD_ID);
    const through2028 = normalized.__order.slice(1, checkpointIndex);
    const through2035 = normalized.__order.slice(checkpointIndex + 1, -1);
    return [
      ORIGIN_CARD_ID,
      ...groupByCompletion(through2028, normalized),
      CHECKPOINT_CARD_ID,
      ...groupByCompletion(through2035, normalized),
      DESTINATION_CARD_ID
    ];
  }

  function mergeVisibleOrderWithHidden(value, visibleOrder) {
    const normalized = normalizeState(value);
    const visibleIds = new Set(visibleOrder);
    const currentCheckpointIndex = normalized.__order.indexOf(CHECKPOINT_CARD_ID);
    const visibleCheckpointIndex = visibleOrder.indexOf(CHECKPOINT_CARD_ID);
    if (visibleCheckpointIndex < 0) {
      const hiddenOrder = normalized.__order.filter((id) => !visibleIds.has(id));
      return normalizeOrder(visibleOrder.concat(hiddenOrder));
    }
    const hiddenThrough2028 = normalized.__order
      .slice(1, currentCheckpointIndex)
      .filter((id) => !visibleIds.has(id));
    const hiddenThrough2035 = normalized.__order
      .slice(currentCheckpointIndex + 1, -1)
      .filter((id) => !visibleIds.has(id));
    return normalizeOrder([
      ...visibleOrder.slice(0, visibleCheckpointIndex),
      ...hiddenThrough2028,
      CHECKPOINT_CARD_ID,
      ...visibleOrder.slice(visibleCheckpointIndex + 1),
      ...hiddenThrough2035
    ]);
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
    const imageId = card.imageId || card.id;
    const officeDetail = document.createElement('span');
    const shade = document.createElement('div');
    const top = document.createElement('span');
    const title = document.createElement('strong');
    const subtitle = document.createElement('span');
    const missionCopy = document.createElement('span');
    const mission = document.createElement('span');
    const target = document.createElement('span');
    artwork.className = 'end-game-card-photo';
    image.className = 'end-game-card-photo-image';
    image.src = `/assets/live-momentum-endgame-cards/${imageId}.png?v=20260818a`;
    image.alt = '';
    image.width = 205;
    image.height = 307;
    image.loading = 'lazy';
    image.decoding = 'async';
    if (['kantoorpand-in-haaren', 'eigen-koophuis-kopen'].includes(imageId)) {
      artwork.classList.add('end-game-card-photo--edge-crop');
    }
    if (card.officeDetail) {
      artwork.classList.add(`end-game-card-photo--office-${card.officeDetail}`);
      officeDetail.className = `end-game-card-office-detail end-game-card-office-detail--${card.officeDetail}`;
      officeDetail.setAttribute('aria-hidden', 'true');
    }
    shade.className = 'end-game-card-photo-shade';
    top.className = 'end-game-card-kicker';
    top.textContent = card.type === 'origin'
      ? 'STARTPUNT'
      : card.type === 'checkpoint'
        ? 'CHECKPOINT'
      : card.type === 'destination'
        ? 'EINDPUNT'
        : card.timeframe
          ? `TOT ${card.timeframe}`
          : 'END GAME';
    title.className = 'end-game-card-name';
    title.textContent = card.title;
    subtitle.className = 'end-game-card-subtitle';
    subtitle.textContent = card.subtitle || '';
    missionCopy.className = 'end-game-card-mission-copy';
    missionCopy.textContent = card.missionText || '';
    if (['origin', 'checkpoint', 'destination'].includes(card.type)) {
      const specialLabel = document.createElement('span');
      specialLabel.className = `end-game-card-special-label end-game-card-${card.type}-label`;
      specialLabel.textContent = card.type === 'origin'
        ? 'HIER BEGON HET'
        : card.type === 'checkpoint'
          ? 'OP NAAR 2035'
          : 'UITGESPEELD..';
      artwork.classList.add(`end-game-card-photo--${card.type}`);
      artwork.append(image, shade, top, title, specialLabel);
    } else {
      mission.className = 'end-game-card-mission';
      mission.textContent = 'MISSIE';
      target.className = 'end-game-card-target';
      target.append(createTargetIcon());
      artwork.append(image);
      if (card.officeDetail) artwork.append(officeDetail);
      artwork.append(shade, top, title);
      if (card.subtitle) artwork.append(subtitle);
      if (card.missionText) artwork.append(missionCopy);
      artwork.append(mission, target);
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

  function getMissionAriaLabel(card, state, missionNumber) {
    const missionText = card.missionText ? ` ${card.missionText}` : '';
    return state.completed
      ? `Missie ${missionNumber}: ${card.title}.${missionText} Afgerond. Sleep om te verplaatsen of klik voor acties.`
      : `Missie ${missionNumber}: ${card.title}.${missionText} Sleep om te verplaatsen of klik voor acties.`;
  }

  function createCard(card, state, missionNumber) {
    const slot = document.createElement('div');
    const article = document.createElement('article');
    const isOrigin = card.type === 'origin';
    const isCheckpoint = card.type === 'checkpoint';
    const isDestination = card.type === 'destination';
    const isFixed = isOrigin || isCheckpoint || isDestination;
    slot.className = `end-game-card-slot${isOrigin ? ' end-game-card-slot--origin' : ''}${isCheckpoint ? ' end-game-card-slot--checkpoint' : ''}${isDestination ? ' end-game-card-slot--destination' : ''}`;
    slot.dataset.endGameCardId = card.id;
    article.className = `end-game-goal-card end-game-goal-card--mission${isOrigin ? ' end-game-goal-card--origin' : ''}${isCheckpoint ? ' end-game-goal-card--checkpoint' : ''}${isDestination ? ' end-game-goal-card--destination' : ''}`;
    if (isFixed) {
      slot.dataset.endGameCardFixed = 'true';
      slot.setAttribute('role', 'img');
      slot.setAttribute('aria-label', isOrigin
        ? 'Startpunt: Oktober 2024. Hier begon het. Deze kaart staat vast op de eerste positie.'
        : isCheckpoint
          ? 'Checkpoint: 2028. Op naar 2035. Deze kaart staat vast tussen de doelen tot 2028 en de doelen tot 2035.'
          : 'Eindpunt: 2035. Uitgespeeld. Deze kaart staat vast op de laatste positie.');
    } else {
      slot.tabIndex = 0;
      slot.setAttribute('role', 'button');
      slot.setAttribute('aria-haspopup', 'menu');
      slot.setAttribute('aria-expanded', 'false');
      slot.setAttribute('aria-label', getMissionAriaLabel(card, state, missionNumber));
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
      if (slot.classList.contains('end-game-card-slot--checkpoint')) missionNumber += 1;
      if (slot.dataset.endGameCardFixed === 'true') return;
      missionNumber += 1;
      const number = slot.querySelector('.end-game-card-number');
      const card = CARD_CATALOG.find((item) => item.id === slot.dataset.endGameCardId);
      if (number) number.textContent = String(missionNumber);
      if (card) slot.setAttribute('aria-label', slot.getAttribute('aria-label')
        .replace(/^Missie \d+:/, `Missie ${missionNumber}:`));
    });
  }

  function createController({ track, progressElement, isReady, onStateChange }) {
    let state = normalizeState();
    const interactions = window.SoftoraMomentumEndGameInteractions?.createController({
      track,
      scrollContainer: track.closest('.end-game-goals'),
      isReady,
      onOrderChange(visibleOrder) {
        state = { ...state, __order: mergeVisibleOrderWithHidden(state, visibleOrder) };
        arrangeVisibleCards();
        onStateChange({ immediate: true });
      }
    });

    function arrangeVisibleCards() {
      const cardElements = new Map(Array.from(track.querySelectorAll('[data-end-game-card-id]'))
        .map((element) => [element.dataset.endGameCardId, element]));
      const fragment = document.createDocumentFragment();
      getDisplayOrder(state).forEach((cardId) => {
        const cardElement = cardElements.get(cardId);
        if (cardElement) fragment.append(cardElement);
      });
      track.append(fragment);
      updateMissionNumbers(track);
    }

    function updateProgress() {
      const missionCards = CARD_CATALOG.filter((card) => (
        !FIXED_CARD_IDS.includes(card.id) && !state[card.id].deleted
      ));
      const completedCards = missionCards.filter((card) => state[card.id].completed).length;
      const percentage = missionCards.length ? Math.round((completedCards / missionCards.length) * 100) : 0;
      progressElement.style.setProperty('--end-game-progress', `${percentage}%`);
      progressElement.setAttribute('aria-valuenow', String(percentage));
      progressElement.setAttribute('aria-valuetext', `${completedCards} van ${missionCards.length} missies afgerond`);
      const value = document.querySelector('[data-end-game-progress-value]');
      if (value) value.textContent = `${percentage}%`;
    }

    function render(value = state) {
      state = normalizeState(value);
      const fragment = document.createDocumentFragment();
      let missionNumber = 0;
      getDisplayOrder(state).forEach((cardId) => {
        const card = CARD_CATALOG.find((item) => item.id === cardId);
        if (!card) return;
        if (state[card.id].deleted) return;
        if (![ORIGIN_CARD_ID, DESTINATION_CARD_ID].includes(card.id)) missionNumber += 1;
        fragment.append(createCard(card, state[card.id], missionNumber));
      });
      track.replaceChildren(fragment);
      updateProgress();
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

    function findCardElement(cardId) {
      return Array.from(track.querySelectorAll('[data-end-game-card-id]'))
        .find((element) => element.dataset.endGameCardId === cardId);
    }

    function syncCardElement(cardElement, cardId) {
      const card = CARD_CATALOG.find((item) => item.id === cardId);
      const cardState = state[cardId];
      if (!cardElement || !card || !cardState) return;
      const article = cardElement.querySelector('.end-game-goal-card');
      const actions = cardElement.querySelector('.end-game-mission-actions');
      const completeButton = actions?.querySelector('[data-end-game-card-action="toggle-complete"]');
      const missionNumber = Number(cardElement.querySelector('.end-game-card-number')?.textContent || 0);
      article?.classList.toggle('is-completed', cardState.completed);
      if (completeButton) {
        completeButton.textContent = cardState.completed ? 'Afronding ongedaan maken' : 'Afronden';
      }
      if (actions) actions.hidden = true;
      cardElement.setAttribute('aria-expanded', 'false');
      cardElement.setAttribute('aria-label', getMissionAriaLabel(card, cardState, missionNumber));
    }

    function updateCard(cardId, patch) {
      if (!state[cardId]) return;
      state = { ...state, [cardId]: normalizeCardState({ ...state[cardId], ...patch }) };
      const cardElement = findCardElement(cardId);
      if (state[cardId].deleted) {
        cardElement?.remove();
      } else {
        syncCardElement(cardElement, cardId);
      }
      arrangeVisibleCards();
      updateProgress();
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

  const api = { CARD_CATALOG, createController, getDisplayOrder, mergeVisibleOrderWithHidden, normalizeState };
  if (typeof window !== 'undefined') window.SoftoraMomentumEndGameCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
