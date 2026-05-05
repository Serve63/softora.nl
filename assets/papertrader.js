(function () {
  const START_EQUITY = 10000;
  const TRADE_COUNT = 120;
  const RISK_PER_TRADE = 0.006;

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

  elements.button.addEventListener('click', runSimulation);
  render();

  function runSimulation() {
    elements.button.disabled = true;
    elements.button.textContent = 'Simuleert...';

    window.setTimeout(() => {
      const result = simulateEdge();
      state.runs += 1;
      state.latest = result;
      state.log.unshift(buildLogLine(result, state.runs));
      state.log = state.log.slice(0, 6);
      render();
      elements.button.disabled = false;
      elements.button.textContent = 'Simuleer opnieuw';
    }, 420);
  }

  function simulateEdge() {
    let equity = START_EQUITY;
    let peak = START_EQUITY;
    let maxDrawdown = 0;
    let wins = 0;

    for (let index = 0; index < TRADE_COUNT; index += 1) {
      const riskAmount = equity * RISK_PER_TRADE;
      const marketNoise = Math.random() * 0.16 - 0.08;
      const winProbability = 0.53 + marketNoise;
      const isWin = Math.random() < winProbability;
      const reward = isWin ? 1.28 + Math.random() * 0.42 : -1;

      if (isWin) wins += 1;
      equity += riskAmount * reward;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    }

    return {
      equity,
      returnPct: (equity - START_EQUITY) / START_EQUITY,
      winrate: wins / TRADE_COUNT,
      maxDrawdown,
      trades: TRADE_COUNT
    };
  }

  function render() {
    elements.runs.textContent = String(state.runs);

    if (!state.latest) {
      elements.returnValue.textContent = 'Nog niet getest';
      elements.winrate.textContent = 'Nog niet getest';
      elements.drawdown.textContent = 'Nog niet getest';
      elements.progressFill.style.width = '0%';
      elements.logList.innerHTML = '<p class="empty-log">Nog geen simulaties uitgevoerd.</p>';
      return;
    }

    const result = state.latest;
    const isPositive = result.returnPct >= 0;
    const edgeScore = calculateEdgeScore(result);

    elements.returnValue.textContent = formatSignedPercent(result.returnPct);
    elements.returnValue.className = isPositive ? 'good' : 'bad';
    elements.winrate.textContent = formatPercent(result.winrate);
    elements.drawdown.textContent = formatPercent(result.maxDrawdown);
    elements.drawdown.className = result.maxDrawdown <= 0.12 ? 'good' : 'bad';
    elements.progressFill.style.width = `${edgeScore}%`;
    elements.statusPill.textContent = edgeScore >= 70 ? 'Veelbelovend' : edgeScore >= 45 ? 'Verder testen' : 'Nog zwak';
    elements.resultText.textContent = buildResultText(result, edgeScore);
    elements.logList.innerHTML = state.log.map((line) => `<p class="log-item">${line}</p>`).join('');
  }

  function buildResultText(result, edgeScore) {
    if (edgeScore >= 70) {
      return 'Deze run ziet er veelbelovend uit, maar een edge bewijst zich pas na veel herhalingen. Volgende stap: dezelfde hypothese vaker draaien en kijken of het patroon blijft bestaan.';
    }

    if (edgeScore >= 45) {
      return 'Deze run is nog niet overtuigend, maar ook niet meteen waardeloos. Volgende stap: parameters scherper maken en opnieuw testen.';
    }

    return 'Deze run is zwak. Dat is nuttige informatie: liever nu ontdekken dat de hypothese niet sterk genoeg is dan later met echt geld.';
  }

  function buildLogLine(result, runNumber) {
    return `<strong>Run ${runNumber}</strong>: ${result.trades} trades, rendement ${formatSignedPercent(result.returnPct)}, winrate ${formatPercent(result.winrate)}, max drawdown ${formatPercent(result.maxDrawdown)}.`;
  }

  function calculateEdgeScore(result) {
    const returnScore = clamp((result.returnPct + 0.08) * 360, 0, 45);
    const winrateScore = clamp((result.winrate - 0.45) * 260, 0, 30);
    const drawdownScore = clamp((0.18 - result.maxDrawdown) * 140, 0, 25);
    return Math.round(returnScore + winrateScore + drawdownScore);
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
