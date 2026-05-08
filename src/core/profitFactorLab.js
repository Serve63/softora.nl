import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import frozenCandidate from '../strategies/frozenCandidate.js';
import sprintRotation from '../strategies/sprintRotation.js';
import trendParticipation from '../strategies/trendParticipation.js';
import { runBacktest } from './backtester.js';
import { runRegimeBreakdown } from './regimeLab.js';
import { runRealityCheck } from './realityCheck.js';
import { DEFAULT_CONFIG } from './riskEngine.js';
import { runParameterRobustness } from './robustnessLab.js';
import { runRollingWalkForward } from './walkForward.js';

export const DEFAULT_PROFIT_FACTOR_GRID = Object.freeze({
  rebalanceBars: [60, 90, 120],
  scoreThreshold: [65, 70, 75],
  targetVolatility: [0.02, 0.025, 0.03, 0.04],
  emergencyDrawdownStop: [0.08, 0.1, 0.18, 0.2],
  assetCap: [0.2, 0.35, 0.45],
});

export const DEFAULT_PROFIT_FACTOR_STRATEGIES = Object.freeze([
  frozenCandidate,
  trendParticipation,
  sprintRotation,
]);

function cartesianProduct(grid) {
  const keys = Object.keys(grid);
  return keys.reduce((rows, key) => rows.flatMap((row) => (
    grid[key].map((value) => ({ ...row, [key]: value }))
  )), [{}]);
}

function finiteProfitFactor(value) {
  if (value === Number.POSITIVE_INFINITY) return 8;
  return Number.isFinite(value) ? value : 0;
}

function scoreRow({ result, config }) {
  const pf = finiteProfitFactor(result.profitFactor);
  const edge = result.strategyReturn - result.benchmarkReturn;
  const oosEdge = result.oosReturn - result.oosBenchmarkReturn;
  const drawdownPenalty = Math.max(0, result.maxDrawdown - config.maxDrawdownTarget) * 8;
  const tradePenalty = result.trades < 3 ? 0.25 : 0;
  const pfBonus = result.profitFactor >= config.minProfitFactor ? 1 : 0;

  return Math.min(3, pf) * 0.85
    + edge * 0.7
    + Math.max(-0.4, oosEdge) * 0.35
    + Math.min(0.6, result.strategyReturn) * 0.25
    + pfBonus
    - drawdownPenalty
    - tradePenalty;
}

function scoreValidatedRow(row) {
  const rolling = row.rolling?.summary;
  const regime = row.regime;
  const reality = row.reality;
  const regimeQuality = regime
    ? regime.segmentBeatRate * 0.35
      + Math.max(-0.4, regime.worstSegmentEdge) * 0.3
      + (regime.verdict === 'PASS' ? 0.5 : 0)
      - (regime.failed?.length || 0) * 0.25
    : 0;
  const realityQuality = reality
    ? reality.positiveEdgeRate * 0.45
      + Math.max(-0.4, reality.medianEdge) * 0.35
      + (reality.verdict === 'PASS' ? 0.55 : 0)
      - (reality.failed?.length || 0) * 0.28
    : 0;

  if (!rolling) return row.score + regimeQuality + realityQuality;

  const rollingEdge = rolling.strategyCompoundReturn - rolling.benchmarkCompoundReturn;
  const rollingPenalty = Math.max(0, rolling.maxFoldDrawdown - row.config.maxDrawdownTarget) * 6;
  const rollingProfitPenalty = rolling.strategyCompoundReturn > 0 ? 0 : 0.75;

  return row.score
    + Math.max(-0.6, rolling.strategyCompoundReturn) * 0.5
    + Math.max(-0.5, rollingEdge) * 0.65
    + rolling.beatRate * 0.45
    + (rolling.profitableRate || 0) * 0.25
    + regimeQuality
    + realityQuality
    - rollingPenalty
    - rollingProfitPenalty;
}

function summarizeRow({ strategy, config, result, rolling = null, regime = null, reality = null }) {
  const row = {
    strategyName: strategy.name,
    strategy,
    config,
    score: scoreRow({ result, config }),
    validatedScore: null,
    strategyReturn: result.strategyReturn,
    benchmarkReturn: result.benchmarkReturn,
    edge: result.strategyReturn - result.benchmarkReturn,
    oosReturn: result.oosReturn,
    oosBenchmarkReturn: result.oosBenchmarkReturn,
    maxDrawdown: result.maxDrawdown,
    profitFactor: result.profitFactor,
    trades: result.trades,
    currentSignal: result.currentSignal,
    currentRiskExposure: result.preGateSignal?.risk?.exposure || result.preGateSignal?.exposure || 0,
    rolling,
    regime,
    reality,
  };
  row.validatedScore = scoreValidatedRow(row);
  return row;
}

function rowSignature(row) {
  return [
    row.strategyName,
    row.strategyReturn.toFixed(8),
    row.benchmarkReturn.toFixed(8),
    row.maxDrawdown.toFixed(8),
    Number.isFinite(row.profitFactor) ? row.profitFactor.toFixed(8) : 'inf',
    row.trades,
  ].join('|');
}

function uniqueRows(rows) {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const signature = rowSignature(row);
    if (seen.has(signature)) continue;
    seen.add(signature);
    output.push(row);
  }
  return output;
}

export function buildProfitFactorLabChecks(row, config, robustness = null, regime = null, reality = null) {
  const rolling = row.rolling?.summary;
  const activeRegime = regime || row.regime || null;
  const activeReality = reality || row.reality || null;
  const checks = [
    {
      id: 'full-edge',
      label: 'Strategy return > buy & hold',
      pass: row.strategyReturn > row.benchmarkReturn,
    },
    {
      id: 'oos-edge',
      label: 'OOS return > OOS benchmark',
      pass: row.oosReturn > row.oosBenchmarkReturn,
    },
    {
      id: 'drawdown',
      label: 'Max drawdown binnen limiet',
      pass: row.maxDrawdown <= config.maxDrawdownTarget,
    },
    {
      id: 'profit-factor',
      label: 'Profit factor hoog genoeg',
      pass: row.profitFactor >= config.minProfitFactor,
    },
    {
      id: 'rolling-edge',
      label: 'Rolling walk-forward verslaat benchmark',
      pass: Boolean(rolling) && rolling.strategyCompoundReturn > rolling.benchmarkCompoundReturn,
    },
    {
      id: 'rolling-positive',
      label: 'Rolling walk-forward is positief',
      pass: Boolean(rolling) && rolling.strategyCompoundReturn > 0,
    },
    {
      id: 'rolling-beat-rate',
      label: 'Rolling beat-rate voldoende',
      pass: Boolean(rolling) && rolling.beatRate >= config.minWalkForwardBeatRate,
    },
    {
      id: 'rolling-profitable-rate',
      label: 'Meeste rolling windows zijn winstgevend',
      pass: Boolean(rolling) && rolling.profitableRate >= 0.5,
    },
    {
      id: 'current-exposure',
      label: 'Huidige risk engine exposure > 0',
      pass: row.currentRiskExposure > 0,
    },
  ];

  if (robustness) {
    checks.push({
      id: 'robustness',
      label: 'Parameter robustness voldoende',
      pass: robustness.verdict === 'PASS',
      detail: `${Math.round(robustness.passRate * 100)}% buren · median PF ${robustness.medianProfitFactor.toFixed(2)}`,
    });
  }

  if (activeRegime) {
    checks.push({
      id: 'regime-lab',
      label: 'Regime-lab blijft groen',
      pass: activeRegime.verdict === 'PASS',
      detail: `${activeRegime.verdict} · beat ${Math.round(activeRegime.segmentBeatRate * 100)}% · worst edge ${(activeRegime.worstSegmentEdge * 100).toFixed(1)}%`,
    });
  }

  if (activeReality) {
    checks.push({
      id: 'reality-check',
      label: 'Reality check blijft groen',
      pass: activeReality.verdict === 'PASS',
      detail: `${activeReality.verdict} · positive edge ${Math.round(activeReality.positiveEdgeRate * 100)}% · median edge ${(activeReality.medianEdge * 100).toFixed(1)}%`,
    });
  }

  return checks;
}

function verdictForChecks(checks) {
  const passed = checks.filter((check) => check.pass).length;

  if (checks.every((check) => check.pass)) return 'CANDIDATE';
  if (passed >= 4) return 'WATCH';
  return 'REJECT';
}

export function runProfitFactorLab({
  candlesByAsset,
  baseConfig = {},
  strategies = DEFAULT_PROFIT_FACTOR_STRATEGIES,
  grid = DEFAULT_PROFIT_FACTOR_GRID,
  assets = SUPPORTED_ASSETS,
  topN = 4,
  walkForwardOptions = {},
  robustnessOptions = {},
  regimeOptions = {},
  realityOptions = {},
} = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...baseConfig,
    timeframe: baseConfig.timeframe || '4H',
  };
  const variants = cartesianProduct(grid).map((variant) => ({
    ...config,
    ...variant,
  }));
  const baseRows = [];

  for (const strategy of strategies) {
    for (const variant of variants) {
      const result = runBacktest({
        candlesByAsset,
        config: variant,
        strategy,
        assets,
      });
      const regime = regimeOptions.enabled === false
        ? null
        : runRegimeBreakdown({
          candlesByAsset,
          result,
          thresholds: regimeOptions.thresholds,
        });
      const reality = realityOptions.enabled === false
        ? null
        : runRealityCheck({
          result,
          thresholds: realityOptions.thresholds,
          seed: realityOptions.seed,
        });
      baseRows.push(summarizeRow({
        strategy,
        config: variant,
        result,
        regime,
        reality,
      }));
    }
  }

  let shortlisted = uniqueRows(baseRows
    .sort((a, b) => b.score - a.score)
  )
    .slice(0, topN)
    .map((row) => {
      const rolling = runRollingWalkForward({
        candlesByAsset,
        baseConfig: row.config,
        strategy: row.strategy,
        assets,
        trainBars: 1080,
        testBars: 270,
        maxFolds: 5,
        grid: {
          rebalanceBars: [row.config.rebalanceBars],
          emergencyDrawdownStop: [row.config.emergencyDrawdownStop],
          targetVolatility: [row.config.targetVolatility],
        },
        ...walkForwardOptions,
      });
      const validated = summarizeRow({
        strategy: row.strategy,
        config: row.config,
        result: {
          strategyReturn: row.strategyReturn,
          benchmarkReturn: row.benchmarkReturn,
          oosReturn: row.oosReturn,
          oosBenchmarkReturn: row.oosBenchmarkReturn,
          maxDrawdown: row.maxDrawdown,
          profitFactor: row.profitFactor,
          trades: row.trades,
          currentSignal: row.currentSignal,
          preGateSignal: {
            risk: { exposure: row.currentRiskExposure },
            exposure: row.currentRiskExposure,
          },
        },
        rolling,
        regime: row.regime,
        reality: row.reality,
      });
      const checks = buildProfitFactorLabChecks(validated, row.config, null, row.regime, row.reality);
      return {
        ...validated,
        checks,
        failed: checks.filter((check) => !check.pass),
        verdict: verdictForChecks(checks),
      };
    })
    .sort((a, b) => b.validatedScore - a.validatedScore);

  const robustnessTarget = shortlisted.find((row) => row.verdict === 'CANDIDATE') || shortlisted[0] || null;
  if (robustnessTarget && robustnessOptions.enabled !== false) {
    const robustness = runParameterRobustness({
      candlesByAsset,
      strategy: robustnessTarget.strategy,
      baseConfig: robustnessTarget.config,
      assets,
      grid: robustnessOptions.grid,
      thresholds: robustnessOptions.thresholds,
    });

    shortlisted = shortlisted.map((row) => {
      if (row !== robustnessTarget) {
        if (row.verdict !== 'CANDIDATE') return row;
        const checks = [
          ...row.checks,
          {
            id: 'robustness',
            label: 'Parameter robustness voldoende',
            pass: false,
            detail: 'Niet zwaar getest; alleen de beste kandidaat krijgt de volledige robustness gate.',
          },
        ];
        return {
          ...row,
          checks,
          failed: checks.filter((check) => !check.pass),
          verdict: verdictForChecks(checks),
        };
      }
      const checks = buildProfitFactorLabChecks(row, row.config, robustness, row.regime, row.reality);
      return {
        ...row,
        robustness,
        checks,
        failed: checks.filter((check) => !check.pass),
        verdict: verdictForChecks(checks),
      };
    }).sort((a, b) => b.validatedScore - a.validatedScore);
  }

  const best = shortlisted[0] || null;
  const candidate = shortlisted.find((row) => row.verdict === 'CANDIDATE') || null;
  const watch = shortlisted.find((row) => row.verdict === 'WATCH') || null;

  return {
    ok: true,
    tested: baseRows.length,
    validated: shortlisted.length,
    best,
    candidate,
    watch,
    rows: shortlisted,
    message: candidate
      ? `${candidate.strategyName} haalt de profit-factor lab gate.`
      : watch
        ? `${watch.strategyName} verbetert trade-quality, maar is nog watchlist.`
        : 'Geen 4H variant haalt de profit-factor lab gate.',
  };
}
