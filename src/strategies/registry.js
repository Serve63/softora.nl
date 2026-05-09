import costAwareTailGuard from './costAwareTailGuard.js';
import convexBreakout from './convexBreakout.js';
import frozenCandidate from './frozenCandidate.js';
import sprintRotation from './sprintRotation.js';
import tailConvexMeta from './tailConvexMeta.js';
import tailGuard from './tailGuard.js';
import trendParticipation from './trendParticipation.js';

export const STRATEGY_REGISTRY = Object.freeze([
  frozenCandidate,
  trendParticipation,
  sprintRotation,
  tailGuard,
  costAwareTailGuard,
  convexBreakout,
  tailConvexMeta,
]);

export function strategyForName(name) {
  return STRATEGY_REGISTRY.find((strategy) => strategy.name === name) || null;
}
