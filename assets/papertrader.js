(function () {
  const ASSETS = [
    { id: 'bitcoin', symbol: 'BTC' },
    { id: 'ethereum', symbol: 'ETH' },
    { id: 'solana', symbol: 'SOL' }
  ];

  const DAYS = 365;
  const START_EQUITY = 10000;
  const FAST_MOMENTUM_DAYS = 30;
  const TREND_DAYS = 120;
  const COST_PER_SWITCH = 0.0025;

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
      const result = backtestMomentumRotation(marketData);
      state.runs += 1;
      state.latest = result;
      state.log.unshift(buildLogLine(result, state.runs));
      state.log = state.log.slice(0, 6);
      render();
    } catch (error) {
      elements.statusPill.textContent = 'Datafout';
      elements.resultText.textContent = `De databron gaf geen bruikbare data terug: ${error.message}. Dit is precies waarom we straks een eigen betrouwbare datalaag willen.`;
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

  function backtestMomentumRotation(marketData) {
    const dates = getSharedDates(marketData);
    const startIndex = TREND_DAYS;
    let equity = START_EQUITY;
    let peak = START_EQUITY;
    let maxDrawdown = 0;
    let currentSymbol = 'CASH';
    let trades = 0;
    let wins = 0;
    let previousEquity = equity;
    const dailyEquity = [];
    const allocations = [];

    for (let index = startIndex; index < dates.length; index += 1) {
      const date = dates[index];
      const previousDate = dates[index - 1];
      const targetSymbol = chooseTargetSymbol(marketData, date);

      if (targetSymbol !== currentSymbol) {
        if (currentSymbol !== 'CASH') trades += 1;
        equity *= 1 - COST_PER_SWITCH;
        currentSymbol = targetSymbol;
        allocations.push({ date, symbol: currentSymbol });
      }

      if (currentSymbol !== 'CASH') {
        const todayClose = getClose(marketData, currentSymbol, date);
        const previousClose = getClose(marketData, currentSymbol, previousDate);
        const dailyReturn = todayClose / previousClose - 1;
        equity *= 1 + dailyReturn;
      }

      if (equity > previousEquity) wins += 1;
      previousEquity = equity;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
      dailyEquity.push({ date, equity });
    }

    const benchmark = benchmarkBuyAndHold(marketData.BTC, dates[startIndex], dates[dates.length - 1]);
    const testedDays = Math.max(1, dailyEquity.length);
    const years = testedDays / 365;
    const totalReturn = equity / START_EQUITY - 1;
    const cagr = Math.pow(equity / START_EQUITY, 1 / years) - 1;
    const benchmarkReturn = benchmark / START_EQUITY - 1;
    const lastAllocation = currentSymbol;

    return {
      source: 'CoinGecko',
      testedDays,
      trades,
      totalReturn,
      cagr,
      benchmarkReturn,
      winrate: wins / testedDays,
      maxDrawdown,
      edgeScore: calculateEdgeScore(totalReturn, benchmarkReturn, maxDrawdown, trades),
      lastAllocation,
      firstDate: dates[startIndex],
      lastDate: dates[dates.length - 1],
      allocations
    };
  }

  function chooseTargetSymbol(marketData, date) {
    const candidates = ASSETS.map((asset) => {
      const prices = marketData[asset.symbol];
      const index = prices.findIndex((row) => row.date === date);
      const close = prices[index].close;
      const trendAverage = averageClose(prices, index - TREND_DAYS + 1, index);
      const momentumBase = prices[index - FAST_MOMENTUM_DAYS].close;
      const momentum = close / momentumBase - 1;
      const aboveTrend = close > trendAverage;

      return {
        symbol: asset.symbol,
        score: aboveTrend ? momentum : -Infinity,
        momentum,
        aboveTrend
      };
    }).sort((a, b) => b.score - a.score);

    const best = candidates[0];
    return best && best.aboveTrend && best.momentum > 0 ? best.symbol : 'CASH';
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
    const beatsBenchmark = result.totalReturn > result.benchmarkReturn;

    elements.returnValue.textContent = formatSignedPercent(result.totalReturn);
    elements.returnValue.className = result.totalReturn >= 0 ? 'good' : 'bad';
    elements.winrate.textContent = formatPercent(result.winrate);
    elements.drawdown.textContent = formatPercent(result.maxDrawdown);
    elements.drawdown.className = result.maxDrawdown <= 0.22 ? 'good' : 'bad';
    elements.progressFill.style.width = `${result.edgeScore}%`;
    elements.statusPill.textContent = beatsBenchmark ? 'Edge > BTC' : 'Nog geen edge';
    elements.resultText.textContent = buildResultText(result);
    elements.logList.innerHTML = state.log.map((line) => `<p class="log-item">${line}</p>`).join('');
  }

  function buildResultText(result) {
    const benchmarkText = formatSignedPercent(result.benchmarkReturn);
    const cagrText = formatSignedPercent(result.cagr);
    const allocationText = result.lastAllocation === 'CASH' ? 'cash' : result.lastAllocation;

    if (result.totalReturn > result.benchmarkReturn && result.maxDrawdown <= 0.25) {
      return `Deze run verslaat buy-and-hold BTC (${benchmarkText}) met een CAGR van ${cagrText}, na kosten. Laatste allocatie: ${allocationText}. Dit is interessant genoeg om vaker en strenger te testen.`;
    }

    if (result.totalReturn > 0) {
      return `De strategie is positief, maar nog niet duidelijk beter dan buy-and-hold BTC (${benchmarkText}). Laatste allocatie: ${allocationText}. Volgende stap: filters verbeteren en out-of-sample testen.`;
    }

    return `Deze edge is nog zwak op echte data. Goed om nu te zien: liever een hypothese killen dan jezelf voor de gek houden. Laatste allocatie: ${allocationText}.`;
  }

  function buildLogLine(result, runNumber) {
    return `<strong>Run ${runNumber}</strong>: ${result.source} ${result.firstDate} t/m ${result.lastDate}, rendement ${formatSignedPercent(result.totalReturn)}, BTC benchmark ${formatSignedPercent(result.benchmarkReturn)}, winrate ${formatPercent(result.winrate)}, max drawdown ${formatPercent(result.maxDrawdown)}, trades ${result.trades}.`;
  }

  function calculateEdgeScore(totalReturn, benchmarkReturn, maxDrawdown, trades) {
    const excessScore = clamp((totalReturn - benchmarkReturn + 0.15) * 130, 0, 45);
    const returnScore = clamp((totalReturn + 0.2) * 80, 0, 25);
    const drawdownScore = clamp((0.35 - maxDrawdown) * 85, 0, 25);
    const activityScore = trades > 1 ? 5 : 0;
    return Math.round(excessScore + returnScore + drawdownScore + activityScore);
  }

  function setLoading(isLoading) {
    elements.button.disabled = isLoading;
    elements.button.textContent = isLoading ? 'Haalt echte data op...' : 'Start real-data backtest';
    if (isLoading) {
      elements.statusPill.textContent = 'Data ophalen';
      elements.resultText.textContent = 'We halen nu echte historische marktdata op en draaien daarna de strategie met kosten/slippage.';
    }
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
