import { fetchMarketData, SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import { runBacktest } from '../core/backtester.js';
import { DEFAULT_CONFIG } from '../core/riskEngine.js';
import {
  exportForwardCsv,
  exportForwardJson,
  importForwardJson,
  loadOrCreateForwardState,
  logForwardSignal,
  resetForwardState,
} from '../forward/forwardRunner.js';
import { saveForwardState } from '../storage/localStore.js';

const state = {
  config: { ...DEFAULT_CONFIG },
  marketData: null,
  backtest: null,
  forwardState: null,
  running: false,
};

function formatCurrency(value) {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return 'n.v.t.';
  return `${(value * 100).toFixed(digits)}%`;
}

function formatDate(value) {
  if (!value) return 'n.v.t.';
  return new Intl.DateTimeFormat('nl-NL', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(new Date(value));
}

function formatWeightMap(weights = {}) {
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0.005);
  if (!entries.length) return '<span class="muted">100% cash</span>';
  return entries
    .map(([symbol, weight]) => `<span class="weight-pill">${symbol.replace('USDT', '')} ${formatPercent(weight, 0)}</span>`)
    .join('');
}

function setText(root, selector, value) {
  const element = root.querySelector(selector);
  if (element) element.textContent = value;
}

function readConfig(root) {
  return {
    ...DEFAULT_CONFIG,
    timeframe: root.querySelector('#timeframe').value,
    candleTarget: Number(root.querySelector('#candleTarget').value) || DEFAULT_CONFIG.candleTarget,
    initialCapital: Number(root.querySelector('#initialCapital').value) || DEFAULT_CONFIG.initialCapital,
    feeRate: (Number(root.querySelector('#feeRate').value) || 0) / 100,
    slippageRate: (Number(root.querySelector('#slippageRate').value) || 0) / 100,
    guardMode: root.querySelector('#guardMode').value,
    maxDrawdownTarget: (Number(root.querySelector('#maxDrawdownTarget').value) || 0) / 100,
    minProfitFactor: Number(root.querySelector('#minProfitFactor').value) || DEFAULT_CONFIG.minProfitFactor,
    oosRatio: 0.25,
  };
}

function renderShell(root) {
  root.innerHTML = `
    <header class="topbar">
      <div>
        <p class="eyebrow">Paper Trading Research Lab</p>
        <h1>Crypto Strategy Dashboard</h1>
      </div>
      <div class="compliance-badge">Paper only · geen echte orders · geen financieel advies</div>
    </header>

    <section class="control-band" aria-label="Instellingen">
      <label>
        <span>Timeframe</span>
        <select id="timeframe">
          <option value="Daily" selected>Daily</option>
          <option value="4H">4H</option>
        </select>
      </label>
      <label>
        <span>Candle target</span>
        <input id="candleTarget" type="number" min="240" max="5000" step="100" value="3000">
      </label>
      <label>
        <span>Startkapitaal</span>
        <input id="initialCapital" type="number" min="100" step="100" value="10000">
      </label>
      <label>
        <span>Fee %</span>
        <input id="feeRate" type="number" min="0" step="0.01" value="0.10">
      </label>
      <label>
        <span>Slippage %</span>
        <input id="slippageRate" type="number" min="0" step="0.01" value="0.05">
      </label>
      <label>
        <span>Guard mode</span>
        <select id="guardMode">
          <option value="Strict" selected>Strict</option>
          <option value="Balanced">Balanced</option>
        </select>
      </label>
      <label>
        <span>Max drawdown %</span>
        <input id="maxDrawdownTarget" type="number" min="1" max="90" step="1" value="30">
      </label>
      <label>
        <span>Min profit factor</span>
        <input id="minProfitFactor" type="number" min="0" step="0.05" value="1.65">
      </label>
      <button id="runBacktest" class="primary-button" type="button">Run backtest</button>
    </section>

    <section id="statusPanel" class="status-panel" aria-live="polite">
      <span class="pulse"></span>
      <span id="statusText">Klaar om Binance candles op te halen.</span>
    </section>

    <main class="dashboard-grid">
      <section class="signal-card" id="signalCard">
        <div class="card-heading">
          <span>Current Signal</span>
          <strong id="gateBadge" class="gate-badge closed">GATE DICHT</strong>
        </div>
        <div class="signal-value" id="signalValue">CASH</div>
        <div class="weights-row" id="signalWeights"><span class="muted">Nog geen run.</span></div>
        <p class="signal-reason" id="signalReason">De strategie wacht op data.</p>
      </section>

      <section class="metrics-grid" id="metricsGrid"></section>

      <section class="panel data-panel">
        <div class="panel-title">
          <h2>Data</h2>
          <span id="oosWindow">OOS-window: n.v.t.</span>
        </div>
        <div id="dataSummary" class="data-summary"></div>
      </section>

      <section class="panel guard-panel">
        <div class="panel-title">
          <h2>Guardrails</h2>
          <span id="guardSummary">Nog niet getest</span>
        </div>
        <ul id="guardList" class="guard-list"></ul>
      </section>

      <section class="panel chart-panel">
        <div class="panel-title">
          <h2>Equity Curve</h2>
          <span id="equityEnd">n.v.t.</span>
        </div>
        <canvas id="equityChart" height="260"></canvas>
      </section>

      <section class="panel chart-panel">
        <div class="panel-title">
          <h2>Benchmark Curve</h2>
          <span id="benchmarkEnd">n.v.t.</span>
        </div>
        <canvas id="benchmarkChart" height="260"></canvas>
      </section>

      <section class="panel">
        <div class="panel-title">
          <h2>Asset Ranking</h2>
          <span>Trend · momentum · breakout · volatility</span>
        </div>
        <div id="rankingTable" class="table-wrap"></div>
      </section>

      <section class="panel">
        <div class="panel-title">
          <h2>Paper Portfolio</h2>
          <span id="paperEquity">n.v.t.</span>
        </div>
        <div id="paperPortfolio" class="portfolio-box"></div>
        <div class="button-row">
          <button id="logForward" type="button">Log dagelijks signaal</button>
          <button id="exportCsv" type="button">CSV export</button>
          <button id="exportJson" type="button">JSON export</button>
          <button id="importJson" type="button">JSON import</button>
          <button id="resetForward" class="danger-button" type="button">Reset</button>
          <input id="jsonFile" type="file" accept="application/json" hidden>
        </div>
      </section>

      <section class="panel wide-panel">
        <div class="panel-title">
          <h2>Forward Log</h2>
          <span id="forwardCount">0 logs</span>
        </div>
        <div id="forwardLog" class="table-wrap"></div>
      </section>

      <section class="panel wide-panel">
        <div class="panel-title">
          <h2>Tests</h2>
          <button id="runTests" type="button">Run tests</button>
        </div>
        <div id="testOutput" class="test-output">Nog niet gedraaid.</div>
      </section>
    </main>
  `;
}

function renderMetrics(root, result) {
  const metrics = [
    ['Strategy return', formatPercent(result?.strategyReturn || 0)],
    ['Buy & hold return', formatPercent(result?.benchmarkReturn || 0)],
    ['OOS return', formatPercent(result?.oosReturn || 0)],
    ['OOS benchmark', formatPercent(result?.oosBenchmarkReturn || 0)],
    ['Max drawdown', formatPercent(result?.maxDrawdown || 0)],
    ['Profit factor', Number.isFinite(result?.profitFactor) ? result.profitFactor.toFixed(2) : 'oneindig'],
    ['Winrate', formatPercent(result?.winRate || 0)],
    ['Trades', String(result?.trades || 0)],
    ['Fees betaald', formatCurrency(result?.feesPaid || 0)],
    ['Slippage kosten', formatCurrency(result?.slippagePaid || 0)],
  ];

  root.querySelector('#metricsGrid').innerHTML = metrics.map(([label, value]) => `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `).join('');
}

function renderDataSummary(root) {
  const summaries = state.marketData?.summaries || [];
  const config = state.config;
  const oos = state.backtest?.oosWindow;

  root.querySelector('#dataSummary').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Asset</th>
          <th>Candles</th>
          <th>Startdatum</th>
          <th>Einddatum</th>
          <th>Timeframe</th>
        </tr>
      </thead>
      <tbody>
        ${summaries.map((summary) => `
          <tr>
            <td>${summary.symbol}</td>
            <td>${summary.candles}</td>
            <td>${formatDate(summary.start)}</td>
            <td>${formatDate(summary.end)}</td>
            <td>${summary.timeframe}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="data-facts">
      <span>Fee: ${formatPercent(config.feeRate, 2)}</span>
      <span>Slippage: ${formatPercent(config.slippageRate, 2)}</span>
      <span>Guard: ${config.guardMode}</span>
      <span>Assets: ${SUPPORTED_ASSETS.join(', ')}</span>
    </div>
  `;

  root.querySelector('#oosWindow').textContent = oos
    ? `OOS-window: ${oos.candles} candles · ${formatDate(oos.startTime)} tot ${formatDate(oos.endTime)}`
    : 'OOS-window: n.v.t.';
}

function renderSignal(root, result) {
  const signal = result?.currentSignal || { label: 'CASH', weights: {}, reasons: ['Nog geen run.'] };
  const gate = result?.gate || { open: false, message: 'Nog niet getest.' };
  const gateBadge = root.querySelector('#gateBadge');
  gateBadge.textContent = gate.open ? 'GATE OPEN' : 'GATE DICHT';
  gateBadge.className = `gate-badge ${gate.open ? 'open' : 'closed'}`;
  setText(root, '#signalValue', signal.label || 'CASH');
  root.querySelector('#signalWeights').innerHTML = formatWeightMap(signal.weights);
  setText(root, '#signalReason', signal.reasons?.[0] || gate.message);
}

function renderGuardrails(root, result) {
  const list = root.querySelector('#guardList');
  const checks = result?.gate?.checks || [];
  list.innerHTML = checks.length
    ? checks.map((check) => `
      <li class="${check.pass ? 'pass' : 'fail'}">
        <span>${check.pass ? 'PASS' : 'FAIL'}</span>
        <div>
          <strong>${check.label}</strong>
          <small>${check.detail}</small>
        </div>
      </li>
    `).join('')
    : '<li class="fail"><span>WAIT</span><div><strong>Nog geen backtest</strong><small>Run eerst de strategie.</small></div></li>';
  setText(root, '#guardSummary', result?.gate?.message || 'Nog niet getest');
}

function normalizeChartData(series) {
  const points = (series || []).filter((point) => Number.isFinite(point.value));
  if (!points.length) return { points: [], min: 0, max: 1 };
  const values = points.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.08, max * 0.01, 1);
  return { points, min: min - padding, max: max + padding };
}

function drawChart(canvas, series, color) {
  const context = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  context.scale(ratio, ratio);

  const width = rect.width;
  const height = rect.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#0d1016';
  context.fillRect(0, 0, width, height);

  const { points, min, max } = normalizeChartData(series);
  context.strokeStyle = '#222a35';
  context.lineWidth = 1;
  for (let row = 1; row <= 4; row += 1) {
    const y = (height / 5) * row;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  if (points.length < 2) return;

  context.strokeStyle = color;
  context.lineWidth = 2.5;
  context.beginPath();
  points.forEach((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - ((point.value - min) / (max - min)) * height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();

  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, `${color}55`);
  gradient.addColorStop(1, `${color}00`);
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();
}

function renderCharts(root, result) {
  const equityCurve = result?.equityCurve || [];
  const benchmarkCurve = result?.benchmarkCurve || [];
  drawChart(root.querySelector('#equityChart'), equityCurve, '#30d158');
  drawChart(root.querySelector('#benchmarkChart'), benchmarkCurve, '#5ac8fa');
  const lastEquity = equityCurve[equityCurve.length - 1]?.value;
  const lastBenchmark = benchmarkCurve[benchmarkCurve.length - 1]?.value;
  setText(root, '#equityEnd', lastEquity ? formatCurrency(lastEquity) : 'n.v.t.');
  setText(root, '#benchmarkEnd', lastBenchmark ? formatCurrency(lastBenchmark) : 'n.v.t.');
}

function renderRanking(root, result) {
  const ranking = result?.ranking || [];
  root.querySelector('#rankingTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Asset</th>
          <th>Score</th>
          <th>Trend</th>
          <th>Momentum</th>
          <th>Breakout</th>
          <th>Volatility</th>
        </tr>
      </thead>
      <tbody>
        ${ranking.map((asset, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${asset.symbol}</td>
            <td><strong>${asset.score.toFixed(1)}</strong></td>
            <td>${asset.trend.toFixed(1)}</td>
            <td>${asset.momentum.toFixed(1)}</td>
            <td>${asset.breakout.toFixed(1)}</td>
            <td>${asset.volatility ? formatPercent(asset.volatility, 2) : 'n.v.t.'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderForward(root) {
  const forwardState = state.forwardState || createSafeForwardState();
  const logs = forwardState.logs || [];
  setText(root, '#paperEquity', formatCurrency(forwardState.paperPortfolio?.equity || state.config.initialCapital));
  setText(root, '#forwardCount', `${logs.length} logs`);
  root.querySelector('#paperPortfolio').innerHTML = `
    <div class="portfolio-line">
      <span>Paper equity</span>
      <strong>${formatCurrency(forwardState.paperPortfolio?.equity || state.config.initialCapital)}</strong>
    </div>
    <div class="portfolio-line">
      <span>Benchmark equity</span>
      <strong>${formatCurrency(forwardState.benchmarkPortfolio?.equity || state.config.initialCapital)}</strong>
    </div>
    <div class="weights-row">${formatWeightMap(forwardState.paperPortfolio?.weights || {})}</div>
  `;

  root.querySelector('#forwardLog').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Datum</th>
          <th>Timeframe</th>
          <th>Signaal</th>
          <th>Paper</th>
          <th>Benchmark</th>
          <th>Weights</th>
        </tr>
      </thead>
      <tbody>
        ${logs.slice(-12).reverse().map((entry) => `
          <tr>
            <td>${entry.dateKey}</td>
            <td>${entry.timeframe}</td>
            <td>${entry.signal}</td>
            <td>${formatCurrency(entry.paperEquity)}</td>
            <td>${formatCurrency(entry.benchmarkEquity)}</td>
            <td>${formatWeightMap(entry.weights)}</td>
          </tr>
        `).join('') || '<tr><td colspan="6" class="muted">Nog geen forward logs.</td></tr>'}
      </tbody>
    </table>
  `;
}

function createSafeForwardState() {
  state.forwardState = loadOrCreateForwardState(state.config.initialCapital);
  return state.forwardState;
}

function renderErrors(root) {
  const errors = state.marketData?.errors || [];
  if (!errors.length) return;
  const message = errors.map((error) => `${error.symbol}: ${error.message}`).join(' · ');
  setText(root, '#statusText', `Let op: ${message}`);
}

function renderAll(root) {
  renderMetrics(root, state.backtest);
  renderDataSummary(root);
  renderSignal(root, state.backtest);
  renderGuardrails(root, state.backtest);
  renderCharts(root, state.backtest);
  renderRanking(root, state.backtest);
  renderForward(root);
  renderErrors(root);
}

async function runAnalysis(root) {
  if (state.running) return;
  state.running = true;
  state.config = readConfig(root);
  setText(root, '#statusText', 'Binance candles ophalen en backtest draaien...');
  root.querySelector('#runBacktest').disabled = true;

  try {
    state.marketData = await fetchMarketData({
      assets: SUPPORTED_ASSETS,
      timeframe: state.config.timeframe,
      target: state.config.candleTarget,
    });
    state.backtest = runBacktest({
      candlesByAsset: state.marketData.candlesByAsset,
      config: state.config,
      assets: SUPPORTED_ASSETS,
    });
    state.forwardState = loadOrCreateForwardState(state.config.initialCapital);
    setText(root, '#statusText', state.backtest.ok ? 'Backtest klaar.' : state.backtest.error);
    renderAll(root);
  } catch (error) {
    setText(root, '#statusText', `Fout: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    state.running = false;
    root.querySelector('#runBacktest').disabled = false;
  }
}

function downloadText(filename, contents, type = 'text/plain') {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function wireEvents(root) {
  root.querySelector('#runBacktest').addEventListener('click', () => runAnalysis(root));

  root.querySelector('#logForward').addEventListener('click', () => {
    if (!state.backtest || !state.marketData) {
      setText(root, '#statusText', 'Run eerst een backtest voordat je forward logt.');
      return;
    }
    const result = logForwardSignal({
      state: state.forwardState,
      signal: state.backtest.currentSignal,
      candlesByAsset: state.marketData.candlesByAsset,
      assets: SUPPORTED_ASSETS,
      config: state.config,
    });
    state.forwardState = result.state;
    setText(root, '#statusText', result.message);
    renderForward(root);
  });

  root.querySelector('#exportCsv').addEventListener('click', () => {
    downloadText('paper-forward-log.csv', exportForwardCsv(state.forwardState), 'text/csv');
  });

  root.querySelector('#exportJson').addEventListener('click', () => {
    downloadText('paper-forward-log.json', exportForwardJson(state.forwardState), 'application/json');
  });

  root.querySelector('#importJson').addEventListener('click', () => {
    root.querySelector('#jsonFile').click();
  });

  root.querySelector('#jsonFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      state.forwardState = importForwardJson(await file.text());
      setText(root, '#statusText', 'Forward JSON geimporteerd.');
      renderForward(root);
    } catch (error) {
      setText(root, '#statusText', `Import fout: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      event.target.value = '';
    }
  });

  root.querySelector('#resetForward').addEventListener('click', () => {
    state.forwardState = resetForwardState(state.config.initialCapital);
    saveForwardState(state.forwardState);
    setText(root, '#statusText', 'Forward state gereset.');
    renderForward(root);
  });

  root.querySelector('#runTests').addEventListener('click', async () => {
    const output = root.querySelector('#testOutput');
    output.textContent = 'Tests draaien...';
    const { runAllTests } = await import('../tests/testRunner.js');
    const results = await runAllTests();
    output.innerHTML = results.results.map((test) => `
      <div class="${test.pass ? 'test-pass' : 'test-fail'}">
        ${test.pass ? 'PASS' : 'FAIL'} · ${test.name}${test.error ? ` · ${test.error}` : ''}
      </div>
    `).join('');
    setText(root, '#statusText', results.failed ? `${results.failed} test(s) faalden.` : 'Alle tests groen.');
  });

  window.addEventListener('resize', () => {
    if (state.backtest) renderCharts(root, state.backtest);
  });
}

export function initDashboard(root) {
  if (!root) return;
  renderShell(root);
  state.forwardState = loadOrCreateForwardState(DEFAULT_CONFIG.initialCapital);
  wireEvents(root);
  renderAll(root);
  runAnalysis(root);
}
