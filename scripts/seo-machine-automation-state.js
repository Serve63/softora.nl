#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROTATION_BLOCK = 'SEO_THREAD_ROTATION_STATE';
const UBERSUGGEST_BLOCK = 'SEO_UBERSUGGEST_STATE';
const DEFAULT_MAX_RUNS_PER_THREAD = 15;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const UBERSUGGEST_STATUSES = Object.freeze([
  'not_checked', 'not_required', 'ready', 'external_research_unavailable', 'auth_blocked', 'quota_blocked',
]);
const DEFAULT_MEMORY_PATH = path.join(
  os.homedir(), '.codex', 'automations', 'softora-seo-actiemachine', 'memory.md'
);
function stateBlockPattern(name) {
  const safe = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<!-- ${safe}_START -->\\s*\`\`\`json\\s*([\\s\\S]*?)\\s*\`\`\`\\s*<!-- ${safe}_END -->`, 'm');
}
function formatStateBlock(name, state) {
  return `<!-- ${name}_START -->\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n<!-- ${name}_END -->`;
}
function parseStateBlock(content, name) {
  const match = String(content || '').match(stateBlockPattern(name));
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch (error) {
    throw new Error(`${name} bevat ongeldige JSON: ${error.message}`);
  }
}
function replaceStateBlock(contentRaw, name, state) {
  const content = String(contentRaw || '').replace(/\s+$/, '');
  const block = formatStateBlock(name, state);
  const pattern = stateBlockPattern(name);
  return `${pattern.test(content) ? content.replace(pattern, block) : `${content}\n\n${block}`}\n`;
}
function validateRotationState(state) {
  const errors = [];
  if (!state || typeof state !== 'object') return ['Rotatiestaat ontbreekt.'];
  if (Number(state.schemaVersion) !== 1) errors.push('schemaVersion moet 1 zijn.');
  if (Number(state.maxRunsPerThread) !== DEFAULT_MAX_RUNS_PER_THREAD) errors.push('maxRunsPerThread moet 15 zijn.');
  if (!Number.isInteger(Number(state.batchNumber)) || Number(state.batchNumber) < 1) errors.push('batchNumber is ongeldig.');
  if (!String(state.activeThreadId || '').trim()) errors.push('activeThreadId ontbreekt.');
  const completed = Number(state.completedRunsInActiveThread);
  if (!Number.isInteger(completed) || completed < 0 || completed > 15) errors.push('completedRunsInActiveThread is ongeldig.');
  const rotationStatus = String(state.rotationStatus || '');
  if (!['active', 'rotation_due'].includes(rotationStatus)) errors.push('rotationStatus is ongeldig.');
  if (Number.isInteger(completed) && completed < 15 && rotationStatus !== 'active') {
    errors.push('rotationStatus moet active zijn onder 15 runs.');
  }
  if (completed === 15 && rotationStatus !== 'rotation_due') {
    errors.push('rotationStatus moet rotation_due zijn bij 15 runs.');
  }
  const previousThreadIds = state.previousThreadIds;
  if (!Array.isArray(previousThreadIds) || previousThreadIds.some((threadId) => !String(threadId || '').trim())) {
    errors.push('previousThreadIds is ongeldig.');
  } else if (new Set(previousThreadIds).size !== previousThreadIds.length) {
    errors.push('previousThreadIds bevat dubbelen.');
  }
  return errors;
}
function defaultUbersuggestState() {
  return {
    schemaVersion: 1, provider: 'ubersuggest', role: 'advisory_only', lastAuthCheckAt: null,
    lastWeeklyDiscoveryAt: null, lastStatus: 'not_checked', lastRunDate: null,
    contentCallsUsed: 0, weeklyCallsUsed: 0, lastEvidencePath: null,
  };
}
function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}
function validateUbersuggestState(state) {
  const errors = [];
  if (!state || typeof state !== 'object') return ['Ubersuggest-staat ontbreekt.'];
  if (Number(state.schemaVersion) !== 1 || state.provider !== 'ubersuggest' || state.role !== 'advisory_only') {
    errors.push('Ubersuggest-identiteit of adviserende rol is ongeldig.');
  }
  if (!UBERSUGGEST_STATUSES.includes(String(state.lastStatus || ''))) errors.push('lastStatus is ongeldig.');
  const contentCalls = Number(state.contentCallsUsed);
  const weeklyCalls = Number(state.weeklyCallsUsed);
  if (!Number.isInteger(contentCalls) || contentCalls < 0 || contentCalls > 6) errors.push('contentCallsUsed is ongeldig.');
  if (!Number.isInteger(weeklyCalls) || weeklyCalls < 0 || weeklyCalls > 2) errors.push('weeklyCallsUsed is ongeldig.');
  if (contentCalls + weeklyCalls > 8) errors.push('De totale Ubersuggest dagcap is 8 calls.');
  if (state.lastRunDate !== null && !validDay(state.lastRunDate)) errors.push('lastRunDate is ongeldig.');
  for (const key of ['lastAuthCheckAt', 'lastWeeklyDiscoveryAt']) {
    if (state[key] !== null && !Number.isFinite(new Date(state[key]).getTime())) errors.push(`${key} is ongeldig.`);
  }
  if (state.lastEvidencePath !== null) {
    const evidencePath = String(state.lastEvidencePath || '');
    if (!evidencePath || path.isAbsolute(evidencePath) || evidencePath.split(/[\\/]+/).includes('..')) {
      errors.push('lastEvidencePath moet een veilig relatief repopad zijn.');
    }
  }
  return errors;
}
function isWeeklyDiscoveryDue(state, now = new Date()) {
  const previous = new Date(state && state.lastWeeklyDiscoveryAt || '').getTime();
  return !Number.isFinite(previous) || now.getTime() - previous >= WEEK_MS;
}
function withMemoryLock(memoryPath, callback) {
  const lockPath = `${memoryPath}.lock`;
  let handle;
  try { handle = fs.openSync(lockPath, 'wx', 0o600); } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Automation memory is vergrendeld: ${lockPath}`);
    throw error;
  }
  try { return callback(); } finally {
    fs.closeSync(handle);
    fs.rmSync(lockPath, { force: true });
  }
}
function writeMemoryAtomic(memoryPath, content) {
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  const temporaryPath = `${memoryPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, content, { mode: 0o600 });
  fs.renameSync(temporaryPath, memoryPath);
  fs.chmodSync(memoryPath, 0o600);
}
function inspectAutomationState(memoryPath, now = new Date()) {
  const content = fs.readFileSync(memoryPath, 'utf8');
  const rotation = parseStateBlock(content, ROTATION_BLOCK);
  const stored = parseStateBlock(content, UBERSUGGEST_BLOCK);
  const ubersuggest = stored || defaultUbersuggestState();
  return {
    rotation, rotationErrors: validateRotationState(rotation), ubersuggest,
    ubersuggestErrors: stored ? validateUbersuggestState(stored) : ['Ubersuggest-staatblok ontbreekt.'],
    ubersuggestStatePresent: Boolean(stored), weeklyDiscoveryDue: isWeeklyDiscoveryDue(ubersuggest, now),
  };
}
function ensureAutomationState(memoryPath, now = new Date()) {
  return withMemoryLock(memoryPath, () => {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const rotation = parseStateBlock(content, ROTATION_BLOCK);
    const rotationErrors = validateRotationState(rotation);
    if (rotationErrors.length) throw new Error(`Ongeldige rotatiestaat: ${rotationErrors.join(' ')}`);
    const existing = parseStateBlock(content, UBERSUGGEST_BLOCK);
    const ubersuggest = existing || defaultUbersuggestState();
    const errors = validateUbersuggestState(ubersuggest);
    if (errors.length) throw new Error(`Ongeldige Ubersuggest-staat: ${errors.join(' ')}`);
    if (!existing) writeMemoryAtomic(memoryPath, replaceStateBlock(content, UBERSUGGEST_BLOCK, ubersuggest));
    return { rotation, ubersuggest, weeklyDiscoveryDue: isWeeklyDiscoveryDue(ubersuggest, now), createdUbersuggestState: !existing };
  });
}
function startAutomationRun({ memoryPath, threadId, invocationAt }) {
  return withMemoryLock(memoryPath, () => {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const current = parseStateBlock(content, ROTATION_BLOCK);
    const errors = validateRotationState(current);
    if (errors.length) throw new Error(`Ongeldige rotatiestaat: ${errors.join(' ')}`);
    if (String(current.activeThreadId) !== String(threadId || '')) throw new Error('Verkeerde automation-task.');
    if (!String(invocationAt || '').trim() || !Number.isFinite(new Date(invocationAt).getTime())) throw new Error('invocationAt is ongeldig.');
    if (current.lastInvocationAt === invocationAt) return { ...current, idempotent: true };
    if (Number(current.completedRunsInActiveThread) >= 15) throw new Error('ROTATION_REQUIRED: deze task heeft al 15 heartbeat-runs verwerkt.');
    const completedRunsInActiveThread = Number(current.completedRunsInActiveThread) + 1;
    const next = { ...current, completedRunsInActiveThread, lastInvocationAt: invocationAt, rotationStatus: completedRunsInActiveThread === 15 ? 'rotation_due' : 'active' };
    writeMemoryAtomic(memoryPath, replaceStateBlock(content, ROTATION_BLOCK, next));
    return next;
  });
}
function rotateAutomationThread({ memoryPath, fromThreadId, toThreadId, rotatedAt, evidence }) {
  return withMemoryLock(memoryPath, () => {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const current = parseStateBlock(content, ROTATION_BLOCK);
    const errors = validateRotationState(current);
    if (errors.length) throw new Error(`Ongeldige rotatiestaat: ${errors.join(' ')}`);
    const fromThread = String(fromThreadId || '').trim();
    const toThread = String(toThreadId || '').trim();
    const rotationEvidence = String(evidence || '').trim();
    if (!fromThread || !toThread || fromThread === toThread) throw new Error('Oude en nieuwe task moeten geldig en verschillend zijn.');
    if (!String(rotatedAt || '').trim() || !Number.isFinite(new Date(rotatedAt).getTime())) throw new Error('rotatedAt is ongeldig.');
    if (!rotationEvidence) throw new Error('Rotatiebewijs ontbreekt.');
    if (
      current.activeThreadId === toThread &&
      Number(current.completedRunsInActiveThread) === 0 &&
      current.previousThreadIds.at(-1) === fromThread &&
      current.rotatedAt === rotatedAt &&
      current.evidence === rotationEvidence
    ) return { ...current, idempotent: true };
    if (current.activeThreadId !== fromThread) throw new Error('De actieve task komt niet overeen met --from-thread.');
    if (Number(current.completedRunsInActiveThread) !== 15 || current.rotationStatus !== 'rotation_due') {
      throw new Error('ROTATION_NOT_DUE: roteer uitsluitend na de vijftiende heartbeat-run.');
    }
    if (current.previousThreadIds.includes(toThread)) throw new Error('De nieuwe task is al als historische task gebruikt.');
    const next = {
      ...current,
      batchNumber: Number(current.batchNumber) + 1,
      activeThreadId: toThread,
      completedRunsInActiveThread: 0,
      lastInvocationAt: null,
      rotatedAt,
      rotationStatus: 'active',
      previousThreadIds: [...current.previousThreadIds, fromThread],
      evidence: rotationEvidence,
    };
    const nextErrors = validateRotationState(next);
    if (nextErrors.length) throw new Error(`Nieuwe rotatiestaat is ongeldig: ${nextErrors.join(' ')}`);
    writeMemoryAtomic(memoryPath, replaceStateBlock(content, ROTATION_BLOCK, next));
    return next;
  });
}
function recordUbersuggestRun({ memoryPath, status, runDate, contentCallsUsed = 0, weeklyCallsUsed = 0, evidencePath = null, authCheckedAt = null, weeklyDiscoveryAt = null }) {
  return withMemoryLock(memoryPath, () => {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const current = parseStateBlock(content, UBERSUGGEST_BLOCK);
    if (!current) throw new Error('Ubersuggest-staatblok ontbreekt; voer eerst ensure uit.');
    const next = {
      ...current, lastStatus: String(status || 'not_checked'), lastRunDate: runDate || null,
      contentCallsUsed: Number(contentCallsUsed), weeklyCallsUsed: Number(weeklyCallsUsed),
      lastEvidencePath: evidencePath || null, lastAuthCheckAt: authCheckedAt || current.lastAuthCheckAt,
      lastWeeklyDiscoveryAt: weeklyDiscoveryAt || current.lastWeeklyDiscoveryAt,
    };
    const errors = validateUbersuggestState(next);
    if (errors.length) throw new Error(`Ongeldige Ubersuggest-staat: ${errors.join(' ')}`);
    writeMemoryAtomic(memoryPath, replaceStateBlock(content, UBERSUGGEST_BLOCK, next));
    return next;
  });
}
function parseArgs(argv) {
  const args = { command: argv[0] || 'inspect' };
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    if (key === '--memory') throw new Error('Een memory-padoverride is niet toegestaan.');
    if (!key.startsWith('--')) throw new Error(`Ongeldig argument: ${key}`);
    args[key.slice(2)] = argv[index + 1];
  }
  return args;
}
function runAutomationStateCli(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  const memoryPath = options.memoryPath || DEFAULT_MEMORY_PATH;
  let result;
  if (args.command === 'inspect') {
    result = inspectAutomationState(memoryPath, new Date(args.now || Date.now()));
    const errors = [...result.rotationErrors, ...result.ubersuggestErrors];
    if (errors.length) throw new Error(`Automation-state ongeldig: ${errors.join(' ')}`);
  } else if (args.command === 'ensure') result = ensureAutomationState(memoryPath, new Date(args.now || Date.now()));
  else if (args.command === 'start-run') result = startAutomationRun({ memoryPath, threadId: args.thread, invocationAt: args['invocation-at'] });
  else if (args.command === 'rotate-thread') result = rotateAutomationThread({
    memoryPath, fromThreadId: args['from-thread'], toThreadId: args['to-thread'],
    rotatedAt: args['rotated-at'], evidence: args.evidence,
  });
  else if (args.command === 'record-keywords') result = recordUbersuggestRun({
    memoryPath, status: args.status, runDate: args['run-date'], contentCallsUsed: args['content-calls'],
    weeklyCallsUsed: args['weekly-calls'], evidencePath: args['evidence-path'], authCheckedAt: args['auth-checked-at'],
    weeklyDiscoveryAt: args['weekly-discovery-at'],
  }); else throw new Error(`Onbekend automation-state commando: ${args.command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}
if (require.main === module) {
  try { runAutomationStateCli(); } catch (error) {
    console.error(`[seo-automation-state] ${error.message || String(error)}`);
    process.exitCode = 1;
  }
}
module.exports = {
  DEFAULT_MAX_RUNS_PER_THREAD, DEFAULT_MEMORY_PATH, ROTATION_BLOCK, UBERSUGGEST_BLOCK, UBERSUGGEST_STATUSES,
  defaultUbersuggestState, ensureAutomationState, formatStateBlock, inspectAutomationState, isWeeklyDiscoveryDue,
  parseArgs, parseStateBlock, recordUbersuggestRun, replaceStateBlock, rotateAutomationThread, runAutomationStateCli,
  startAutomationRun, validateRotationState, validateUbersuggestState,
};
