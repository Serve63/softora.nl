import frozenCandidate, { generateFrozenCandidateSignal } from './frozenCandidate.js';
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
  return [frozenCandidate, trendParticipation, createStrategySandbox()];
}
