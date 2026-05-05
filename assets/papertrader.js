(function () {
  const ASSETS = [
    { id: 'bitcoin', symbol: 'BTC' },
    { id: 'ethereum', symbol: 'ETH' },
    { id: 'solana', symbol: 'SOL' }
  ];

  const DAYS = 365;
  const START_EQUITY = 1;
  const FAST_MOMENTUM_DAYS = 30;
  const TREND_DAYS = 120;
  const REBALANCE_EVERY_DAYS = 7;
  const MAX_ALLOCATION = 0.7;
  const COST_PER_TURNOVER = 0.004;
  const MIN_EDGE_SCORE_TO_TRADE = 65;

  const state = {
    runs: 0,
    latest: null,
    log: []
  };

  const elements = {
    button: document.getElementById('simulateButton'),
    runs: document.getElementById('runsValue'),
    returnValue: document.getElementById('returnValue'),
    winrate: document.getElementById('winrateValue'),
    drawdown: document.getElementById('drawdownValue'),
    resultText: document.getElementById('resultText'),
    progressFill: document.getElementById('progressFill'),
    statusPill: document.getElementById('statusPill'),
    logList: document.getElementById('logList')
  };

  elements.button.addEventListener('click', runBacktest);
  render();

  async function runBacktest() {
    setLoading(true);

    try {
      const marketData = await fetchMarketData();
      const result = backtestOneEuroMission(marketData);
      state.runs += 1;
      state.latest = result;
      state.log.unshift(buildLogLine(result, state.runs));
      state.log = state.log.slice(0, 6);
      render();
    } catch (error) {
      elements.statusPill.textContent = 'Datafout';
      elements.resultText.textContent = `De databron gaf geen bruikbare data terug: ${error.message}. Voor live trading willen we uiteindelijk een eigen server-side datalaag met logging en fallback.`;
    } finally {
      setLoading(false);
    }
  }

  async function fetchMarketData() {
    const responses = await Promise.all(ASSETS.map(async (asset) => {
      const endpoint = `https://api.coingecko.com/api/v3/coins/${asset.id}/market_chart?vs_currency=usd&days=${DAYS}&interval=daily`;
      const response = await fetch(endpoint, { cache: 'no-store' });

      if (!response.ok) {
        throw new Error(`${asset.symbol} data niet beschikbaar (${response.status})`);
      }

      const payload = await response.json();
      const prices = normalizeCoinGeckoPrices(payload.prices, asset);

      if (prices.length < TREND_DAYS + FAST_MOMENTUM_DAYS) {
        throw new Error(`${asset.symbol} heeft te weinig datapunten`);
      }

      return [asset.symbol, prices];
    }));

    return Object.fromEntries(responses);
  }

  function normalizeCoinGeckoPrices(rows, asset) {
    if (!Array.isArray(rows)) return [];

    return rows
      .map((row) => ({
        date: new Date(row[0]).toISOString().slice(0, 10),
        symbol: asset.symbol,
        close: Number(row[1])
      }))
      .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function backtestOneEuroMission(marketData) {
    const dates = getSharedDates(marketData);
    const startIndex = TREND_DAYS;
    let equity = START_EQUITY;
    let peak = START_EQUITY;
    let maxDrawdown = 0;
    let currentSymbol = 'CASH';
    let currentAllocation = 0;
    let rebalanceCount = 0;
    let turnoverCount = 0;
    let winningDays = 0;
    let previousEquity = equity;
    const allocations = [];

    for (let index = startIndex; index < dates.length; index += 1) {
      const date = dates[index];
      const previousDate = dates[index - 1];
      const shouldRebalance = index === startIndex || (index - startIndex) % REBALANCE_EVERY_DAYS === 0;

      if (shouldRebalance) {
        const target = chooseResponsibleTarget(marketData, date);
        const turnover = calculateTurnover(currentSymbol, currentAllocation, target.symbol, target.allocation);

        if (turnover > 0) {
          equity *= 1 - turnover * COST_PER_TURNOVER;
          turnoverCount += 1;
        }

        currentSymbol = target.symbol;
        currentAllocation = target.allocation;
        rebalanceCount += 1;
        allocations.push({ date, symbol: currentSymbol, allocation: currentAllocation, reason: target.reason });
      }

      if (currentSymbol !== 'CASH' && currentAllocation > 0) {
        const todayClose = getClose(marketData, currentSymbol, date);
        const previousClose = getClose(marketData, currentSymbol, previousDate);
        const dailyReturn = todayClose / previousClose - 1;
        equity *= 1 + dailyReturn * currentAllocation;
      }

      if (equity > previousEquity) winningDays += 1;
      previousEquity = equity;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    }

    const benchmark = benchmarkBuyAndHold(marketData.BTC, dates[startIndex], dates[dates.length - 1]);
    const testedDays = Math.max(1, dates.length - startIndex);
    const years = testedDays / 365;
    const totalReturn = equity / START_EQUITY - 1;
    const cagr = Math.pow(equity / START_EQUITY, 1 / years) - 1;
    const benchmarkReturn = benchmark / START_EQUITY - 1;
    const edgeScore = calculateEdgeScore(totalReturn, benchmarkReturn, maxDrawdown, turnoverCount);
    const decision = getTradingDecision(edgeScore, totalReturn, benchmarkReturn, maxDrawdown);
    const lastAllocation = allocations[allocations.length - 1] || { symbol: 'CASH', allocation: 0, reason: 'Geen allocatie' };

    return {
      source: 'CoinGecko',
      testedDays,
      rebalanceCount,
      turnoverCount,
      totalReturn,
      finalEquity: equity,
      cagr,
      benchmarkReturn,
      benchmarkEquity: benchmark,
      winrate: winningDays / testedDays,
      maxDrawdown,
      edgeScore,
      decision,
      lastAllocation,
      firstDate: dates[startIndex],
      lastDate: dates[dates.length - 1],
      allocations
    };
  }

  function chooseResponsibleTarget(marketData, date) {
    const candidates = ASSETS.map((asset) => {
      const prices = marketData[asset.symbol];
      const index = prices.findIndex((row) => row.date === date);
      const close = prices[index].close;
      const trendAverage = averageClose(prices, index - TREND_DAYS + 1, index);
      const momentumBase = prices[index - FAST_MOMENTUM_DAYS].close;
      const momentum = close / momentumBase - 1;
      const trendDistance = close / trendAverage - 1;
      const aboveTrend = close > trendAverage;
      const score = aboveTrend ? momentum * 0.7 + trendDistance * 0.3 : -Infinity;

      return { symbol: asset.symbol, score, momentum, trendDistance, aboveTrend };
    }).sort((a, b) => b.score - a.score);

    const best = candidates[0];

    if (!best || !best.aboveTrend || best.momentum <= 0.04 || best.trendDistance <= 0.01) {
      return { symbol: 'CASH', allocation: 0, reason: 'Geen sterke trend' };
    }

    if (best.momentum > 0.18 && best.trendDistance > 0.08) {
      return { symbol: best.symbol, allocation: MAX_ALLOCATION, reason: 'Sterke trend + momentum' };
    }

    if (best.momentum > 0.1 && best.trendDistance > 0.04) {
      return { symbol: best.symbol, allocation: 0.5, reason: 'Redelijke trend + momentum' };
    }

    return { symbol: best.symbol, allocation: 0.25, reason: 'Kleine testpositie' };
  }

  function calculateTurnover(oldSymbol, oldAllocation, newSymbol, newAllocation) {
    if (oldSymbol === newSymbol) return Math.abs(newAllocation - oldAllocation);
    return oldAllocation + newAllocation;
  }

  function getSharedDates(marketData) {
    const dateSets = ASSETS.map((asset) => new Set(marketData[asset.symbol].map((row) => row.date)));
    return marketData.BTC
      .map((row) => row.date)
      .filter((date) => dateSets.every((set) => set.has(date)));
  }

  function benchmarkBuyAndHold(rows, startDate, endDate) {
    const start = rows.find((row) => row.date === startDate);
    const end = rows.find((row) => row.date === endDate);
    return START_EQUITY * (end.close / start.close);
  }

  function averageClose(rows, fromIndex, toIndex) {
    let total = 0;
    let count = 0;

    for (let index = fromIndex; index <= toIndex; index += 1) {
      total += rows[index].close;
      count += 1;
    }

    return total / count;
  }

  function getClose(marketData, symbol, date) {
    const row = marketData[symbol].find((entry) => entry.date === date);
    return row ? row.close : 0;
  }

  function render() {
    elements.runs.textContent = String(state.runs);

    if (!state.latest) {
      elements.returnValue.textContent = 'Nog niet getest';
      elements.winrate.textContent = 'Nog niet getest';
      elements.drawdown.textContent = 'Nog niet getest';
      elements.progressFill.style.width = '0%';
      elements.logList.innerHTML = '<p class="empty-log">Nog geen real-data backtest uitgevoerd.</p>';
      return;
    }

    const result = state.latest;

    elements.returnValue.textContent = formatEuro(result.finalEquity);
    elements.returnValue.className = result.finalEquity >= START_EQUITY ? 'good' : 'bad';
    elements.winrate.textContent = formatSignedPercent(result.totalReturn - result.benchmarkReturn);
    elements.winrate.className = result.totalReturn > result.benchmarkReturn ? 'good' : 'bad';
    elements.drawdown.textContent = formatPercent(result.maxDrawdown);
    elements.drawdown.className = result.maxDrawdown <= 0.18 ? 'good' : 'bad';
    elements.progressFill.style.width = `${result.edgeScore}%`;
    elements.statusPill.textContent = result.decision.label;
    elements.resultText.textContent = buildResultText(result);
    elements.logList.innerHTML = state.log.map((line) => `<p class="log-item">${line}</p>`).join('');
  }

  function getTradingDecision(edgeScore, totalReturn, benchmarkReturn, maxDrawdown) {
    if (edgeScore >= MIN_EDGE_SCORE_TO_TRADE && totalReturn > benchmarkReturn && maxDrawdown <= 0.18) {
      return { label: 'Voorzichtig interessant', action: 'Verder testen' };
    }

    if (totalReturn > 0 && maxDrawdown <= 0.12) {
      return { label: 'Alleen observeren', action: 'Niet live traden' };
    }

    return { label: 'Niet traden', action: 'Kapitaal beschermen' };
  }

  function buildResultText(result) {
    const allocation = result.lastAllocation.symbol === 'CASH'
      ? 'cash'
      : `${Math.round(result.lastAllocation.allocation * 100)}% ${result.lastAllocation.symbol}`;

    return `${result.decision.action}: €1 werd ${formatEuro(result.finalEquity)}. BTC buy-and-hold werd ${formatEuro(result.benchmarkEquity)}. Laatste allocatie: ${allocation}. Reden: ${result.lastAllocation.reason}.`;
  }

  function buildLogLine(result, runNumber) {
    return `<strong>Run ${runNumber}</strong>: ${result.source} ${result.firstDate} t/m ${result.lastDate}, €1 -> ${formatEuro(result.finalEquity)}, BTC -> ${formatEuro(result.benchmarkEquity)}, edge vs BTC ${formatSignedPercent(result.totalReturn - result.benchmarkReturn)}, drawdown ${formatPercent(result.maxDrawdown)}, switches ${result.turnoverCount}, oordeel ${result.decision.label}.`;
  }

  function calculateEdgeScore(totalReturn, benchmarkReturn, maxDrawdown, turnoverCount) {
    const excessScore = clamp((totalReturn - benchmarkReturn + 0.12) * 160, 0, 45);
    const returnScore = clamp((totalReturn + 0.08) * 120, 0, 25);
    const drawdownScore = clamp((0.22 - maxDrawdown) * 115, 0, 25);
    const patienceScore = turnoverCount <= 18 ? 5 : 0;
    return Math.round(excessScore + returnScore + drawdownScore + patienceScore);
  }

  function setLoading(isLoading) {
    elements.button.disabled = isLoading;
    elements.button.textContent = isLoading ? 'Haalt echte data op...' : 'Start real-data backtest';
    if (isLoading) {
      elements.statusPill.textContent = 'Data ophalen';
      elements.resultText.textContent = 'We halen echte historische marktdata op en testen of een voorzichtige bot die ene euro verantwoord zou mogen inzetten.';
    }
  }

  function formatEuro(value) {
    return new Intl.NumberFormat('nl-NL', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    }).format(value);
  }

  function formatSignedPercent(value) {
    return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
  }

  function formatPercent(value) {
    return `${(value * 100).toFixed(1)}%`;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
})();
