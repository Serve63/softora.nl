(() => {
  'use strict';

  const MODELS = {
    comfora: {
      name: 'Comfora', code: 'CF-01', price: 2295,
      note: 'Zacht & ondersteunend',
      image: 'https://www.relaxst.nl/wp-content/uploads/2025/12/Relaxst-1-.jpg',
    },
    udenhout: {
      name: 'Udenhout', code: 'UN-01', price: 2343,
      note: 'Compact & stijlvol',
      image: 'https://www.relaxst.nl/wp-content/uploads/2024/11/Relaxst-1-12.jpg',
    },
    zeus: {
      name: 'Zeus', code: 'ZE-05', price: 3195,
      note: 'Ultiem sta-op comfort',
      image: 'https://www.relaxst.nl/wp-content/uploads/2025/12/Relaxst-1-40.jpg',
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
    S: { name: 'Compact', detail: 'Tot 1,68 m', seat: 'Zithoogte ca. 43 cm', price: 0 },
    M: { name: 'Comfort', detail: '1,68 – 1,83 m', seat: 'Zithoogte ca. 46 cm', price: 0 },
    L: { name: 'Ruim', detail: 'Vanaf 1,83 m', seat: 'Zithoogte ca. 49 cm', price: 95 },
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
    model: 'udenhout',
    upholstery: 'stof',
    color: 'zand',
    size: 'M',
    mechanism: '2motor',
    extras: new Set(['accu']),
  };

  const elements = {
    content: document.querySelector('#step-content'),
    currentStep: document.querySelector('#current-step-number'),
    previous: document.querySelector('#previous-step'),
    next: document.querySelector('#next-step'),
    mobileNext: document.querySelector('#mobile-next'),
    chairImage: document.querySelector('#chair-image'),
    modelName: document.querySelector('#selected-model-name'),
    modelCode: document.querySelector('#stage-model-code'),
    materialLabel: document.querySelector('#material-label'),
    materialSwatch: document.querySelector('#material-swatch'),
    materialChip: document.querySelector('#material-chip'),
    tags: document.querySelector('#selection-tags'),
    prices: [
      document.querySelector('#stage-price'),
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
    return MODELS[state.model].price
      + UPHOLSTERY[state.upholstery].price
      + SIZES[state.size].price
      + MECHANISMS[state.mechanism].price
      + extrasTotal;
  }

  function radioCard({ group, value, selected, title, note, price, image = '', className = '' }) {
    return `
      <label class="option-card ${className} ${selected ? 'is-selected' : ''}">
        <input type="radio" name="${group}" value="${value}" ${selected ? 'checked' : ''}>
        ${image ? `<img src="${image}" alt="" loading="lazy">` : ''}
        <span class="option-card-text"><strong>${title}</strong><small>${note}</small></span>
        ${typeof price === 'number' ? `<span class="option-card-price">${priceSuffix(price)}</span>` : ''}
      </label>`;
  }

  function renderModelStep() {
    return `
      <div class="step-intro"><h3>Welk model past bij jou?</h3><p>Dit zijn drie voorbeeldmodellen. De definitieve configurator kan het volledige assortiment slim filteren.</p></div>
      <div class="option-grid models">
        ${Object.entries(MODELS).map(([id, model]) => radioCard({
          group: 'model', value: id, selected: state.model === id, title: model.name,
          note: `Vanaf ${formatPrice(model.price)}`, image: model.image,
        })).join('')}
      </div>`;
  }

  function renderUpholsteryStep() {
    return `
      <div class="step-intro"><h3>Kies jouw bekleding</h3><p>Voel straks in de winkel de echte stalen. Hier zie je direct wat materiaal en kleur met de stoel doen.</p></div>
      <div class="choice-section">
        <p class="choice-label">Materiaal</p>
        <div class="option-grid">
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
      <div class="step-intro"><h3>Welke maat voelt goed?</h3><p>Een goede zithoogte ondersteunt je benen zonder drukpunten. In de winkel meten we dit altijd exact na.</p></div>
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
      <div class="step-intro"><h3>Maak comfort persoonlijk</h3><p>Kies eerst de bediening en voeg daarna functies toe die jouw dagelijkse comfort verbeteren.</p></div>
      <div class="choice-section">
        <p class="choice-label">Bediening</p>
        <div class="option-grid">
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
              <span class="option-card-text"><strong>${item.name}</strong><small>${item.note}<br>+ ${formatPrice(item.price)}</small></span>
              <span class="checkmark">✓</span>
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
      <div class="step-intro"><h3>Jouw stoel staat klaar</h3><p>Controleer je keuzes. In de definitieve versie kan deze configuratie direct naar de winkel of WooCommerce.</p></div>
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
        render();
      });
    });
  }

  function updateProductStage() {
    const model = MODELS[state.model];
    const color = COLORS[state.color];
    if (elements.chairImage.src !== model.image) {
      elements.chairImage.classList.add('is-changing');
      window.setTimeout(() => {
        elements.chairImage.src = model.image;
        elements.chairImage.alt = `${model.name} relaxstoel in de gekozen uitvoering`;
        elements.chairImage.classList.remove('is-changing');
      }, 160);
    }
    elements.modelName.textContent = model.name;
    elements.modelCode.textContent = `Model ${model.code}`;
    elements.materialLabel.textContent = `${UPHOLSTERY[state.upholstery].name} · ${color.name}`;
    elements.materialSwatch.style.background = color.hex;
    elements.prices.forEach((item) => { item.textContent = formatPrice(totalPrice()); });
    elements.tags.innerHTML = [
      `Maat ${state.size}`,
      MECHANISMS[state.mechanism].name,
      ...[...state.extras].map((id) => EXTRAS[id].name),
    ].map((label) => `<span>${label}</span>`).join('');
  }

  function render() {
    const renderers = [renderModelStep, renderUpholsteryStep, renderSizeStep, renderComfortStep, renderSummaryStep];
    elements.content.innerHTML = renderers[state.step - 1]();
    elements.currentStep.textContent = state.step;
    elements.previous.disabled = state.step === 1;
    elements.next.innerHTML = state.step === 5
      ? 'Plan gratis zitadvies <span aria-hidden="true">→</span>'
      : 'Volgende stap <span aria-hidden="true">→</span>';
    elements.mobileNext.innerHTML = state.step === 5
      ? 'Bekijk resultaat <span aria-hidden="true">→</span>'
      : 'Volgende <span aria-hidden="true">→</span>';
    document.querySelectorAll('[data-step-target]').forEach((button) => {
      const target = Number(button.dataset.stepTarget);
      button.classList.toggle('is-active', target === state.step);
      button.classList.toggle('is-complete', target < state.step);
      button.setAttribute('aria-current', target === state.step ? 'step' : 'false');
    });
    bindStepInputs();
    updateProductStage();
  }

  function goToStep(step) {
    state.step = Math.min(5, Math.max(1, step));
    render();
    if (window.innerWidth < 700) {
      document.querySelector('.builder-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function completeConfiguration() {
    elements.dialogSummary.innerHTML = `<div class="summary-card">${summaryRows()}</div>`;
    if (typeof elements.dialog.showModal === 'function') elements.dialog.showModal();
  }

  function advance() {
    if (state.step === 5) completeConfiguration();
    else goToStep(state.step + 1);
  }

  elements.previous.addEventListener('click', () => goToStep(state.step - 1));
  elements.next.addEventListener('click', advance);
  elements.mobileNext.addEventListener('click', advance);
  document.querySelectorAll('[data-step-target]').forEach((button) => {
    button.addEventListener('click', () => goToStep(Number(button.dataset.stepTarget)));
  });
  elements.dialog.querySelector('.dialog-close').addEventListener('click', () => elements.dialog.close());
  elements.dialog.querySelector('.dialog-primary').addEventListener('click', () => elements.dialog.close());
  elements.dialog.addEventListener('click', (event) => {
    if (event.target === elements.dialog) elements.dialog.close();
  });

  render();
})();
