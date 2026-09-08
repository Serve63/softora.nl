(() => {
  'use strict';

  const MODELS = {
    comfora: {
      name: 'Comfora', code: 'CF-01', price: 2295,
      note: 'Zacht & ondersteunend',
      image: '/assets/relaxst/chairs/comfora-original.jpg',
      variants: '/assets/relaxst/chairs/comfora-variants-v1.webp',
    },
    linea: {
      name: 'Linea', code: 'LI-02', price: 2343,
      note: 'Compact & stijlvol',
      image: '/assets/relaxst/chairs/linea-original.jpg',
      variants: '/assets/relaxst/chairs/linea-variants-v1.webp',
    },
    zeus: {
      name: 'Zeus', code: 'ZE-05', price: 3195,
      note: 'Ultiem sta-op comfort',
      image: '/assets/relaxst/chairs/zeus-original.jpg',
      variants: '/assets/relaxst/chairs/zeus-variants-v1.webp',
    },
  };

  const UPHOLSTERY = {
    stof: { name: 'Comfortstof', price: 0, note: 'Sterk, zacht en onderhoudsvriendelijk' },
    microleder: { name: 'Microleder', price: 295, note: 'Luxe uitstraling, praktisch in gebruik' },
    leer: { name: 'Premium leder', price: 695, note: 'Duurzaam Europees rundleder' },
  };

  const COLORS = {
    zand: { name: 'Zand', hex: '#c6ad92' },
    cognac: { name: 'Cognac', hex: '#a76137' },
    olijf: { name: 'Olijf', hex: '#74765f' },
    kiezel: { name: 'Kiezel', hex: '#aaa39a' },
    antraciet: { name: 'Antraciet', hex: '#4a4a49' },
  };

  const SIZES = {
    S: { name: 'Compact', detail: 'Tot 1,68 m', seat: 'Zithoogte ca. 43 cm', seatCm: 43, price: 0 },
    M: { name: 'Comfort', detail: '1,68 – 1,83 m', seat: 'Zithoogte ca. 46 cm', seatCm: 46, price: 0 },
    L: { name: 'Ruim', detail: 'Vanaf 1,83 m', seat: 'Zithoogte ca. 49 cm', seatCm: 49, price: 95 },
  };

  const MECHANISMS = {
    handmatig: { name: 'Handmatig', price: 0, note: 'Traploos verstelbaar met gasveer' },
    '2motor': { name: '2 motoren', price: 395, note: 'Rug en voeten los elektrisch verstelbaar' },
    '3motor': { name: '3 motoren + sta-op', price: 695, note: 'Inclusief comfortabele sta-opfunctie' },
    '5motor': { name: '5 motoren premium', price: 995, note: 'Volledig individueel verstelbaar' },
  };

  const EXTRAS = {
    accu: { name: 'Draadloze accu', price: 249, icon: '↯', note: 'Geen kabels door de kamer' },
    topswing: { name: 'Elektrische topswing', price: 179, icon: '⌁', note: 'Optimale ondersteuning voor je nek' },
    lendenpomp: { name: 'Lendenpomp', price: 149, icon: '≈', note: 'Extra steun in de onderrug' },
    verwarming: { name: 'Stoelverwarming', price: 195, icon: '☼', note: 'Aangename warmte in rug en zitting' },
  };

  const state = {
    step: 1,
    model: null,
    upholstery: null,
    color: null,
    size: null,
    mechanism: null,
    extras: new Set(),
  };

  const choices = { model: MODELS, upholstery: UPHOLSTERY, color: COLORS, size: SIZES, mechanism: MECHANISMS };
  const requiredChoices = [['model'], ['upholstery', 'color'], ['size'], ['mechanism']];
  function clearChoicesAfter(step) {
    requiredChoices.slice(step).flat().forEach((key) => { state[key] = null; });
    if (step < 4) state.extras.clear();
  }
  function isStepComplete(step) {
    return (requiredChoices[step - 1] || []).every((key) => state[key] !== null);
  }
  function firstIncompleteStep() {
    const index = requiredChoices.findIndex((_, index) => !isStepComplete(index + 1));
    return index === -1 ? 5 : index + 1;
  }
  try {
    const saved = JSON.parse(new URLSearchParams(window.location.search).get('config'));
    // Earlier links included automatic defaults, so they cannot prove a user's choices.
    if (saved && saved.version === 2) {
      for (const [index, keys] of requiredChoices.entries()) {
        if (index > 0 && !isStepComplete(index)) break;
        keys.forEach((key) => {
          if (typeof saved[key] === 'string' && Object.hasOwn(choices[key], saved[key])) state[key] = saved[key];
        });
      }
      if (firstIncompleteStep() >= 4 && Array.isArray(saved.extras)) {
        state.extras = new Set(saved.extras.filter((id) => typeof id === 'string' && Object.hasOwn(EXTRAS, id)));
      }
      state.step = Number.isInteger(saved.step)
        ? Math.min(firstIncompleteStep(), Math.max(1, saved.step)) : firstIncompleteStep();
      clearChoicesAfter(state.step);
    }
  } catch { /* An invalid configuration link starts with no selected options. */ }

  function saveConfiguration() {
    try {
      const url = new URL(window.location.href);
      const selected = Object.fromEntries(Object.keys(choices).filter((key) => state[key] !== null).map((key) => [key, state[key]]));
      url.searchParams.set('config', JSON.stringify({ version: 2, step: state.step, ...selected, extras: [...state.extras] }));
      window.history.replaceState(null, '', url);
    } catch { /* Downloading remains available if this browser cannot update the URL. */ }
  }

  const elements = {
    content: document.querySelector('#step-content'),
    currentStep: document.querySelector('#current-step-number'),
    previous: document.querySelector('#previous-step'),
    mobilePrevious: document.querySelector('#mobile-previous'),
    next: document.querySelector('#next-step'),
    mobileNext: document.querySelector('#mobile-next'),
    chairImage: document.querySelector('#chair-image'),
    chairFrame: document.querySelector('#chair-frame'),
    chairArtwork: document.querySelector('#chair-artwork'),
    sizeMarker: document.querySelector('#size-marker'),
    previewFeedback: document.querySelector('#preview-feedback'),
    modelName: document.querySelector('#selected-model-name'),
    modelCode: document.querySelector('#stage-model-code'),
    stageLabel: document.querySelector('#stage-label'),
    materialLabel: document.querySelector('#material-label'),
    materialSwatch: document.querySelector('#material-swatch'),
    materialChip: document.querySelector('#material-chip'),
    tags: document.querySelector('#selection-tags'),
    prices: [
      document.querySelector('#compact-price'),
      document.querySelector('#mobile-price'),
    ],
    dialog: document.querySelector('#success-dialog'),
    dialogSummary: document.querySelector('#dialog-summary'),
  };

  const euro = new Intl.NumberFormat('nl-NL', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
  });

  const formatPrice = (amount) => euro.format(amount);
  const priceSuffix = (price) => price ? `+ ${formatPrice(price)}` : 'Inbegrepen';

  function totalPrice() {
    const extrasTotal = [...state.extras].reduce((sum, id) => sum + EXTRAS[id].price, 0);
    return Object.entries(choices).reduce((total, [key, options]) => total + (options[state[key]]?.price || 0), extrasTotal);
  }

  function radioCard({ group, value, selected, title, note, price, image = '', className = '' }) {
    return `
      <label class="option-card ${className} ${selected ? 'is-selected' : ''}">
        <input type="radio" name="${group}" value="${value}" ${selected ? 'checked' : ''}>
        <span class="selection-indicator" aria-hidden="true">✓</span>
        ${image ? `<img src="${image}" alt="" loading="lazy">` : ''}
        <span class="option-card-text"><strong>${title}</strong><small>${note}</small></span>
        ${typeof price === 'number' ? `<span class="option-card-price">${priceSuffix(price)}</span>` : ''}
      </label>`;
  }

  function renderModelStep() {
    return `
      <div class="step-intro"><h3>Kies je model</h3><p>Selecteer je favoriete stoel. De bekleding en functies kies je hierna.</p></div>
      <div class="option-grid models">
        ${Object.entries(MODELS).map(([id, model]) => radioCard({
          group: 'model', value: id, selected: state.model === id, title: model.name,
          note: `Vanaf ${formatPrice(model.price)}`, image: model.image,
        })).join('')}
      </div>`;
  }

  function renderUpholsteryStep() {
    return `
      <div class="step-intro"><h3>Kies je bekleding</h3><p>Kies een materiaal en kleur. Je ziet je keuze meteen terug op de stoel.</p></div>
      <div class="choice-section">
        <p class="choice-label">Materiaal</p>
        <div class="option-grid upholstery-grid">
          ${Object.entries(UPHOLSTERY).map(([id, item]) => radioCard({
            group: 'upholstery', value: id, selected: state.upholstery === id,
            title: item.name, note: item.note, price: item.price,
          })).join('')}
        </div>
      </div>
      <div class="choice-section">
        <p class="choice-label">Kleur</p>
        <div class="swatches">
          ${Object.entries(COLORS).map(([id, item]) => `
            <label class="swatch-card ${state.color === id ? 'is-selected' : ''}">
              <input type="radio" name="color" value="${id}" ${state.color === id ? 'checked' : ''}>
              <span style="background:${item.hex}"></span><small>${item.name}</small>
            </label>`).join('')}
        </div>
      </div>`;
  }

  function renderSizeStep() {
    return `
      <div class="step-intro"><h3>Kies je maat</h3><p>Een goede zithoogte ondersteunt je benen zonder drukpunten. In de winkel meten we dit altijd exact na.</p></div>
      <div class="size-measure"><span aria-hidden="true">↕</span><div><b>Snelle maathulp</b><br>Kies voorlopig op lichaamslengte; de zitspecialist controleert de definitieve maat.</div></div>
      <div class="option-grid">
        ${Object.entries(SIZES).map(([id, item]) => radioCard({
          group: 'size', value: id, selected: state.size === id,
          title: `Maat ${id} · ${item.name}`, note: `${item.detail} · ${item.seat}`, price: item.price,
        })).join('')}
      </div>`;
  }

  function renderComfortStep() {
    return `
      <div class="step-intro"><h3>Kies je comfort</h3><p>Kies de bediening en voeg eventueel extra comfort toe.</p></div>
      <div class="choice-section">
        <p class="choice-label">Bediening</p>
        <div class="option-grid mechanism-grid">
          ${Object.entries(MECHANISMS).map(([id, item]) => radioCard({
            group: 'mechanism', value: id, selected: state.mechanism === id,
            title: item.name, note: item.note, price: item.price,
          })).join('')}
        </div>
      </div>
      <div class="choice-section">
        <p class="choice-label">Extra comfort</p>
        <div class="feature-grid">
          ${Object.entries(EXTRAS).map(([id, item]) => `
            <label class="option-card feature-card ${state.extras.has(id) ? 'is-selected' : ''}">
              <input type="checkbox" name="extra" value="${id}" ${state.extras.has(id) ? 'checked' : ''}>
              <span class="feature-icon" aria-hidden="true">${item.icon}</span>
              <span class="option-card-text"><strong>${item.name}</strong><small>${item.note} <span class="feature-price">+ ${formatPrice(item.price)}</span></small></span>
              <span class="checkmark" aria-hidden="true">✓</span>
            </label>`).join('')}
        </div>
      </div>`;
  }

  function summaryRows() {
    const extraNames = [...state.extras].map((id) => EXTRAS[id].name).join(', ') || 'Geen extra functies';
    return `
      <div class="summary-row"><span>Model</span><strong>${MODELS[state.model].name}</strong></div>
      <div class="summary-row"><span>Bekleding</span><strong>${UPHOLSTERY[state.upholstery].name} · ${COLORS[state.color].name}</strong></div>
      <div class="summary-row"><span>Maat</span><strong>${SIZES[state.size].name} (${state.size})</strong></div>
      <div class="summary-row"><span>Bediening</span><strong>${MECHANISMS[state.mechanism].name}</strong></div>
      <div class="summary-row"><span>Extra's</span><strong>${extraNames}</strong></div>
      <div class="summary-row summary-total"><span>Prijsindicatie incl. btw</span><strong>${formatPrice(totalPrice())}</strong></div>`;
  }

  function renderSummaryStep() {
    return `
      <div class="step-intro"><h3>Bekijk je samenstelling</h3><p>Controleer je keuzes en open het resultaat om je samenstelling te downloaden of zitadvies aan te vragen.</p></div>
      <div class="summary-card">${summaryRows()}</div>
      <p class="summary-note">Demo met voorbeeldprijzen. Definitieve prijs, levertijd en technische combinaties worden bepaald met de aangeleverde productdata.</p>`;
  }

  function bindStepInputs() {
    elements.content.querySelectorAll('input').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.name === 'extra') {
          input.checked ? state.extras.add(input.value) : state.extras.delete(input.value);
        } else {
          state[input.name] = input.value;
        }
        elements.content.querySelectorAll('input').forEach((choice) => {
          choice.closest('label').classList.toggle('is-selected', choice.checked);
        });
        updateProductStage();
        updateNavigation();
        saveConfiguration();
      });
    });
  }

  function updateProductStage() {
    const modelId = state.model || 'linea';
    const model = MODELS[modelId];
    const color = COLORS[state.color];
    const upholstery = UPHOLSTERY[state.upholstery];
    const size = SIZES[state.size];
    const showVariant = Boolean(state.model && (color || upholstery));
    const image = showVariant ? model.variants : model.image;
    // Sprite sheets let every color/material change render instantly after one image load.
    const column = Object.keys(COLORS).indexOf(state.color || 'zand');
    const row = Object.keys(UPHOLSTERY).indexOf(state.upholstery || 'stof');
    const framing = window.RelaxstChairFraming[modelId];
    const source = showVariant ? framing.variants : framing.original;
    const frame = source.frames[showVariant ? row * 5 + column : 0];
    const reference = framing.original.frames[0];
    // Keep the top, floor and pedestal fixed, including the original-to-variant switch.
    // Horizontal registration corrects the small width differences in generated tiles.
    const scaleY = 0.88 / (frame.bounds[3] - frame.bounds[1]);
    const footWidth = 0.88 * (reference.foot[2] - reference.foot[0]) / (reference.bounds[3] - reference.bounds[1]);
    const scaleX = footWidth / (frame.foot[2] - frame.foot[0]);
    const [tileLeft, tileTop, tileWidth, tileHeight] = frame.tile;
    Object.assign(elements.chairArtwork.style, {
      left: `${(0.5 + (tileLeft - (frame.foot[0] + frame.foot[2]) / 2) * scaleX) * 100}%`,
      top: `${(0.96 + (tileTop - frame.bounds[3]) * scaleY) * 100}%`,
      width: `${tileWidth * scaleX * 100}%`,
      height: `${tileHeight * scaleY * 100}%`,
    });
    elements.chairFrame.style.transform = `scale(${size ? size.seatCm / SIZES.L.seatCm : 1})`;
    // Clip one exact tile before positioning it, so adjacent chairs can never bleed in.
    Object.assign(elements.chairImage.style, {
      left: `${-tileLeft / tileWidth * 100}%`,
      top: `${-tileTop / tileHeight * 100}%`,
      width: `${source.width / tileWidth * 100}%`,
      height: `${source.height / tileHeight * 100}%`,
    });
    if (elements.chairImage.dataset.source !== image) {
      elements.chairImage.dataset.source = image;
      elements.previewFeedback.hidden = true;
      elements.chairImage.hidden = false;
      elements.chairImage.src = image;
    }
    elements.chairImage.alt = [
      `Relaxstoel ${model.name}`, upholstery?.name, color?.name, state.size && `maat ${state.size}`,
      showVariant ? 'digitale impressie' : 'voorbeeldfoto',
    ].filter(Boolean).join(' · ');
    elements.sizeMarker.hidden = !size;
    elements.sizeMarker.textContent = size ? `Zithoogte ca. ${size.seatCm} cm` : '';
    elements.modelName.textContent = model.name;
    elements.modelCode.textContent = `Model ${model.code}`;
    elements.stageLabel.textContent = state.model ? 'Jouw stoel' : 'Voorbeeldmodel';
    elements.materialChip.hidden = !upholstery && !color;
    elements.materialLabel.textContent = [upholstery?.name, color?.name].filter(Boolean).join(' · ');
    elements.materialSwatch.hidden = !color;
    elements.materialSwatch.style.background = color?.hex || '';
    elements.prices.forEach((item) => { item.textContent = state.model ? formatPrice(totalPrice()) : '—'; });
    elements.tags.innerHTML = [
      state.size && `Maat ${state.size}`,
      MECHANISMS[state.mechanism]?.name,
      ...[...state.extras].map((id) => EXTRAS[id].name),
    ].filter(Boolean).map((label) => `<span>${label}</span>`).join('');
    elements.tags.hidden = !elements.tags.innerHTML;
  }

  function updateNavigation() {
    elements.previous.disabled = state.step === 1;
    elements.mobilePrevious.disabled = state.step === 1;
    elements.next.disabled = !isStepComplete(state.step);
    elements.mobileNext.disabled = elements.next.disabled;
    elements.next.innerHTML = state.step === 5
      ? 'Bekijk resultaat <span aria-hidden="true">→</span>'
      : 'Volgende stap <span aria-hidden="true">→</span>';
    elements.mobileNext.innerHTML = state.step === 5
      ? 'Bekijk resultaat <span aria-hidden="true">→</span>'
      : 'Volgende <span aria-hidden="true">→</span>';
    document.querySelectorAll('[data-step-target]').forEach((button) => {
      const target = Number(button.dataset.stepTarget);
      button.classList.toggle('is-active', target === state.step);
      button.classList.toggle('is-complete', target < state.step && isStepComplete(target));
      button.setAttribute('aria-current', target === state.step ? 'step' : 'false');
      button.disabled = target > firstIncompleteStep();
    });
  }

  function render() {
    const renderers = [renderModelStep, renderUpholsteryStep, renderSizeStep, renderComfortStep, renderSummaryStep];
    elements.content.innerHTML = renderers[state.step - 1]();
    elements.currentStep.textContent = state.step;
    updateNavigation();
    bindStepInputs();
    updateProductStage();
  }

  function goToStep(step) {
    const target = Math.min(firstIncompleteStep(), Math.max(1, step));
    if (target < state.step) clearChoicesAfter(target);
    state.step = target;
    render();
    saveConfiguration();
    const heading = elements.content.querySelector('h3');
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
    if (window.innerWidth < 700) {
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
      document.querySelector('.builder-panel').scrollIntoView({ behavior, block: 'start' });
    }
  }

  function completeConfiguration() {
    if (firstIncompleteStep() !== 5) return;
    elements.dialogSummary.innerHTML = `<div class="summary-card">${summaryRows()}</div>`;
    const overview = [
      'Relaxst - jouw samenstelling (conceptdemo)', '',
      `Model: ${MODELS[state.model].name} (${MODELS[state.model].code})`,
      `Bekleding: ${UPHOLSTERY[state.upholstery].name} - ${COLORS[state.color].name}`,
      `Maat: ${state.size} - ${SIZES[state.size].name}`,
      `Bediening: ${MECHANISMS[state.mechanism].name}`,
      `Extra functies: ${[...state.extras].map((id) => EXTRAS[id].name).join(', ') || 'Geen'}`,
      `Prijsindicatie incl. btw: ${formatPrice(totalPrice())}`, '',
      'Voorbeeldprijzen en digitale impressie. Definitieve kleur, maat, prijs en technische combinaties worden door Relaxst bevestigd.',
      'Zitadvies aanvragen: https://www.relaxst.nl/afspraak/',
      'Dit overzicht is geen bestelling of afspraakbevestiging.',
    ].join('\n');
    const download = document.querySelector('#download-configuration');
    download.href = `data:text/plain;charset=utf-8,${encodeURIComponent(overview)}`;
    download.download = `Relaxst-${MODELS[state.model].name}-samenstelling.txt`;
    if (typeof elements.dialog.showModal === 'function') elements.dialog.showModal();
  }

  function advance() {
    if (!isStepComplete(state.step)) return;
    if (state.step === 5) completeConfiguration();
    else goToStep(state.step + 1);
  }

  elements.previous.addEventListener('click', () => goToStep(state.step - 1));
  elements.mobilePrevious.addEventListener('click', () => goToStep(state.step - 1));
  elements.next.addEventListener('click', advance);
  elements.mobileNext.addEventListener('click', advance);
  elements.chairImage.addEventListener('error', () => {
    elements.chairImage.hidden = true;
    elements.previewFeedback.hidden = false;
  });
  elements.chairImage.addEventListener('load', () => {
    elements.chairImage.hidden = false;
    elements.previewFeedback.hidden = true;
  });
  document.querySelectorAll('[data-step-target]').forEach((button) => {
    button.addEventListener('click', () => goToStep(Number(button.dataset.stepTarget)));
  });
  elements.dialog.querySelector('.dialog-close').addEventListener('click', () => elements.dialog.close());
  elements.dialog.querySelector('.dialog-primary').addEventListener('click', () => elements.dialog.close());
  elements.dialog.addEventListener('click', (event) => {
    if (event.target !== elements.dialog) return;
    const rect = elements.dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom) elements.dialog.close();
  });

  render();
  saveConfiguration();
})();
