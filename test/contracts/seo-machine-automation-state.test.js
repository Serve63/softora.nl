const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AUTOMATION_ID,
  AUTOMATION_NAME,
  AUTOMATION_RRULE,
  REQUIRED_PUBLISHED_RUN_GATES,
  REQUIRED_UBERSUGGEST_TOOLS,
  ROTATION_BLOCK,
  RUN_LIFECYCLE_BLOCK,
  UBERSUGGEST_BLOCK,
  auditAutomationInstallation,
  ensureAutomationState,
  finishAutomationRun,
  formatStateBlock,
  inspectAutomationState,
  recordAutomationRunGate,
  recordAutomationRunGateFromCli,
  recordUbersuggestRun,
  recordUbersuggestDataSmoke,
  recordUbersuggestToolBinding,
  recoverInterruptedRun,
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

function createGitRepository() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-gate-git-'));
  execFileSync('git', ['init', '-q'], { cwd: directory });
  execFileSync('git', ['config', 'user.email', 'test@softora.nl'], { cwd: directory });
  execFileSync('git', ['config', 'user.name', 'Softora test'], { cwd: directory });
  fs.writeFileSync(path.join(directory, 'proof.txt'), 'ready\n');
  execFileSync('git', ['add', 'proof.txt'], { cwd: directory });
  execFileSync('git', ['commit', '-qm', 'test tree'], { cwd: directory });
  return directory;
}

function validAutomationPrompt() {
  return [
    'SEO_MACHINE_PROMPT_VERSION=6',
    'SEO_AUTOMATION_EXCLUDED_PATHS=/website,/bedrijfssoftware,/voicesoftware,/chatbot',
    `The sole automation id is ${AUTOMATION_ID}.`,
    'Run npm run seo:automation-state -- start-run before effects.',
    'Recover explicitly with npm run seo:automation-state -- recover-run.',
    'Every final gate uses --record-run-gate.',
    'Run npm run seo:selection:check before implementation.',
    'Run npm run seo:reviews:check before implementation.',
    'Use a metrics object with nonBrandedClicks, nonBrandedImpressions, averagePosition and baselineComparison.',
    'Keep both evidence gates inside a 30-minute fresh GSC window.',
    'new_url must not exist there yet and must exactly match a ready path.',
    'Run npm run seo:live-route:check after production.',
    'Close every outcome with npm run seo:automation-state -- finish-run.',
    'Record setup evidence with npm run seo:automation-state -- record-tool-smoke.',
    'Require mcp__ubersuggest__keyword_suggestions, mcp__ubersuggest__google_suggestions, mcp__ubersuggest__keyword_overview and mcp__ubersuggest__serp_analysis.',
    'Select agent.browsers.get("iab") and use only the returned built-in ChatGPT/Codex browser binding.',
    'Google Chrome and Microsoft Edge are forbidden, with no generic browser fallback.',
    'This automation remains ACTIVE until Serve explicitly pauses.',
    'After 31 December 2026, continue on rolling evidence.',
    'Never buy credits or use paid fallbacks.',
    'Never use Qwen.',
  ].join(' ');
}

function ubersuggestSmokeOutcomes() {
  return Object.fromEntries(REQUIRED_UBERSUGGEST_TOOLS.map((tool) => [tool, {
    status: tool.endsWith('keyword_suggestions') ? 'ok_empty' : 'ok',
    resultCount: tool.endsWith('keyword_suggestions') ? 0 : 1,
  }]));
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
  recordUbersuggestDataSmoke({
    memoryPath,
    threadId,
    checkedAt: '2026-08-27T12:05:00.000Z',
    tools: REQUIRED_UBERSUGGEST_TOOLS.join(','),
    outcomes: ubersuggestSmokeOutcomes(),
    evidence: 'All four tools returned a real Netherlands and Dutch read-only data response without fallback.',
  });
  return memoryPath;
}

function recordPublishedGates(memoryPath, options = {}) {
  const threadId = options.threadId || 'thread-1';
  const invocationAt = options.invocationAt || '2026-08-28T08:15:00+02:00';
  const checkedAt = options.checkedAt || '2026-08-28T09:00:00+02:00';
  const treeSha = options.treeSha || '1'.repeat(40);
  const liveCommit = options.liveCommit || 'abcdef1234567890';
  const changedUrl = options.changedUrl || 'https://www.softora.nl/bedrijfssoftware-op-maat';
  const selectedPath = options.selectedPath || new URL(changedUrl).pathname;
  const selectedActionType = options.selectedActionType || 'substantial_refresh';
  const defaultSupportingAction = {
    type: 'contextual_internal_link',
    path: '/kennisbank/bestaande-route',
    verification: { kind: 'link_to_selected_url', value: null },
  };
  const supportingAction = Object.prototype.hasOwnProperty.call(options, 'supportingAction')
    ? options.supportingAction
    : defaultSupportingAction;
  const routeSupportingAction = Object.prototype.hasOwnProperty.call(options, 'routeSupportingAction')
    ? options.routeSupportingAction
    : { ...supportingAction, verified: true };
  for (const gate of REQUIRED_PUBLISHED_RUN_GATES) {
    let details = { status: 'ready', gate };
    if (gate === 'selection') {
      details = {
        status: 'ready',
        selectedPath,
        selectedActionType,
        supportingAction,
      };
    }
    if (gate === 'live_route') {
      details = {
        status: 'ready',
        summary: {
          url: changedUrl,
          supportingAction: routeSupportingAction,
        },
      };
    }
    recordAutomationRunGate({
      memoryPath,
      threadId,
      invocationAt,
      gate,
      checkedAt,
      details,
      treeSha: ['keywords', 'visuals', 'verify_critical', 'live_production', 'live_route'].includes(gate) ? treeSha : null,
      liveCommit: ['live_production', 'live_route'].includes(gate) ? liveCommit : null,
      changedUrl: gate === 'live_route' ? changedUrl : null,
    });
  }
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
  recordPublishedGates(memoryPath);
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
  assert.equal(receipt.completionGateStatus, 'ready');
  assert.equal(Object.keys(receipt.gates).length, REQUIRED_PUBLISHED_RUN_GATES.length);
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

test('finish-run blocks a published claim until every same-run gate is ready on the live tree', () => {
  const memoryPath = prepareOperationalState(createMemory());
  startAutomationRun({ memoryPath, threadId: 'thread-1', invocationAt: '2026-08-28T08:15:00+02:00' });
  recordPublishedGates(memoryPath);
  const content = fs.readFileSync(memoryPath, 'utf8');
  const lifecycle = inspectAutomationState(memoryPath).lifecycle;
  delete lifecycle.activeRun.gates.selection;
  fs.writeFileSync(memoryPath, content.replace(
    formatStateBlock(RUN_LIFECYCLE_BLOCK, inspectAutomationState(memoryPath).lifecycle),
    formatStateBlock(RUN_LIFECYCLE_BLOCK, lifecycle)
  ));

  assert.throws(() => finishAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt: '2026-08-28T08:15:00+02:00',
    finishedAt: '2026-08-28T09:05:00+02:00',
    outcome: 'published',
    publicEffect: 'live',
    evidence: 'Publication should be blocked because the selection receipt is missing.',
    prNumber: 1808,
    liveCommit: 'abcdef1234567890',
    changedUrl: 'https://www.softora.nl/bedrijfssoftware-op-maat',
  }), /PUBLISHED_GATES_INCOMPLETE.*selection/);
});

test('finish-run blocks tree drift between final validators and the live deployment', () => {
  const memoryPath = prepareOperationalState(createMemory());
  const invocationAt = '2026-08-28T08:15:00+02:00';
  startAutomationRun({ memoryPath, threadId: 'thread-1', invocationAt });
  recordPublishedGates(memoryPath, { invocationAt });
  recordAutomationRunGate({
    memoryPath,
    threadId: 'thread-1',
    invocationAt,
    gate: 'keywords',
    checkedAt: '2026-08-28T09:01:00+02:00',
    details: { status: 'ready', gate: 'keywords', rerun: true },
    treeSha: '2'.repeat(40),
  });

  assert.throws(() => finishAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt,
    finishedAt: '2026-08-28T09:05:00+02:00',
    outcome: 'published',
    publicEffect: 'live',
    evidence: 'Publication should be blocked because keyword evidence belongs to another tree.',
    prNumber: 1808,
    liveCommit: 'abcdef1234567890',
    changedUrl: 'https://www.softora.nl/bedrijfssoftware-op-maat',
  }), /PUBLISHED_GATES_INCOMPLETE.*keywords.*niet uitgevoerd op de live productietree/);
});

test('finish-run binds the selected path to the exact live route', () => {
  const memoryPath = prepareOperationalState(createMemory());
  const invocationAt = '2026-08-28T08:15:00+02:00';
  startAutomationRun({ memoryPath, threadId: 'thread-1', invocationAt });
  recordPublishedGates(memoryPath, {
    invocationAt,
    selectedPath: '/blog/selectie-a',
    changedUrl: 'https://www.softora.nl/blog/live-b',
  });

  assert.throws(() => finishAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt,
    finishedAt: '2026-08-28T09:05:00+02:00',
    outcome: 'published',
    publicEffect: 'live',
    evidence: 'Publication must bind the selected URL to the exact route checked in production.',
    prNumber: 1808,
    liveCommit: 'abcdef1234567890',
    changedUrl: 'https://www.softora.nl/blog/live-b',
  }), /PUBLISHED_GATES_INCOMPLETE.*selectedPath.*live route/i);
});

test('run-gate receipts can never record an excluded product route', () => {
  const memoryPath = prepareOperationalState(createMemory());
  const invocationAt = '2026-08-28T08:15:00+02:00';
  startAutomationRun({ memoryPath, threadId: 'thread-1', invocationAt });
  assert.throws(() => recordPublishedGates(memoryPath, {
    invocationAt,
    selectedPath: '/website',
    changedUrl: 'https://www.softora.nl/website',
  }), /gate\.changedUrl valt buiten de SEO-automation/i);
});

test('finish-run rejects an invalid selected action type even with green route evidence', () => {
  const memoryPath = prepareOperationalState(createMemory());
  const invocationAt = '2026-08-28T08:15:00+02:00';
  startAutomationRun({ memoryPath, threadId: 'thread-1', invocationAt });
  recordPublishedGates(memoryPath, { invocationAt, selectedActionType: 'invented_action' });

  assert.throws(() => finishAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt,
    finishedAt: '2026-08-28T09:05:00+02:00',
    outcome: 'published',
    publicEffect: 'live',
    evidence: 'Publication must retain a canonical selected action type through final closure.',
    prNumber: 1808,
    liveCommit: 'abcdef1234567890',
    changedUrl: 'https://www.softora.nl/bedrijfssoftware-op-maat',
  }), /PUBLISHED_GATES_INCOMPLETE.*selectedActionType/i);
});

test('finish-run requires live proof for every selected supporting optimization', () => {
  const memoryPath = prepareOperationalState(createMemory());
  const invocationAt = '2026-08-28T08:15:00+02:00';
  const supportingAction = {
    type: 'contextual_internal_link',
    path: '/kennisbank/bestaande-route',
    verification: { kind: 'link_to_selected_url', value: null },
  };
  startAutomationRun({ memoryPath, threadId: 'thread-1', invocationAt });
  recordPublishedGates(memoryPath, {
    invocationAt,
    selectedPath: '/blog/nieuwe-route',
    selectedActionType: 'substantial_refresh',
    supportingAction,
    routeSupportingAction: null,
    changedUrl: 'https://www.softora.nl/blog/nieuwe-route',
  });

  assert.throws(() => finishAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt,
    finishedAt: '2026-08-28T09:05:00+02:00',
    outcome: 'published',
    publicEffect: 'live',
    evidence: 'Publication must prove the selected supporting optimization on the live site.',
    prNumber: 1808,
    liveCommit: 'abcdef1234567890',
    changedUrl: 'https://www.softora.nl/blog/nieuwe-route',
  }), /PUBLISHED_GATES_INCOMPLETE.*supportingAction/i);

  recordAutomationRunGate({
    memoryPath,
    threadId: 'thread-1',
    invocationAt,
    gate: 'live_route',
    checkedAt: '2026-08-28T09:02:00+02:00',
    details: {
      status: 'ready',
      summary: {
        url: 'https://www.softora.nl/blog/nieuwe-route',
        supportingAction: { ...supportingAction, verified: true },
      },
    },
    treeSha: '1'.repeat(40),
    liveCommit: 'abcdef1234567890',
    changedUrl: 'https://www.softora.nl/blog/nieuwe-route',
  });
  const receipt = finishAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt,
    finishedAt: '2026-08-28T09:05:00+02:00',
    outcome: 'published',
    publicEffect: 'live',
    evidence: 'Publication proves the selected supporting optimization on the live site.',
    prNumber: 1808,
    liveCommit: 'abcdef1234567890',
    changedUrl: 'https://www.softora.nl/blog/nieuwe-route',
  });
  assert.equal(receipt.outcome, 'published');
});

test('run-gate digest exposes a mutated stored result', () => {
  const memoryPath = prepareOperationalState(createMemory());
  const invocationAt = '2026-08-28T08:15:00+02:00';
  startAutomationRun({ memoryPath, threadId: 'thread-1', invocationAt });
  recordAutomationRunGate({
    memoryPath,
    threadId: 'thread-1',
    invocationAt,
    gate: 'selection',
    checkedAt: '2026-08-28T08:30:00+02:00',
    details: { status: 'ready', selectedPath: '/blog/echt-pad' },
  });
  const inspected = inspectAutomationState(memoryPath);
  const content = fs.readFileSync(memoryPath, 'utf8');
  inspected.lifecycle.activeRun.gates.selection.summary.selectedPath = '/blog/gemanipuleerd-pad';
  fs.writeFileSync(memoryPath, content.replace(
    formatStateBlock(RUN_LIFECYCLE_BLOCK, inspectAutomationState(memoryPath).lifecycle),
    formatStateBlock(RUN_LIFECYCLE_BLOCK, inspected.lifecycle)
  ));

  assert.match(inspectAutomationState(memoryPath).lifecycleErrors.join(' '), /resultDigest wijkt af/);
});

test('tree-bound CLI receipts require the active invocation and a clean committed tree', () => {
  const memoryPath = prepareOperationalState(createMemory());
  const invocationAt = '2026-08-27T09:15:00+02:00';
  const cwd = createGitRepository();
  startAutomationRun({ memoryPath, threadId: 'thread-1', invocationAt });
  const receipt = recordAutomationRunGateFromCli({
    memoryPath,
    cwd,
    gateOptions: { enabled: true, threadId: 'thread-1', invocationAt },
    gate: 'keywords',
    details: { status: 'ready', checked: 12 },
  });

  assert.match(receipt.treeSha, /^[a-f0-9]{40}$/);
  fs.writeFileSync(path.join(cwd, 'proof.txt'), 'dirty\n');
  assert.throws(() => recordAutomationRunGateFromCli({
    memoryPath,
    cwd,
    gateOptions: { enabled: true, threadId: 'thread-1', invocationAt },
    gate: 'visuals',
    details: { status: 'ready', checked: 12 },
  }), /TREE_GATE_DIRTY/);
});

test('the next invocation fails closed until the unfinished previous run is recovered explicitly', () => {
  const memoryPath = prepareOperationalState(createMemory());
  startAutomationRun({ memoryPath, threadId: 'thread-1', invocationAt: '2026-08-28T08:15:00+02:00' });
  assert.throws(() => startAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt: '2026-08-29T08:15:00+02:00',
  }), /ACTIVE_RUN_REQUIRES_RECOVERY/);

  const inspected = inspectAutomationState(memoryPath);
  assert.equal(inspected.rotation.completedRunsInActiveThread, 7);
  assert.equal(inspected.lifecycle.receipts.length, 0);
  assert.equal(inspected.lifecycle.activeRun.invocationAt, '2026-08-28T08:15:00+02:00');
});

test('recover-run explicitly closes an unfinished invocation before the next counter increment', () => {
  const memoryPath = prepareOperationalState(createMemory());
  startAutomationRun({ memoryPath, threadId: 'thread-1', invocationAt: '2026-08-28T08:15:00+02:00' });
  const recovered = recoverInterruptedRun({
    memoryPath,
    threadId: 'thread-1',
    recoveredAt: '2026-08-28T10:00:00+02:00',
    evidence: 'Run stopped before finish-run; external effects were inspected and remain unverified.',
  });
  const inspected = inspectAutomationState(memoryPath);

  assert.equal(recovered.outcome, 'interrupted');
  assert.equal(recovered.publicEffect, 'unverified');
  assert.equal(inspected.lifecycle.activeRun, null);
  assert.equal(inspected.rotation.completedRunsInActiveThread, 7);
  assert.equal(recoverInterruptedRun({
    memoryPath,
    threadId: 'thread-1',
    recoveredAt: '2026-08-28T10:00:00+02:00',
    evidence: 'Run stopped before finish-run; external effects were inspected and remain unverified.',
  }).idempotent, true);
  assert.throws(() => recoverInterruptedRun({
    memoryPath,
    threadId: 'thread-1',
    recoveredAt: '2026-08-28T10:00:00+02:00',
    evidence: 'Different recovery evidence must not be accepted as the same receipt.',
  }), /NO_INTERRUPTED_RUN/);
});

test('finish-run retries fail closed when outcome evidence changes', () => {
  const memoryPath = prepareOperationalState(createMemory());
  const invocationAt = '2026-08-28T08:15:00+02:00';
  startAutomationRun({ memoryPath, threadId: 'thread-1', invocationAt });
  finishAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt,
    finishedAt: '2026-08-28T09:00:00+02:00',
    outcome: 'operations_p0',
    publicEffect: 'none',
    evidence: 'OAuth refresh failed before any public or external SEO effect.',
  });

  assert.throws(() => finishAutomationRun({
    memoryPath,
    threadId: 'thread-1',
    invocationAt,
    finishedAt: '2026-08-28T09:00:00+02:00',
    outcome: 'completed_no_publication',
    publicEffect: 'none',
    evidence: 'A changed retry must not rewrite the durable result.',
  }), /FINISH_RECEIPT_MISMATCH/);
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

test('automation installation audit rejects an Edge route even when IAB markers are present', () => {
  const memoryPath = prepareOperationalState(createMemory());
  const paths = createAutomationConfig(memoryPath, {
    prompt: `${validAutomationPrompt()} Legacy fallback agent.browsers.get("edge") family=edge.`,
  });
  const audit = auditAutomationInstallation({ memoryPath, ...paths });

  assert.equal(audit.status, 'invalid');
  assert.match(audit.errors.join(' '), /verboden browserroute/i);
});

test('automation installation audit rejects tool names without a real four-tool data smoke', () => {
  const memoryPath = createMemory();
  ensureAutomationState(memoryPath);
  recordUbersuggestToolBinding({
    memoryPath,
    threadId: 'thread-1',
    checkedAt: '2026-08-27T12:00:00.000Z',
    tools: REQUIRED_UBERSUGGEST_TOOLS.join(','),
    evidence: 'All four tool names are bound but no data call has run.',
  });
  const paths = createAutomationConfig(memoryPath);
  const audit = auditAutomationInstallation({ memoryPath, ...paths });

  assert.equal(audit.status, 'invalid');
  assert.match(audit.errors.join(' '), /data-smoke is niet bewezen/);
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
