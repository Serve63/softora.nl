(function () {
  const STARTING_CASH = 10000;

  const assets = [
    { symbol: 'SOFT', name: 'Softora Growth', price: 124.8, drift: 0.0009, volatility: 0.018 },
    { symbol: 'NOVA', name: 'Nova Cloud', price: 86.35, drift: 0.0005, volatility: 0.022 },
    { symbol: 'ATLS', name: 'Atlas Index', price: 241.2, drift: 0.0003, volatility: 0.011 },
    { symbol: 'GRDN', name: 'Green Grid', price: 42.75, drift: 0.0007, volatility: 0.026 },
    { symbol: 'ORBT', name: 'Orbit AI', price: 158.4, drift: 0.0002, volatility: 0.03 }
  ];

  const formatCurrency = new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR'
  });

  const formatPercent = new Intl.NumberFormat('nl-NL', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const fallbackState = {
    cash: STARTING_CASH,
    holdings: {},
    orders: [],
    selectedSymbol: 'SOFT',
    dayStartEquity: STARTING_CASH,
    prices: {},
    history: {}
  };

  const state = createInitialState();
  const elements = {
    assetSelect: document.getElementById('assetSelect'),
    cashBalance: document.getElementById('cashBalance'),
    totalEquity: document.getElementById('totalEquity'),
    investedValue: document.getElementById('investedValue'),
    profitLoss: document.getElementById('profitLoss'),
    riskFill: document.getElementById('riskFill'),
    riskLabel: document.getElementById('riskLabel'),
    previewPrice: document.getElementById('previewPrice'),
    previewValue: document.getElementById('previewValue'),
    quantityInput: document.getElementById('quantityInput'),
    marketRows: document.getElementById('marketRows'),
    holdingsRows: document.getElementById('holdingsRows'),
    holdingsEmpty: document.getElementById('holdingsEmpty'),
    holdingsTableWrap: document.getElementById('holdingsTableWrap'),
    orderFeed: document.getElementById('orderFeed'),
    tradeForm: document.getElementById('tradeForm'),
    toast: document.getElementById('toast'),
    resetAccountButton: document.getElementById('resetAccountButton'),
    chartTitle: document.getElementById('chartTitle'),
    chartPrice: document.getElementById('chartPrice'),
    priceCanvas: document.getElementById('priceCanvas'),
    heroEquity: document.getElementById('heroEquity'),
    heroDailyChange: document.getElementById('heroDailyChange'),
    coachText: document.getElementById('coachText')
  };

  hydrateMarket();
  renderAssetOptions();
  bindEvents();
  render();
  window.setInterval(tickMarket, 2600);

  function createInitialState() {
    return {
      cash: STARTING_CASH,
      holdings: {},
      orders: [],
      selectedSymbol: 'SOFT',
      dayStartEquity: STARTING_CASH,
      prices: {},
      history: {}
    };
  }

  function hydrateMarket() {
    assets.forEach((asset) => {
      if (!state.prices[asset.symbol]) state.prices[asset.symbol] = asset.price;
      if (!Array.isArray(state.history[asset.symbol]) || state.history[asset.symbol].length < 8) {
        state.history[asset.symbol] = Array.from({ length: 36 }, (_, index) => {
          const wave = Math.sin(index / 4) * asset.price * 0.012;
          const noise = (Math.random() - 0.5) * asset.price * 0.018;
          return roundMoney(asset.price + wave + noise);
        });
      }
    });
  }

  function renderAssetOptions() {
    elements.assetSelect.innerHTML = assets.map((asset) => {
      return `<option value="${asset.symbol}">${asset.symbol} - ${asset.name}</option>`;
    }).join('');
    elements.assetSelect.value = state.selectedSymbol;
  }

  function bindEvents() {
    elements.assetSelect.addEventListener('change', () => {
      state.selectedSymbol = elements.assetSelect.value;
      render();
    });

    elements.quantityInput.addEventListener('input', updateOrderPreview);

    elements.tradeForm.addEventListener('submit', (event) => {
      event.preventDefault();
      executeTrade();
    });

    elements.resetAccountButton.addEventListener('click', () => {
      const shouldReset = window.confirm('Weet je zeker dat je het papertrading account wilt resetten?');
      if (!shouldReset) return;
      Object.assign(state, createInitialState());
      hydrateMarket();
      renderAssetOptions();
      render();
      showToast('Je oefenaccount is teruggezet naar € 10.000 cash.');
    });

    window.addEventListener('resize', drawChart);
  }

  function executeTrade() {
    const symbol = elements.assetSelect.value;
    const side = getSelectedSide();
    const quantity = Math.floor(Number(elements.quantityInput.value || 0));
    const price = getPrice(symbol);
    const value = roundMoney(quantity * price);

    if (!quantity || quantity < 1) {
      showToast('Vul minimaal 1 stuk in.');
      return;
    }

    if (side === 'buy' && value > state.cash) {
      showToast('Niet genoeg cash voor deze oefenorder.');
      return;
    }

    const holding = state.holdings[symbol] || { quantity: 0, cost: 0 };

    if (side === 'sell' && quantity > holding.quantity) {
      showToast('Je kunt niet meer verkopen dan je bezit.');
      return;
    }

    if (side === 'buy') {
      state.cash = roundMoney(state.cash - value);
      holding.quantity += quantity;
      holding.cost = roundMoney(holding.cost + value);
      state.holdings[symbol] = holding;
      addOrder('buy', symbol, quantity, price, value);
      showToast(`Gekocht: ${quantity}x ${symbol} voor ${formatCurrency.format(value)}.`);
    } else {
      const averageCost = holding.quantity ? holding.cost / holding.quantity : 0;
      state.cash = roundMoney(state.cash + value);
      holding.quantity -= quantity;
      holding.cost = roundMoney(Math.max(0, holding.cost - averageCost * quantity));
      if (holding.quantity <= 0) {
        delete state.holdings[symbol];
      } else {
        state.holdings[symbol] = holding;
      }
      addOrder('sell', symbol, quantity, price, value);
      showToast(`Verkocht: ${quantity}x ${symbol} voor ${formatCurrency.format(value)}.`);
    }

    render();
  }

  function addOrder(side, symbol, quantity, price, value) {
    state.orders.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      side,
      symbol,
      quantity,
      price,
      value,
      time: new Date().toISOString()
    });
    state.orders = state.orders.slice(0, 12);
  }

  function tickMarket() {
    assets.forEach((asset) => {
      const current = getPrice(asset.symbol);
      const randomMove = (Math.random() - 0.46) * asset.volatility;
      const next = Math.max(1, current * (1 + asset.drift + randomMove));
      state.prices[asset.symbol] = roundMoney(next);
      state.history[asset.symbol].push(state.prices[asset.symbol]);
      state.history[asset.symbol] = state.history[asset.symbol].slice(-72);
    });
    render();
  }

  function render() {
    const summary = getPortfolioSummary();
    const dailyChange = state.dayStartEquity ? (summary.equity - state.dayStartEquity) / state.dayStartEquity : 0;

    elements.cashBalance.textContent = formatCurrency.format(summary.cash);
    elements.totalEquity.textContent = formatCurrency.format(summary.equity);
    elements.investedValue.textContent = formatCurrency.format(summary.invested);
    elements.profitLoss.textContent = formatCurrency.format(summary.profitLoss);
    elements.profitLoss.className = summary.profitLoss >= 0 ? 'positive' : 'negative';
    elements.heroEquity.textContent = formatCurrency.format(summary.equity);
    elements.heroDailyChange.textContent = `${dailyChange >= 0 ? '+' : ''}${formatPercent.format(dailyChange)}`;
    elements.heroDailyChange.className = dailyChange >= 0 ? 'positive' : 'negative';

    updateRisk(summary);
    updateOrderPreview();
    renderMarket();
    renderHoldings();
    renderOrders();
    updateCoach(summary);
    drawChart();
  }

  function getPortfolioSummary() {
    const invested = Object.entries(state.holdings).reduce((total, entry) => {
      const symbol = entry[0];
      const holding = entry[1];
      return total + holding.quantity * getPrice(symbol);
    }, 0);

    const cost = Object.values(state.holdings).reduce((total, holding) => total + holding.cost, 0);
    const equity = roundMoney(state.cash + invested);

    return {
      cash: state.cash,
      invested: roundMoney(invested),
      cost: roundMoney(cost),
      equity,
      profitLoss: roundMoney(invested - cost)
    };
  }

  function updateRisk(summary) {
    const ratio = summary.equity ? Math.min(1, summary.invested / summary.equity) : 0;
    elements.riskFill.style.width = `${Math.round(ratio * 100)}%`;

    if (ratio < 0.25) {
      elements.riskLabel.textContent = 'Rustig';
    } else if (ratio < 0.65) {
      elements.riskLabel.textContent = 'Actief';
    } else {
      elements.riskLabel.textContent = 'Scherp opletten';
    }
  }

  function updateOrderPreview() {
    const symbol = elements.assetSelect.value || state.selectedSymbol;
    const quantity = Math.max(0, Number(elements.quantityInput.value || 0));
    const price = getPrice(symbol);

    elements.previewPrice.textContent = formatCurrency.format(price);
    elements.previewValue.textContent = formatCurrency.format(roundMoney(quantity * price));
  }

  function renderMarket() {
    elements.marketRows.innerHTML = assets.map((asset) => {
      const history = state.history[asset.symbol] || [asset.price];
      const first = history[Math.max(0, history.length - 12)] || history[0];
      const current = getPrice(asset.symbol);
      const move = first ? (current - first) / first : 0;
      const directionClass = move >= 0 ? 'positive' : 'negative';

      return `
        <tr>
          <td>
            <div class="asset-cell">
              <strong>${asset.symbol}</strong>
              <span>${asset.name}</span>
            </div>
          </td>
          <td>${formatCurrency.format(current)}</td>
          <td class="${directionClass}">${move >= 0 ? '+' : ''}${formatPercent.format(move)}</td>
          <td><button class="mini-button" type="button" data-select-asset="${asset.symbol}">Trade</button></td>
        </tr>
      `;
    }).join('');

    elements.marketRows.querySelectorAll('[data-select-asset]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedSymbol = button.dataset.selectAsset;
        elements.assetSelect.value = state.selectedSymbol;
        render();
        document.getElementById('trade-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function renderHoldings() {
    const entries = Object.entries(state.holdings).filter((entry) => entry[1].quantity > 0);
    const hasHoldings = entries.length > 0;

    elements.holdingsEmpty.hidden = hasHoldings;
    elements.holdingsTableWrap.hidden = !hasHoldings;

    elements.holdingsRows.innerHTML = entries.map((entry) => {
      const symbol = entry[0];
      const holding = entry[1];
      const asset = getAsset(symbol);
      const price = getPrice(symbol);
      const value = roundMoney(holding.quantity * price);
      const average = holding.quantity ? holding.cost / holding.quantity : 0;
      const profit = roundMoney(value - holding.cost);

      return `
        <tr>
          <td>
            <div class="asset-cell">
              <strong>${symbol}</strong>
              <span>${asset.name}</span>
            </div>
          </td>
          <td>${holding.quantity}</td>
          <td>${formatCurrency.format(average)}</td>
          <td>${formatCurrency.format(value)}</td>
          <td class="${profit >= 0 ? 'positive' : 'negative'}">${formatCurrency.format(profit)}</td>
        </tr>
      `;
    }).join('');
  }

  function renderOrders() {
    if (!state.orders.length) {
      elements.orderFeed.innerHTML = `
        <div class="empty-state">
          <strong>Nog geen orders.</strong>
          <span>Je eerste transactie verschijnt hier.</span>
        </div>
      `;
      return;
    }

    elements.orderFeed.innerHTML = state.orders.map((order) => {
      const sideLabel = order.side === 'buy' ? 'Koop' : 'Verkoop';
      return `
        <div class="order-item">
          <span class="order-side ${order.side === 'sell' ? 'sell' : ''}">${sideLabel}</span>
          <div class="order-copy">
            <strong>${order.quantity}x ${order.symbol} tegen ${formatCurrency.format(order.price)}</strong>
            <span>Orderwaarde ${formatCurrency.format(order.value)}</span>
          </div>
          <span class="order-time">${formatTime(order.time)}</span>
        </div>
      `;
    }).join('');
  }

  function updateCoach(summary) {
    const largestPositionRatio = getLargestPositionRatio(summary);

    if (summary.invested === 0) {
      elements.coachText.textContent = 'Je account staat nog volledig in cash. Mooie start: kies eerst een kleine positie, zodat je gevoel krijgt voor koersbewegingen zonder meteen all-in te gaan.';
      return;
    }

    if (largestPositionRatio > 0.45) {
      elements.coachText.textContent = 'Een groot deel van je account zit in één positie. Dat kan hard gaan, beide kanten op. Overweeg spreiding als je rustiger wilt oefenen.';
      return;
    }

    if (summary.profitLoss < -250) {
      elements.coachText.textContent = 'Je open posities staan onder water. Goede oefening: schrijf op of je originele reden om te kopen nog steeds klopt, voordat je bijkoopt of verkoopt.';
      return;
    }

    if (summary.profitLoss > 250) {
      elements.coachText.textContent = 'Je paperportfolio staat lekker groen. Pro tip: bepaal vooraf waar je winst zou nemen, zodat je niet alleen op gevoel reageert.';
      return;
    }

    elements.coachText.textContent = 'Je portfolio is in balans. Blijf vooral klein testen: een goede papertrader leert eerst proces, daarna pas performance.';
  }

  function getLargestPositionRatio(summary) {
    if (!summary.equity) return 0;
    return Object.entries(state.holdings).reduce((max, entry) => {
      const symbol = entry[0];
      const holding = entry[1];
      const value = holding.quantity * getPrice(symbol);
      return Math.max(max, value / summary.equity);
    }, 0);
  }

  function drawChart() {
    const canvas = elements.priceCanvas;
    const context = canvas.getContext('2d');
    const symbol = state.selectedSymbol;
    const asset = getAsset(symbol);
    const history = state.history[symbol] || [];
    const width = canvas.clientWidth || 900;
    const height = canvas.clientHeight || 300;
    const pixelRatio = window.devicePixelRatio || 1;

    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    elements.chartTitle.textContent = `${symbol} - ${asset.name}`;
    elements.chartPrice.textContent = formatCurrency.format(getPrice(symbol));

    if (history.length < 2) return;

    const padding = 24;
    const min = Math.min(...history);
    const max = Math.max(...history);
    const range = Math.max(1, max - min);

    context.lineWidth = 3;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.beginPath();

    history.forEach((price, index) => {
      const x = padding + (index / (history.length - 1)) * (width - padding * 2);
      const y = height - padding - ((price - min) / range) * (height - padding * 2);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });

    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#d1642f');
    gradient.addColorStop(0.5, '#e3b04b');
    gradient.addColorStop(1, '#006b5c');
    context.strokeStyle = gradient;
    context.stroke();

    const lastPrice = history[history.length - 1];
    const previousPrice = history[history.length - 2];
    const lastX = width - padding;
    const lastY = height - padding - ((lastPrice - min) / range) * (height - padding * 2);

    context.fillStyle = lastPrice >= previousPrice ? '#087d55' : '#b92f42';
    context.beginPath();
    context.arc(lastX, lastY, 6, 0, Math.PI * 2);
    context.fill();
  }

  function getSelectedSide() {
    const checked = document.querySelector('input[name="side"]:checked');
    return checked ? checked.value : 'buy';
  }

  function getAsset(symbol) {
    return assets.find((asset) => asset.symbol === symbol) || assets[0];
  }

  function getPrice(symbol) {
    return Number(state.prices[symbol] || getAsset(symbol).price);
  }

  function formatTime(value) {
    return new Intl.DateTimeFormat('nl-NL', {
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  }

  function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => {
      elements.toast.classList.remove('show');
    }, 3200);
  }
})();
