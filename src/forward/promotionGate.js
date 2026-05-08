import { calculateForwardMetrics } from './forwardRunner.js';

export const DEFAULT_PROMOTION_RULES = Object.freeze({
  earlyKillLogs: 5,
  firstDecisionLogs: 15,
  promoteLogs: 45,
  minEdgeOverChampion: 0.02,
  minEdgeOverBenchmark: 0,
  maxDrawdown: 0.12,
  maxLossBeforeKill: -0.06,
  minGateOpenRate: 0.35,
});

function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return 'n.v.t.';
  return `${(value * 100).toFixed(digits)}%`;
}

function makeCheck(id, label, pass, active, detail) {
  return { id, label, pass, active, detail };
}

function activeFailures(checks) {
  return checks.filter((check) => check.active && !check.pass);
}

export function evaluatePromotionGate({
  championState,
  challengerState,
  championConfig = {},
  challengerConfig = {},
  rules = {},
} = {}) {
  const activeRules = { ...DEFAULT_PROMOTION_RULES, ...rules };
  const champion = calculateForwardMetrics(championState, championConfig);
  const challenger = calculateForwardMetrics(challengerState, challengerConfig);
  const hasChallenger = challenger.logs > 0;
  const earlyKillActive = challenger.logs >= activeRules.earlyKillLogs;
  const decisionActive = challenger.logs >= activeRules.firstDecisionLogs;
  const promotionActive = challenger.logs >= activeRules.promoteLogs;
  const championEdge = challenger.paperReturn - champion.paperReturn;
  const benchmarkEdge = challenger.paperReturn - challenger.benchmarkReturn;

  const checks = [
    makeCheck(
      'sample-size',
      'Genoeg watchlist forward logs voor eerste oordeel',
      decisionActive,
      decisionActive,
      `${challenger.logs}/${activeRules.firstDecisionLogs}`,
    ),
    makeCheck(
      'early-loss-control',
      'Vroege kill-switch: verlies blijft beperkt',
      challenger.paperReturn >= activeRules.maxLossBeforeKill,
      earlyKillActive,
      `${formatPercent(challenger.paperReturn)} grens ${formatPercent(activeRules.maxLossBeforeKill)}`,
    ),
    makeCheck(
      'drawdown-control',
      'Watchlist drawdown blijft binnen limiet',
      challenger.maxDrawdown <= activeRules.maxDrawdown,
      earlyKillActive,
      `${formatPercent(challenger.maxDrawdown)} limiet ${formatPercent(activeRules.maxDrawdown)}`,
    ),
    makeCheck(
      'beats-own-benchmark',
      'Watchlist verslaat eigen benchmark forward',
      benchmarkEdge >= activeRules.minEdgeOverBenchmark,
      decisionActive,
      `${formatPercent(challenger.paperReturn)} vs ${formatPercent(challenger.benchmarkReturn)}`,
    ),
    makeCheck(
      'beats-champion',
      'Watchlist verslaat huidige kampioen forward',
      championEdge >= activeRules.minEdgeOverChampion,
      decisionActive,
      `${formatPercent(challenger.paperReturn)} vs kampioen ${formatPercent(champion.paperReturn)} · edge ${formatPercent(championEdge)}`,
    ),
    makeCheck(
      'gate-health',
      'Watchlist gate is vaak genoeg open',
      challenger.gateOpenRate >= activeRules.minGateOpenRate,
      decisionActive,
      `${formatPercent(challenger.gateOpenRate, 0)} minimum ${formatPercent(activeRules.minGateOpenRate, 0)}`,
    ),
    makeCheck(
      'promotion-sample',
      'Genoeg logs voor promotiegesprek',
      promotionActive,
      promotionActive,
      `${challenger.logs}/${activeRules.promoteLogs}`,
    ),
  ];

  const failed = activeFailures(checks);
  const earlyKillFailed = checks.some((check) => (
    check.active
    && !check.pass
    && ['early-loss-control', 'drawdown-control'].includes(check.id)
  ));
  const decisionFailed = failed.some((check) => (
    ['beats-own-benchmark', 'beats-champion', 'gate-health'].includes(check.id)
  ));

  let verdict = 'WAITING';
  if (!hasChallenger) {
    verdict = 'WAITING';
  } else if (earlyKillFailed) {
    verdict = 'KILL_CHALLENGER';
  } else if (!decisionActive) {
    verdict = 'INCUBATING';
  } else if (decisionFailed) {
    verdict = 'KEEP_WATCHING';
  } else if (!promotionActive) {
    verdict = 'PASSING_EARLY';
  } else {
    verdict = 'PROMOTE_READY';
  }

  return {
    ok: true,
    paperOnly: true,
    autoPromote: false,
    verdict,
    checks,
    failed,
    rules: activeRules,
    champion,
    challenger,
    edgeOverChampion: championEdge,
    edgeOverBenchmark: benchmarkEdge,
    message: verdict === 'WAITING'
      ? 'Nog geen watchlist-forward logs om te beoordelen.'
      : verdict === 'INCUBATING'
        ? `Watchlist incubatie loopt: ${challenger.logs}/${activeRules.firstDecisionLogs} logs voor eerste oordeel.`
        : verdict === 'KILL_CHALLENGER'
          ? `Watchlist kandidaat faalt de vroege kill-switch: ${failed.map((check) => check.label).join(', ')}.`
          : verdict === 'KEEP_WATCHING'
            ? `Watchlist nog niet sterk genoeg: ${failed.map((check) => check.label).join(', ')}.`
            : verdict === 'PASSING_EARLY'
              ? 'Watchlist presteert goed genoeg voor nu, maar heeft nog niet genoeg logs voor promotie.'
              : 'Watchlist is PROMOTE_READY voor menselijke review; nog steeds paper-only.',
  };
}
