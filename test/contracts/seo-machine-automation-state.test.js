const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AUTOMATION_ID,
  AUTOMATION_NAME,
  AUTOMATION_RRULE,
  REQUIRED_UBERSUGGEST_TOOLS,
  ROTATION_BLOCK,
  RUN_LIFECYCLE_BLOCK,
  UBERSUGGEST_BLOCK,
  auditAutomationInstallation,
  ensureAutomationState,
  finishAutomationRun,
  formatStateBlock,
  inspectAutomationState,
  recordUbersuggestRun,
  recordUbersuggestToolBinding,
  repairAutomationThreadBinding,
  rotateAutomationThread,
  runAutomationStateCli,
  startAutomationRun,
} = require('../../scripts/seo-machine-automation-state');

function createMemory(completedRunsInActiveThread = 6) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-automation-state-'));
  const automationDirectory = path.join(directory, AUTOMATION_ID);
  fs.mkdirSync(automationDirectory);
  const memoryPath = path.join(automationDirectory, 'memory.md');
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

function validAutomationPrompt() {
  return [
    'SEO_MACHINE_PROMPT_VERSION=4',
    `The sole automation id is ${AUTOMATION_ID}.`,
    'Run npm run seo:automation-state -- start-run before effects.',
    'Run npm run seo:selection:check before implementation.',
    'Close every outcome with npm run seo:automation-state -- finish-run.',
    'Require mcp__ubersuggest__keyword_suggestions, mcp__ubersuggest__google_suggestions, mcp__ubersuggest__keyword_overview and mcp__ubersuggest__serp_analysis.',
    'Select agent.browsers.get("edge") and require family=edge followed by profileName=Codex.',
    'Google Chrome is forbidden.',
    'This automation remains ACTIVE until Serve explicitly pauses.',
    'After 31 December 2026, continue on rolling evidence.',
    'Never buy credits or use paid fallbacks.',
    'Never use Qwen.',
  ].join(' ');
}

function prepareOperationalState(memoryPath, threadId = 'thread-1') {
  ensureAutomationState(memoryPath);
  recordUbersuggestToolBinding({
    memoryPath,
    threadId,
    checkedAt: '2026-08-27T12:00:00.000Z',
    tools: REQUIRED_UBERSUGGEST_TOOLS.join(','),
    evidence: 'Setup task exposed all four required read-only Ubersuggest tools.',
  });
  return memoryPath;
}

function createCompletedRun15Memory() {
  const memoryPath = prepareOperationalState(createMemory(14));
  startAutomationRun({ memoryPath, threadId: 'thread-1', invocationAt: '2026-08-28T08:15:00+02:00' });
  finishAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt: '2026-08-28T08:15:00+02:00',
    finishedAt: '2026-08-28T09:00:00+02:00',
    outcome: 'completed_no_publication',
    publicEffect: 'none',
    evidence: 'Run 15 completed safely without a public effect because operations P0 blocked publication.',
  });
  return memoryPath;
}

function createAutomationConfig(memoryPath, overrides = {}) {
  const automationDirectory = path.dirname(memoryPath);
  const automationPath = path.join(automationDirectory, 'automation.toml');
  const config = {
    id: AUTOMATION_ID,
    kind: 'heartbeat',
    name: AUTOMATION_NAME,
    prompt: validAutomationPrompt(),
    status: 'ACTIVE',
    rrule: AUTOMATION_RRULE,
    targetThreadId: 'thread-1',
    ...overrides,
  };
  fs.writeFileSync(automationPath, [
    'version = 1',
    `id = ${JSON.stringify(config.id)}`,
    `kind = ${JSON.stringify(config.kind)}`,
    `name = ${JSON.stringify(config.name)}`,
    `prompt = ${JSON.stringify(config.prompt)}`,
    `status = ${JSON.stringify(config.status)}`,
    `rrule = ${JSON.stringify(config.rrule)}`,
    `target_thread_id = ${JSON.stringify(config.targetThreadId)}`,
    '',
  ].join('\n'));
  return {
    automationPath,
    automationsRoot: path.dirname(automationDirectory),
  };
}

test('automation state ensures Ubersuggest and lifecycle blocks without touching rotation', () => {
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
  assert.equal(inspected.lifecycleStatePresent, true);
  assert.equal(inspected.lifecycle.activeRun, null);
  assert.equal(inspected.weeklyDiscoveryDue, true);
  assert.match(fs.readFileSync(memoryPath, 'utf8'), new RegExp(`${UBERSUGGEST_BLOCK}_START`));
  assert.match(fs.readFileSync(memoryPath, 'utf8'), new RegExp(`${RUN_LIFECYCLE_BLOCK}_START`));
});

test('automation run start increments atomically and is idempotent for one invocation', () => {
  const memoryPath = prepareOperationalState(createMemory());
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
  assert.equal(duplicate.lifecycle, 'running');
});

test('finish-run closes the active invocation with a durable live receipt', () => {
  const memoryPath = prepareOperationalState(createMemory());
  startAutomationRun({ memoryPath, threadId: 'thread-1', invocationAt: '2026-08-28T08:15:00+02:00' });
  const receipt = finishAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt: '2026-08-28T08:15:00+02:00',
    finishedAt: '2026-08-28T09:05:00+02:00',
    outcome: 'published',
    publicEffect: 'live',
    evidence: 'PR #1808 merged and production parity plus route verification passed.',
    prNumber: 1808,
    liveCommit: 'abcdef1234567890',
    changedUrl: 'https://www.softora.nl/bedrijfssoftware-op-maat',
  });
  const inspected = inspectAutomationState(memoryPath);

  assert.equal(receipt.outcome, 'published');
  assert.equal(inspected.lifecycle.activeRun, null);
  assert.equal(inspected.lifecycle.lastReceipt.liveCommit, 'abcdef1234567890');
  assert.equal(inspected.lifecycle.receipts.length, 1);
  assert.equal(finishAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt: '2026-08-28T08:15:00+02:00',
    finishedAt: '2026-08-28T09:05:00+02:00',
    outcome: 'published',
    publicEffect: 'live',
    evidence: 'PR #1808 merged and production parity plus route verification passed.',
    prNumber: 1808,
    liveCommit: 'abcdef1234567890',
    changedUrl: 'https://www.softora.nl/bedrijfssoftware-op-maat',
  }).idempotent, true);
});

test('the next invocation exposes and seals an unfinished previous run as interrupted', () => {
  const memoryPath = prepareOperationalState(createMemory());
  startAutomationRun({ memoryPath, threadId: 'thread-1', invocationAt: '2026-08-28T08:15:00+02:00' });
  const next = startAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt: '2026-08-29T08:15:00+02:00',
  });

  assert.equal(next.completedRunsInActiveThread, 8);
  assert.equal(next.recoveredPreviousRun.outcome, 'interrupted');
  assert.equal(next.recoveredPreviousRun.publicEffect, 'unverified');
  assert.equal(inspectAutomationState(memoryPath).lifecycle.receipts[0].autoClosed, true);
});

test('mid-batch connector repair preserves count and requires fresh tool-binding proof', () => {
  const memoryPath = prepareOperationalState(createMemory(7));
  const repaired = repairAutomationThreadBinding({
    memoryPath,
    fromThreadId: 'thread-1',
    toThreadId: 'thread-2',
    repairedAt: '2026-08-28T12:00:00.000Z',
    reason: 'ubersuggest_toolset_unavailable',
    evidence: 'Setup-only replacement task exposed all required Ubersuggest tools.',
  });
  let inspected = inspectAutomationState(memoryPath);

  assert.equal(repaired.activeThreadId, 'thread-2');
  assert.equal(repaired.completedRunsInActiveThread, 7);
  assert.deepEqual(repaired.previousThreadIds, ['thread-1']);
  assert.equal(inspected.ubersuggest.boundThreadId, null);

  recordUbersuggestToolBinding({
    memoryPath,
    threadId: 'thread-2',
    checkedAt: '2026-08-28T12:01:00.000Z',
    tools: REQUIRED_UBERSUGGEST_TOOLS.join(','),
    evidence: 'Replacement setup turn listed all four tools and validate_site succeeded.',
  });
  inspected = inspectAutomationState(memoryPath);
  assert.equal(inspected.ubersuggest.boundThreadId, 'thread-2');
  assert.equal(inspected.ubersuggest.boundTools.length, 4);
});

test('automation state enforces the fifteen-run task ceiling', () => {
  const memoryPath = prepareOperationalState(createMemory(15));
  assert.throws(() => startAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt: '2026-08-28T08:15:00+02:00',
  }), /ROTATION_REQUIRED/);
});

test('automation state rotates atomically after run fifteen and is idempotent', () => {
  const memoryPath = createCompletedRun15Memory();
  const first = runAutomationStateCli([
    'rotate-thread',
    '--from-thread', 'thread-1',
    '--to-thread', 'thread-2',
    '--rotated-at', '2026-08-28T09:15:00+02:00',
    '--evidence', 'Same automation retargeted and verified.',
  ], { memoryPath });
  const duplicate = rotateAutomationThread({
    memoryPath,
    fromThreadId: 'thread-1',
    toThreadId: 'thread-2',
    rotatedAt: '2026-08-28T09:15:00+02:00',
    evidence: 'Same automation retargeted and verified.',
  });

  assert.equal(first.batchNumber, 2);
  assert.equal(first.activeThreadId, 'thread-2');
  assert.equal(first.completedRunsInActiveThread, 0);
  assert.equal(first.rotationStatus, 'active');
  assert.deepEqual(first.previousThreadIds, ['thread-1']);
  assert.equal(duplicate.idempotent, true);
});

test('automation state rejects early rotation and historical task reuse', () => {
  const earlyMemoryPath = prepareOperationalState(createMemory(14));
  assert.throws(() => rotateAutomationThread({
    memoryPath: earlyMemoryPath,
    fromThreadId: 'thread-1',
    toThreadId: 'thread-2',
    rotatedAt: '2026-08-28T09:15:00+02:00',
    evidence: 'Not due yet.',
  }), /ROTATION_NOT_DUE/);

  const dueMemoryPath = createCompletedRun15Memory();
  const content = fs.readFileSync(dueMemoryPath, 'utf8');
  const rotation = inspectAutomationState(dueMemoryPath).rotation;
  rotation.previousThreadIds = ['thread-2'];
  fs.writeFileSync(dueMemoryPath, content.replace(
    formatStateBlock(ROTATION_BLOCK, inspectAutomationState(dueMemoryPath).rotation),
    formatStateBlock(ROTATION_BLOCK, rotation)
  ));
  assert.throws(() => rotateAutomationThread({
    memoryPath: dueMemoryPath,
    fromThreadId: 'thread-1',
    toThreadId: 'thread-2',
    rotatedAt: '2026-08-28T09:15:00+02:00',
    evidence: 'Historical task reuse.',
  }), /historische task/);
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
    '--now',
    '2026-08-27T12:00:00.000Z',
  ], { memoryPath }), /Automation-state ongeldig/);
});

test('automation installation audit proves one active heartbeat, matching task and durable prompt controls', () => {
  const memoryPath = prepareOperationalState(createMemory());
  const paths = createAutomationConfig(memoryPath);
  const audit = auditAutomationInstallation({ memoryPath, ...paths });

  assert.equal(audit.status, 'ready');
  assert.equal(audit.matchingAutomationCount, 1);
  assert.equal(audit.automation.targetThreadId, 'thread-1');
  assert.deepEqual(audit.automation.missingPromptMarkers, []);
});

test('start-run CLI fails before increment when the automation target drifts', () => {
  const memoryPath = prepareOperationalState(createMemory());
  const paths = createAutomationConfig(memoryPath, { targetThreadId: 'wrong-thread' });

  assert.throws(() => runAutomationStateCli([
    'start-run',
    '--thread', 'thread-1',
    '--invocation-at', '2026-08-28T08:15:00+02:00',
  ], { memoryPath, ...paths }), /target_thread_id wijkt af/);
  assert.equal(inspectAutomationState(memoryPath).rotation.completedRunsInActiveThread, 6);
});

test('automation installation audit rejects a second Softora SEO automation', () => {
  const memoryPath = prepareOperationalState(createMemory());
  const paths = createAutomationConfig(memoryPath);
  const duplicateDirectory = path.join(paths.automationsRoot, 'seo-copy');
  fs.mkdirSync(duplicateDirectory);
  fs.copyFileSync(paths.automationPath, path.join(duplicateDirectory, 'automation.toml'));

  const audit = auditAutomationInstallation({ memoryPath, ...paths });
  assert.equal(audit.status, 'invalid');
  assert.match(audit.errors.join(' '), /exact 1 Softora SEO-automation/);
});

test('automation-state CLI rejects a command-line memory path override', () => {
  assert.throws(() => runAutomationStateCli([
    'inspect',
    '--memory',
    '/tmp/not-the-seo-automation.md',
  ]), /memory-padoverride is niet toegestaan/);
});
