import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import frozenCandidate from '../strategies/frozenCandidate.js';
import sprintRotation from '../strategies/sprintRotation.js';
import tailGuard from '../strategies/tailGuard.js';
import trendParticipation from '../strategies/trendParticipation.js';
import { runBacktest } from './backtester.js';
import { runCostStressLab } from './costStressLab.js';
import { runRegimeBreakdown } from './regimeLab.js';
import { runRealityCheck } from './realityCheck.js';
import { DEFAULT_CONFIG } from './riskEngine.js';
import { runParameterRobustness } from './robustnessLab.js';
import { runTrialLedgerValidation } from './trialLedger.js';
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
  tailGuard,
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
  const statistical = row.statistical;
  const costStress = row.costStress;
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
  const statisticalQuality = statistical
    ? Math.max(-1, Math.min(1, statistical.deflatedSharpe / 3)) * 0.45
      + Math.max(-1, Math.min(1, statistical.edgeSharpe / 3)) * 0.35
      + (statistical.verdict === 'PASS' ? 0.5 : 0)
      - (statistical.failed?.length || 0) * 0.25
    : 0;
  const costStressQuality = costStress
    ? Math.max(-0.4, costStress.worstReturn) * 0.25
      + Math.max(-0.4, costStress.worstEdge) * 0.3
      + Math.min(2, finiteProfitFactor(costStress.worstProfitFactor)) * 0.18
      + (costStress.verdict === 'PASS' ? 0.45 : 0)
      - (costStress.failed?.length || 0) * 0.28
    : 0;

  if (!rolling) return row.score + regimeQuality + realityQuality + statisticalQuality + costStressQuality;

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
    + statisticalQuality
    + costStressQuality
    - rollingPenalty
    - rollingProfitPenalty;
}

function summarizeRow({
  strategy,
  config,
  result,
  rolling = null,
  regime = null,
  reality = null,
  statistical = null,
  costStress = null,
}) {
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
    statistical,
    costStress,
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

function configRowSignature(row) {
  const config = row.config || {};
  return [
    row.strategyName,
    config.timeframe,
    config.guardMode,
    config.scoreThreshold,
    config.assetCap,
    config.rebalanceBars,
    config.emergencyDrawdownStop,
    config.targetVolatility,
    row.strategyReturn.toFixed(8),
    row.maxDrawdown.toFixed(8),
  ].join('|');
}

function absoluteReturnScore(row) {
  const pf = Math.min(3, finiteProfitFactor(row.profitFactor));
  const tradePenalty = row.trades < 3 ? 0.35 : 0;

  return row.strategyReturn * 1.15
    + Math.max(-0.35, row.oosReturn) * 0.75
    + pf * 0.22
    + (row.strategyReturn > 0 ? 0.4 : -0.35)
    + (row.oosReturn > 0 ? 0.25 : -0.15)
    - row.maxDrawdown * 1.5
    - tradePenalty;
}

function capitalPreservationScore(row) {
  const pf = Math.min(3, finiteProfitFactor(row.profitFactor));
  const targetDrawdown = row.config?.maxDrawdownTarget || DEFAULT_CONFIG.maxDrawdownTarget;
  const drawdownBonus = row.maxDrawdown <= targetDrawdown * 0.5 ? 0.35 : 0;
  const tradePenalty = row.trades < 3 ? 0.25 : 0;

  return -row.maxDrawdown * 2
    + Math.max(-0.35, row.edge) * 0.45
    + Math.max(-0.3, row.strategyReturn) * 0.35
    + pf * 0.24
    + drawdownBonus
    - tradePenalty;
}

function recentProfitScore(row) {
  const pf = Math.min(3, finiteProfitFactor(row.profitFactor));
  const oosEdge = row.oosReturn - row.oosBenchmarkReturn;

  return Math.max(-0.35, row.oosReturn) * 1.05
    + Math.max(-0.35, oosEdge) * 0.65
    + Math.max(-0.3, row.strategyReturn) * 0.25
    + pf * 0.16
    - row.maxDrawdown * 0.8;
}

function addShortlistRow({
  row,
  source,
  selected,
  selectedSignatures,
  strategyCounts,
  sourceCounts,
  topN,
  maxRowsPerStrategy,
}) {
  if (selected.length >= topN) return false;
  const signature = configRowSignature(row);
  if (selectedSignatures.has(signature)) return false;
  const strategyCount = strategyCounts.get(row.strategyName) || 0;
  if (strategyCount >= maxRowsPerStrategy) return false;

  selected.push({ ...row, shortlistSource: source });
  selectedSignatures.add(signature);
  strategyCounts.set(row.strategyName, strategyCount + 1);
  sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  return true;
}

function buildValidationShortlist(rows, topN, maxRowsPerStrategy = 2) {
  const unique = uniqueRows(rows);
  const buckets = [
    {
      id: 'composite-score',
      rows: [...unique].sort((a, b) => b.score - a.score),
    },
    {
      id: 'absolute-return',
      rows: [...unique].sort((a, b) => absoluteReturnScore(b) - absoluteReturnScore(a)),
    },
    {
      id: 'capital-preservation',
      rows: [...unique].sort((a, b) => capitalPreservationScore(b) - capitalPreservationScore(a)),
    },
    {
      id: 'recent-profit',
      rows: [...unique].sort((a, b) => recentProfitScore(b) - recentProfitScore(a)),
    },
  ];
  const selected = [];
  const selectedSignatures = new Set();
  const strategyCounts = new Map();
  const sourceCounts = new Map();
  const activeCap = Math.max(1, Math.floor(Number(maxRowsPerStrategy) || 1));

  for (const bucket of buckets) {
    bucket.rows.some((row) => addShortlistRow({
      row,
      source: bucket.id,
      selected,
      selectedSignatures,
      strategyCounts,
      sourceCounts,
      topN,
      maxRowsPerStrategy: activeCap,
    }));
  }

  let madeProgress = true;
  while (selected.length < topN && madeProgress) {
    madeProgress = false;
    for (const bucket of buckets) {
      const added = bucket.rows.some((row) => addShortlistRow({
        row,
        source: bucket.id,
        selected,
        selectedSignatures,
        strategyCounts,
        sourceCounts,
        topN,
        maxRowsPerStrategy: activeCap,
      }));
      madeProgress = madeProgress || added;
      if (selected.length >= topN) break;
    }
  }

  for (const bucket of buckets) {
    for (const row of bucket.rows) {
      if (selected.length >= topN) break;
      addShortlistRow({
        row,
        source: bucket.id,
        selected,
        selectedSignatures,
        strategyCounts,
        sourceCounts,
        topN,
        maxRowsPerStrategy: Number.POSITIVE_INFINITY,
      });
    }
  }

  return {
    rows: selected,
    strategyCounts: Object.fromEntries(strategyCounts),
    sourceCounts: Object.fromEntries(sourceCounts),
  };
}

export function buildProfitFactorLabChecks(
  row,
  config,
  robustness = null,
  regime = null,
  reality = null,
  statistical = null,
  costStress = null,
) {
  const rolling = row.rolling?.summary;
  const activeRegime = regime || row.regime || null;
  const activeReality = reality || row.reality || null;
  const activeStatistical = statistical || row.statistical || null;
  const activeCostStress = costStress || row.costStress || null;
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

  if (activeStatistical) {
    checks.push({
      id: 'trial-ledger',
      label: 'Trial ledger corrigeert voor veel geteste varianten',
      pass: activeStatistical.verdict === 'PASS',
      detail: `${activeStatistical.verdict} · DSR ${activeStatistical.deflatedSharpe.toFixed(2)} · trials ${activeStatistical.trialCount}`,
    });
  }

  if (activeCostStress) {
    checks.push({
      id: 'cost-stress',
      label: 'Kostenstress blijft groen',
      pass: activeCostStress.verdict === 'PASS',
      detail: `${activeCostStress.verdict} · return ${(activeCostStress.worstReturn * 100).toFixed(1)}% · edge ${(activeCostStress.worstEdge * 100).toFixed(1)}% · PF ${finiteProfitFactor(activeCostStress.worstProfitFactor).toFixed(2)}`,
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
  statValidationOptions = {},
  costStressOptions = {},
  maxRowsPerStrategy = 2,
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
  const trialCount = variants.length * strategies.length;
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
      const statistical = statValidationOptions.enabled === false
        ? null
        : runTrialLedgerValidation({
          result,
          trialCount,
          timeframe: variant.timeframe,
          thresholds: statValidationOptions.thresholds,
        });
      baseRows.push(summarizeRow({
        strategy,
        config: variant,
        result,
        regime,
        reality,
        statistical,
      }));
    }
  }

  const validationShortlist = buildValidationShortlist(baseRows, topN, maxRowsPerStrategy);
  let shortlisted = validationShortlist.rows
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
      const costStress = costStressOptions.enabled === false
        ? null
        : runCostStressLab({
          candlesByAsset,
          strategy: row.strategy,
          baseConfig: row.config,
          assets,
          multipliers: costStressOptions.multipliers,
          thresholds: costStressOptions.thresholds,
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
        statistical: row.statistical,
        costStress,
      });
      const checks = buildProfitFactorLabChecks(
        validated,
        row.config,
        null,
        row.regime,
        row.reality,
        row.statistical,
        costStress,
      );
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
      const checks = buildProfitFactorLabChecks(
        row,
        row.config,
        robustness,
        row.regime,
        row.reality,
        row.statistical,
        row.costStress,
      );
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
    diversity: {
      maxRowsPerStrategy,
      strategyCounts: validationShortlist.strategyCounts,
      sourceCounts: validationShortlist.sourceCounts,
    },
    message: candidate
      ? `${candidate.strategyName} haalt de profit-factor lab gate.`
      : watch
        ? `${watch.strategyName} verbetert trade-quality, maar is nog watchlist.`
        : 'Geen 4H variant haalt de profit-factor lab gate.',
  };
}
