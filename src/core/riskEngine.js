import { closes, latestValid, roc, sma } from './indicators.js';
import { sumWeights, normalizeWeights } from './portfolio.js';

export const DEFAULT_CONFIG = Object.freeze({
  timeframe: 'Daily',
  candleTarget: 3000,
  initialCapital: 10000,
  feeRate: 0.001,
  slippageRate: 0.0005,
  guardMode: 'Strict',
  maxDrawdownTarget: 0.3,
  minProfitFactor: 1.65,
  oosRatio: 0.25,
  minWalkForwardBeatRate: 0.5,
  scoreThreshold: 40,
  assetCap: 1,
  rebalanceBars: 30,
  minRotationMomentum: 0,
  emergencyDrawdownStop: 0.26,
  targetVolatility: 0.09,
});

export function analyzeBtcMacro(btcCandles, index = btcCandles.length - 1, guardMode = 'Strict') {
  const history = btcCandles.slice(0, index + 1);
  const closeValues = closes(history);
  const close = closeValues[closeValues.length - 1];
  const sma50 = latestValid(sma(closeValues, 50));
  const sma200 = latestValid(sma(closeValues, 200));
  const roc90 = latestValid(roc(closeValues, 90));

  if (![close, sma50, sma200].every(Number.isFinite)) {
    return {
      state: 'unknown',
      exposureCap: 0,
      strength: 0,
      reason: 'BTC macrofilter heeft nog te weinig historie.',
    };
  }

  const aboveLongTrend = close > sma200;
  const shortTrendAboveLong = sma50 > sma200;
  const momentumPositive = Number.isFinite(roc90) && roc90 > 0;

  if (aboveLongTrend && shortTrendAboveLong && momentumPositive) {
    return {
      state: 'strong',
      exposureCap: 1,
      strength: 1,
      reason: 'BTC macro sterk: koers boven lange trend, korte trend stijgt en 90-candle momentum is positief.',
    };
  }

  if (aboveLongTrend && (shortTrendAboveLong || momentumPositive)) {
    return {
      state: 'neutral',
      exposureCap: guardMode === 'Strict' ? 0.45 : 0.65,
      strength: 0.55,
      reason: 'BTC macro gemengd: alleen tactische exposure toegestaan.',
    };
  }

  return {
    state: 'weak',
    exposureCap: guardMode === 'Strict' ? 0 : 0.15,
    strength: 0,
    reason: 'BTC macro zwak: risk-off, cash blijft de basis.',
  };
}

export function equityThrottle(currentDrawdown, maxDrawdownTarget) {
  if (!Number.isFinite(currentDrawdown) || currentDrawdown <= 0) return 1;
  if (currentDrawdown >= maxDrawdownTarget) return 0;
  if (currentDrawdown >= maxDrawdownTarget * 0.75) return 0.25;
  if (currentDrawdown >= maxDrawdownTarget * 0.5) return 0.55;
  return 1;
}

export function applyRiskControls({
  rawWeights = {},
  ranking = [],
  btcMacro,
  currentDrawdown = 0,
  config = DEFAULT_CONFIG,
}) {
  const maxDrawdownTarget = config.maxDrawdownTarget ?? DEFAULT_CONFIG.maxDrawdownTarget;
  const drawdownThrottle = equityThrottle(currentDrawdown, maxDrawdownTarget);
  const macroExposure = Number.isFinite(btcMacro?.exposureCap) ? btcMacro.exposureCap : 0;
  const exposureCap = Math.max(0, Math.min(1, macroExposure * drawdownThrottle));
  const assetCap = config.assetCap ?? DEFAULT_CONFIG.assetCap;
  const targetVolatility = config.targetVolatility ?? DEFAULT_CONFIG.targetVolatility;
  const volatilityByAsset = Object.fromEntries(ranking.map((item) => [item.symbol, item.volatility]));
  const capped = {};

  // Volatility sizing intentionally reduces a candidate before final normalization.
  // This keeps the strategy long-only, unlevered and less concentrated during unstable regimes.
  for (const [symbol, rawWeight] of Object.entries(rawWeights)) {
    const volatility = volatilityByAsset[symbol];
    const volatilityScale = Number.isFinite(volatility)
      ? Math.max(0.5, Math.min(1, targetVolatility / Math.max(volatility, 0.025)))
      : 0.8;
    capped[symbol] = Math.min(assetCap, Math.max(0, rawWeight * volatilityScale));
  }

  const weights = normalizeWeights(capped, exposureCap);

  return {
    weights,
    exposure: sumWeights(weights),
    macroExposure,
    drawdownThrottle,
    exposureCap,
    reason: exposureCap > 0
      ? `Risk engine staat ${Math.round(sumWeights(weights) * 100)}% exposure toe.`
      : 'Risk engine staat geen exposure toe.',
  };
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return 'n.v.t.';
  return `${(value * 100).toFixed(1)}%`;
}

export function evaluateGate({ results, currentRisk, config = DEFAULT_CONFIG }) {
  const checks = [
    {
      id: 'strategy-return',
      label: 'Strategy return > buy & hold',
      pass: results.strategyReturn > results.benchmarkReturn,
      detail: `${formatPercent(results.strategyReturn)} vs ${formatPercent(results.benchmarkReturn)}`,
    },
    {
      id: 'oos-return',
      label: 'OOS return > OOS benchmark',
      pass: results.oosReturn > results.oosBenchmarkReturn,
      detail: `${formatPercent(results.oosReturn)} vs ${formatPercent(results.oosBenchmarkReturn)}`,
    },
    {
      id: 'max-drawdown',
      label: 'Max drawdown binnen limiet',
      pass: results.maxDrawdown <= config.maxDrawdownTarget,
      detail: `${formatPercent(results.maxDrawdown)} limiet ${formatPercent(config.maxDrawdownTarget)}`,
    },
    {
      id: 'profit-factor',
      label: 'Profit factor hoog genoeg',
      pass: results.profitFactor >= config.minProfitFactor,
      detail: `${Number.isFinite(results.profitFactor) ? results.profitFactor.toFixed(2) : 'oneindig'} minimum ${config.minProfitFactor.toFixed(2)}`,
    },
    {
      id: 'walk-forward',
      label: 'Walk-forward beat-rate voldoende',
      pass: results.walkForwardBeatRate >= config.minWalkForwardBeatRate,
      detail: `${formatPercent(results.walkForwardBeatRate)} minimum ${formatPercent(config.minWalkForwardBeatRate)}`,
    },
    {
      id: 'risk-exposure',
      label: 'Huidige risk engine exposure > 0',
      pass: currentRisk.exposure > 0,
      detail: `${formatPercent(currentRisk.exposure)} exposure`,
    },
  ];

  const failed = checks.filter((check) => !check.pass);

  return {
    open: failed.length === 0,
    checks,
    failed,
    message: failed.length
      ? `Gate dicht: ${failed.map((check) => check.label).join(', ')}.`
      : 'Gate open: alle guardrails zijn groen.',
  };
}
