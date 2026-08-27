const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ROTATION_BLOCK,
  UBERSUGGEST_BLOCK,
  ensureAutomationState,
  formatStateBlock,
  inspectAutomationState,
  recordUbersuggestRun,
  startAutomationRun,
} = require('../../server/services/seo-machine-automation-state');
const {
  runAutomationStateCli,
} = require('../../scripts/seo-machine-automation-state');

function createMemory(completedRunsInActiveThread = 6) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-automation-state-'));
  const memoryPath = path.join(directory, 'memory.md');
  const rotation = {
    schemaVersion: 1,
    maxRunsPerThread: 15,
    batchNumber: 1,
    activeThreadId: 'thread-1',
    completedRunsInActiveThread,
    lastInvocationAt: '2026-08-27T08:15:00+02:00',
    rotatedAt: '2026-08-21T00:00:00+02:00',
    rotationStatus: completedRunsInActiveThread >= 15 ? 'rotation_due' : 'active',
    previousThreadIds: [],
  };
  fs.writeFileSync(memoryPath, `History\n\n${formatStateBlock(ROTATION_BLOCK, rotation)}\n`);
  return memoryPath;
}

test('automation state ensures one machine-readable Ubersuggest block without touching rotation', () => {
  const memoryPath = createMemory();
  const before = inspectAutomationState(memoryPath, new Date('2026-08-27T12:00:00Z'));
  assert.equal(before.ubersuggestStatePresent, false);
  assert.match(before.ubersuggestErrors[0], /ontbreekt/);
  const result = ensureAutomationState(memoryPath, new Date('2026-08-27T12:00:00Z'));
  const inspected = inspectAutomationState(memoryPath, new Date('2026-08-27T12:00:00Z'));

  assert.equal(result.createdUbersuggestState, true);
  assert.equal(inspected.rotation.completedRunsInActiveThread, 6);
  assert.equal(inspected.ubersuggest.role, 'advisory_only');
  assert.equal(inspected.ubersuggestStatePresent, true);
  assert.equal(inspected.weeklyDiscoveryDue, true);
  assert.match(fs.readFileSync(memoryPath, 'utf8'), new RegExp(`${UBERSUGGEST_BLOCK}_START`));
});

test('automation run start increments atomically and is idempotent for one invocation', () => {
  const memoryPath = createMemory();
  const first = startAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt: '2026-08-28T08:15:00+02:00',
  });
  const duplicate = startAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt: '2026-08-28T08:15:00+02:00',
  });

  assert.equal(first.completedRunsInActiveThread, 7);
  assert.equal(duplicate.completedRunsInActiveThread, 7);
  assert.equal(duplicate.idempotent, true);
});

test('automation state enforces the fifteen-run task ceiling', () => {
  const memoryPath = createMemory(15);
  assert.throws(() => startAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt: '2026-08-28T08:15:00+02:00',
  }), /ROTATION_REQUIRED/);
});

test('Ubersuggest state records bounded advisory usage and weekly freshness', () => {
  const memoryPath = createMemory();
  ensureAutomationState(memoryPath);
  recordUbersuggestRun({
    memoryPath,
    status: 'ready',
    runDate: '2026-08-28',
    contentCallsUsed: 4,
    weeklyCallsUsed: 2,
    evidencePath: 'reports/seo-agent/keyword-evidence.json',
    authCheckedAt: '2026-08-28T06:20:00.000Z',
    weeklyDiscoveryAt: '2026-08-28T06:25:00.000Z',
  });
  const inspected = inspectAutomationState(memoryPath, new Date('2026-08-29T06:25:00.000Z'));
  assert.equal(inspected.ubersuggest.contentCallsUsed, 4);
  assert.equal(inspected.ubersuggest.weeklyCallsUsed, 2);
  assert.equal(inspected.weeklyDiscoveryDue, false);
});

test('Ubersuggest state rejects invented status and unsafe evidence paths', () => {
  const memoryPath = createMemory();
  ensureAutomationState(memoryPath);
  assert.throws(() => recordUbersuggestRun({
    memoryPath,
    status: 'provider_decided_to_publish',
    runDate: '2026-08-28',
    contentCallsUsed: 4,
    weeklyCallsUsed: 0,
    evidencePath: '../secrets.json',
  }), /Ongeldige Ubersuggest-staat/);
});

test('automation-state inspect CLI fails closed when a required block is missing', () => {
  const memoryPath = createMemory();
  assert.throws(() => runAutomationStateCli([
    'inspect',
    '--memory',
    memoryPath,
    '--now',
    '2026-08-27T12:00:00.000Z',
  ]), /Automation-state ongeldig/);
});
