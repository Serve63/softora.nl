import { accountingTestCases } from './accountingTests.js';
import { acceleratedReplayTestCases } from './acceleratedReplayTests.js';
import { candidateReplayGateTestCases } from './candidateReplayGateTests.js';
import { convexBreakoutTestCases } from './convexBreakoutTests.js';
import { costAwareTailGuardTestCases } from './costAwareTailGuardTests.js';
import { costStressLabTestCases } from './costStressLabTests.js';
import { improvementLoopTestCases } from './improvementLoopTests.js';
import { optimizerTestCases } from './optimizerTests.js';
import { parityTestCases } from './parityTests.js';
import { profitFactorLabTestCases } from './profitFactorLabTests.js';
import { promotionGateTestCases } from './promotionGateTests.js';
import { regimeLabTestCases } from './regimeLabTests.js';
import { realityCheckTestCases } from './realityCheckTests.js';
import { replayVariantLabTestCases } from './replayVariantLabTests.js';
import { robustnessLabTestCases } from './robustnessLabTests.js';
import { sprintRotationTestCases } from './sprintRotationTests.js';
import { tailGuardTestCases } from './tailGuardTests.js';
import { tailConvexMetaTestCases } from './tailConvexMetaTests.js';
import { timeframeResearchTestCases } from './timeframeResearchTests.js';
import { trialLedgerTestCases } from './trialLedgerTests.js';
import { walkForwardTestCases } from './walkForwardTests.js';
import { tournamentTestCases } from './tournamentTests.js';

async function executeTest(name, fn) {
  try {
    await fn();
    return { name, pass: true };
  } catch (error) {
    return {
      name,
      pass: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createAssert() {
  return (condition, message) => {
    if (!condition) throw new Error(message);
  };
}

export async function runAllTests() {
  const assert = createAssert();
  const results = [];
  const cases = [
    ...parityTestCases(),
    ...accountingTestCases(),
    ...acceleratedReplayTestCases(),
    ...candidateReplayGateTestCases(),
    ...convexBreakoutTestCases(),
    ...costAwareTailGuardTestCases(),
    ...costStressLabTestCases(),
    ...improvementLoopTestCases(),
    ...optimizerTestCases(),
    ...profitFactorLabTestCases(),
    ...promotionGateTestCases(),
    ...regimeLabTestCases(),
    ...realityCheckTestCases(),
    ...replayVariantLabTestCases(),
    ...robustnessLabTestCases(),
    ...sprintRotationTestCases(),
    ...tailGuardTestCases(),
    ...tailConvexMetaTestCases(),
    ...timeframeResearchTestCases(),
    ...trialLedgerTestCases(),
    ...walkForwardTestCases(),
    ...tournamentTestCases(),
  ];

  for (const testCase of cases) {
    results.push(await executeTest(testCase.name, () => testCase.run(assert)));
  }

  const failed = results.filter((result) => !result.pass).length;
  return {
    passed: results.length - failed,
    failed,
    results,
  };
}

function isNodeDirectRun() {
  return typeof process !== 'undefined'
    && process.argv?.[1]
    && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'));
}

if (isNodeDirectRun()) {
  const summary = await runAllTests();
  for (const result of summary.results) {
    const status = result.pass ? 'PASS' : 'FAIL';
    console.log(`${status} ${result.name}${result.error ? ` - ${result.error}` : ''}`);
  }
  console.log(`${summary.passed} passed, ${summary.failed} failed`);
  if (summary.failed) process.exitCode = 1;
}
