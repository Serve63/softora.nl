import costAwareTailGuard from './costAwareTailGuard.js';
import convexBreakout from './convexBreakout.js';
import frozenCandidate, { generateFrozenCandidateSignal } from './frozenCandidate.js';
import sprintRotation from './sprintRotation.js';
import trendParticipation from './trendParticipation.js';

export function createStrategySandbox(overrides = {}) {
  return {
    name: overrides.name || 'Sandbox Candidate',
    generateSignal(context) {
      return generateFrozenCandidateSignal({
        ...context,
        config: {
          ...context.config,
          ...overrides,
        },
      });
    },
  };
}

export function getAvailableStrategies() {
  return [
    frozenCandidate,
    trendParticipation,
    sprintRotation,
    costAwareTailGuard,
    convexBreakout,
    createStrategySandbox(),
  ];
}
