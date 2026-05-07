import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import { DEFAULT_CONFIG } from './riskEngine.js';
import { runStrategyTournament } from './strategyTournament.js';

export const DEFAULT_TIMEFRAME_RESEARCH = Object.freeze({
  Daily: {
    candleTarget: 3000,
    walkForwardOptions: {},
  },
  '4H': {
    candleTarget: 3000,
    walkForwardOptions: {
      trainBars: 1080,
      testBars: 270,
      maxFolds: 5,
    },
  },
});

function summarizeFailures(row) {
  return row.failed
    .filter((check) => check.id !== 'current-exposure')
    .map((check) => check.id);
}

function scoreTimeframeRow({ best, rollingLeader }) {
  if (!best?.rolling) return Number.NEGATIVE_INFINITY;
  const historicalFailures = best.failed.filter((check) => check.id !== 'current-exposure').length;
  const rollingEdge = best.rolling.strategyCompoundReturn - best.rolling.benchmarkCompoundReturn;
  const fullEdge = best.strategyReturn - best.benchmarkReturn;
  const rollingLeaderEdge = rollingLeader?.rolling
    ? rollingLeader.rolling.strategyCompoundReturn - rollingLeader.rolling.benchmarkCompoundReturn
    : 0;
  const verdictBonus = best.verdict === 'GATE_OPEN'
    ? 2
    : best.verdict === 'RESEARCH_PASS_CASH'
      ? 1.2
      : best.verdict === 'WATCH'
        ? 0.45
        : 0;

  return rollingEdge * 1.1
    + Math.max(-0.5, fullEdge) * 0.45
    + Math.max(-0.5, rollingLeaderEdge) * 0.35
    + (best.rolling.beatRate || 0) * 0.9
    + verdictBonus
    - historicalFailures * 0.3;
}

function summarizeTimeframe({ timeframe, tournament }) {
  const best = tournament.best;
  const rollingLeader = tournament.rollingLeader;
  const summary = {
    timeframe,
    bestStrategy: best?.strategyName || 'n.v.t.',
    bestVerdict: best?.verdict || 'REJECT',
    rollingLeader: rollingLeader?.strategyName || 'n.v.t.',
    score: scoreTimeframeRow({ best, rollingLeader }),
    strategyReturn: best?.strategyReturn ?? 0,
    benchmarkReturn: best?.benchmarkReturn ?? 0,
    oosReturn: best?.oosReturn ?? 0,
    oosBenchmarkReturn: best?.oosBenchmarkReturn ?? 0,
    maxDrawdown: best?.maxDrawdown ?? 0,
    profitFactor: best?.profitFactor ?? 0,
    rollingReturn: best?.rolling?.strategyCompoundReturn ?? 0,
    rollingBenchmarkReturn: best?.rolling?.benchmarkCompoundReturn ?? 0,
    rollingBeatRate: best?.rolling?.beatRate ?? 0,
    rollingLeaderReturn: rollingLeader?.rolling?.strategyCompoundReturn ?? 0,
    rollingLeaderBenchmarkReturn: rollingLeader?.rolling?.benchmarkCompoundReturn ?? 0,
    failed: best ? summarizeFailures(best) : ['no-result'],
    currentSignal: best?.currentSignal?.label || 'CASH',
    tournament,
  };

  return summary;
}

export function runTimeframeResearch({
  datasetsByTimeframe,
  baseConfig = {},
  strategies,
  assets = SUPPORTED_ASSETS,
  plan = DEFAULT_TIMEFRAME_RESEARCH,
} = {}) {
  const config = { ...DEFAULT_CONFIG, ...baseConfig };
  const rows = Object.entries(plan).map(([timeframe, options]) => {
    const candlesByAsset = datasetsByTimeframe?.[timeframe]?.candlesByAsset || datasetsByTimeframe?.[timeframe] || {};
    const tournament = runStrategyTournament({
      candlesByAsset,
      baseConfig: {
        ...config,
        timeframe,
        candleTarget: options.candleTarget || config.candleTarget,
      },
      strategies,
      assets,
      walkForwardOptions: options.walkForwardOptions || {},
    });

    return summarizeTimeframe({ timeframe, tournament });
  }).sort((a, b) => b.score - a.score);

  const best = rows[0] || null;
  const deployable = rows.find((row) => row.bestVerdict === 'GATE_OPEN') || null;
  const researchLead = rows.find((row) => row.bestVerdict === 'RESEARCH_PASS_CASH' || row.bestVerdict === 'WATCH') || best;

  return {
    ok: rows.length > 0,
    best,
    deployable,
    researchLead,
    rows,
    message: deployable
      ? `${deployable.timeframe} heeft een strategie met open gate.`
      : researchLead
        ? `${researchLead.timeframe} is het beste research-spoor, maar de live-gate blijft dicht.`
        : 'Geen timeframe levert een bruikbare research-kandidaat op.',
  };
}
