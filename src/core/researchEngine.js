import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import frozenCandidate from '../strategies/frozenCandidate.js';
import { runBacktest } from './backtester.js';
import { DEFAULT_CONFIG } from './riskEngine.js';

function formatPercent(value) {
  if (!Number.isFinite(value)) return 'n.v.t.';
  return `${(value * 100).toFixed(1)}%`;
}

function makeCheck(id, label, pass, detail) {
  return { id, label, pass, detail };
}

export function runResearchDiagnostics({
  candlesByAsset,
  config: rawConfig = {},
  baseResult,
  strategy = frozenCandidate,
  assets = SUPPORTED_ASSETS,
} = {}) {
  const config = { ...DEFAULT_CONFIG, ...rawConfig };
  const base = baseResult || runBacktest({ candlesByAsset, config, strategy, assets });
  const stressedConfig = {
    ...config,
    feeRate: config.feeRate * 2,
    slippageRate: config.slippageRate * 2,
  };
  const costStress = runBacktest({
    candlesByAsset,
    config: stressedConfig,
    strategy,
    assets,
  });

  const edge = base.strategyReturn - base.benchmarkReturn;
  const stressEdge = costStress.strategyReturn - costStress.benchmarkReturn;
  const checks = [
    makeCheck(
      'positive-edge',
      'Verslaat buy-and-hold over volledige sample',
      edge > 0,
      `${formatPercent(base.strategyReturn)} vs ${formatPercent(base.benchmarkReturn)}`,
    ),
    makeCheck(
      'stress-edge',
      'Blijft overeind bij dubbele fee en slippage',
      costStress.strategyReturn > 0 && stressEdge > -0.1,
      `${formatPercent(costStress.strategyReturn)} stress-return, edge ${formatPercent(stressEdge)}`,
    ),
    makeCheck(
      'oos-edge',
      'OOS blijft beter dan benchmark',
      base.oosReturn > base.oosBenchmarkReturn,
      `${formatPercent(base.oosReturn)} vs ${formatPercent(base.oosBenchmarkReturn)}`,
    ),
    makeCheck(
      'drawdown-discipline',
      'Drawdown blijft binnen doel',
      base.maxDrawdown <= config.maxDrawdownTarget,
      `${formatPercent(base.maxDrawdown)} max drawdown`,
    ),
    makeCheck(
      'profit-quality',
      'Profit factor blijft acceptabel',
      base.profitFactor >= config.minProfitFactor,
      `${Number.isFinite(base.profitFactor) ? base.profitFactor.toFixed(2) : 'oneindig'} profit factor`,
    ),
    makeCheck(
      'walk-forward',
      'Minstens helft walk-forward windows wint',
      base.walkForwardBeatRate >= config.minWalkForwardBeatRate,
      `${formatPercent(base.walkForwardBeatRate)} beat-rate`,
    ),
  ];

  const failed = checks.filter((check) => !check.pass);
  const verdict = failed.length === 0 ? 'CANDIDATE' : failed.length <= 2 ? 'WATCH' : 'REJECT';

  return {
    verdict,
    checks,
    failed,
    edge,
    stressEdge,
    costStressReturn: costStress.strategyReturn,
    costStressMaxDrawdown: costStress.maxDrawdown,
    costStressProfitFactor: costStress.profitFactor,
    message: verdict === 'CANDIDATE'
      ? 'Research verdict: kandidaat met aantoonbare edge, nog steeds alleen paper.'
      : `Research verdict: ${verdict.toLowerCase()} door ${failed.map((check) => check.label).join(', ')}.`,
  };
}
