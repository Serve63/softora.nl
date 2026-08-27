const fs = require('node:fs');
const path = require('node:path');

const ROTATION_BLOCK = 'SEO_THREAD_ROTATION_STATE';
const UBERSUGGEST_BLOCK = 'SEO_UBERSUGGEST_STATE';
const DEFAULT_MAX_RUNS_PER_THREAD = 15;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const UBERSUGGEST_STATUSES = Object.freeze([
  'not_checked',
  'not_required',
  'ready',
  'external_research_unavailable',
  'auth_blocked',
  'quota_blocked',
]);

function escapePattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stateBlockPattern(blockName) {
  const name = escapePattern(blockName);
  return new RegExp(
    '<!-- ' + name + '_START -->\\s*```json\\s*([\\s\\S]*?)\\s*```\\s*<!-- ' + name + '_END -->',
    'm'
  );
}

function formatStateBlock(blockName, state) {
  return `<!-- ${blockName}_START -->\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n<!-- ${blockName}_END -->`;
}

function parseStateBlock(contentRaw, blockName) {
  const match = String(contentRaw || '').match(stateBlockPattern(blockName));
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    const wrapped = new Error(`${blockName} bevat ongeldige JSON: ${error.message}`);
    wrapped.code = 'INVALID_AUTOMATION_STATE';
    throw wrapped;
  }
}

function replaceStateBlock(contentRaw, blockName, state) {
  const content = String(contentRaw || '').replace(/\s+$/, '');
  const block = formatStateBlock(blockName, state);
  const pattern = stateBlockPattern(blockName);
  if (pattern.test(content)) return `${content.replace(pattern, block)}\n`;
  return `${content}\n\n${block}\n`;
}

function validateRotationState(state) {
  const errors = [];
  if (!state || typeof state !== 'object') return ['Rotatiestaat ontbreekt.'];
  if (Number(state.schemaVersion) !== 1) errors.push('schemaVersion moet 1 zijn.');
  if (Number(state.maxRunsPerThread) !== DEFAULT_MAX_RUNS_PER_THREAD) {
    errors.push(`maxRunsPerThread moet ${DEFAULT_MAX_RUNS_PER_THREAD} zijn.`);
  }
  if (!Number.isInteger(Number(state.batchNumber)) || Number(state.batchNumber) < 1) {
    errors.push('batchNumber moet een positief geheel getal zijn.');
  }
  if (!String(state.activeThreadId || '').trim()) errors.push('activeThreadId ontbreekt.');
  const completed = Number(state.completedRunsInActiveThread);
  if (!Number.isInteger(completed) || completed < 0 || completed > DEFAULT_MAX_RUNS_PER_THREAD) {
    errors.push(`completedRunsInActiveThread moet tussen 0 en ${DEFAULT_MAX_RUNS_PER_THREAD} liggen.`);
  }
  if (!['active', 'rotation_due'].includes(String(state.rotationStatus || ''))) {
    errors.push('rotationStatus moet active of rotation_due zijn.');
  }
  return errors;
}

function defaultUbersuggestState() {
  return {
    schemaVersion: 1,
    provider: 'ubersuggest',
    role: 'advisory_only',
    lastAuthCheckAt: null,
    lastWeeklyDiscoveryAt: null,
    lastStatus: 'not_checked',
    lastRunDate: null,
    contentCallsUsed: 0,
    weeklyCallsUsed: 0,
    lastEvidencePath: null,
  };
}

function validateUbersuggestState(state) {
  const errors = [];
  if (!state || typeof state !== 'object') return ['Ubersuggest-staat ontbreekt.'];
  if (Number(state.schemaVersion) !== 1) errors.push('Ubersuggest schemaVersion moet 1 zijn.');
  if (state.provider !== 'ubersuggest') errors.push('provider moet ubersuggest zijn.');
  if (state.role !== 'advisory_only') errors.push('Ubersuggest role moet advisory_only zijn.');
  if (!UBERSUGGEST_STATUSES.includes(String(state.lastStatus || ''))) {
    errors.push(`lastStatus moet een van ${UBERSUGGEST_STATUSES.join(', ')} zijn.`);
  }
  for (const key of ['contentCallsUsed', 'weeklyCallsUsed']) {
    const value = Number(state[key]);
    if (!Number.isInteger(value) || value < 0) errors.push(`${key} moet een niet-negatief geheel getal zijn.`);
  }
  if (Number(state.contentCallsUsed) > 6) errors.push('contentCallsUsed mag maximaal 6 zijn.');
  if (Number(state.weeklyCallsUsed) > 2) errors.push('weeklyCallsUsed mag maximaal 2 zijn.');
  if (Number(state.contentCallsUsed) + Number(state.weeklyCallsUsed) > 8) {
    errors.push('De totale Ubersuggest dagcap is 8 calls.');
  }
  if (state.lastRunDate !== null && !isValidCalendarDate(state.lastRunDate)) {
    errors.push('lastRunDate moet null of YYYY-MM-DD zijn.');
  }
  for (const key of ['lastAuthCheckAt', 'lastWeeklyDiscoveryAt']) {
    if (state[key] !== null && !Number.isFinite(new Date(state[key]).getTime())) {
      errors.push(`${key} moet null of een geldige datum zijn.`);
    }
  }
  if (state.lastEvidencePath !== null) {
    const evidencePath = String(state.lastEvidencePath || '');
    if (!evidencePath || path.isAbsolute(evidencePath) || evidencePath.split(/[\\/]+/).includes('..')) {
      errors.push('lastEvidencePath moet null of een veilig relatief repopad zijn.');
    }
  }
  return errors;
}

function isWeeklyDiscoveryDue(state, now = new Date()) {
  const previous = new Date(state && state.lastWeeklyDiscoveryAt || '').getTime();
  if (!Number.isFinite(previous)) return true;
  return now.getTime() - previous >= WEEK_MS;
}

function isValidCalendarDate(valueRaw) {
  const value = String(valueRaw || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function withMemoryLock(memoryPath, callback) {
  const lockPath = `${memoryPath}.lock`;
  let lockHandle;
  try {
    lockHandle = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      const wrapped = new Error(`Automation memory is vergrendeld: ${lockPath}`);
      wrapped.code = 'AUTOMATION_STATE_LOCKED';
      throw wrapped;
    }
    throw error;
  }

  try {
    return callback();
  } finally {
    if (lockHandle !== undefined) fs.closeSync(lockHandle);
    fs.rmSync(lockPath, { force: true });
  }
}

function writeMemoryAtomic(memoryPath, content) {
  const directory = path.dirname(memoryPath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = `${memoryPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, content, { mode: 0o600 });
  fs.renameSync(temporaryPath, memoryPath);
  fs.chmodSync(memoryPath, 0o600);
}

function inspectAutomationState(memoryPath, now = new Date()) {
  const content = fs.readFileSync(memoryPath, 'utf8');
  const rotation = parseStateBlock(content, ROTATION_BLOCK);
  const storedUbersuggest = parseStateBlock(content, UBERSUGGEST_BLOCK);
  const ubersuggest = storedUbersuggest || defaultUbersuggestState();
  return {
    rotation,
    rotationErrors: validateRotationState(rotation),
    ubersuggest,
    ubersuggestErrors: storedUbersuggest
      ? validateUbersuggestState(ubersuggest)
      : ['Ubersuggest-staatblok ontbreekt.'],
    ubersuggestStatePresent: Boolean(storedUbersuggest),
    weeklyDiscoveryDue: isWeeklyDiscoveryDue(ubersuggest, now),
  };
}

function ensureAutomationState(memoryPath, now = new Date()) {
  return withMemoryLock(memoryPath, () => {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const rotation = parseStateBlock(content, ROTATION_BLOCK);
    const rotationErrors = validateRotationState(rotation);
    if (rotationErrors.length) throw new Error(`Ongeldige rotatiestaat: ${rotationErrors.join(' ')}`);
    const existingUbersuggest = parseStateBlock(content, UBERSUGGEST_BLOCK);
    const ubersuggest = existingUbersuggest || defaultUbersuggestState();
    const ubersuggestErrors = validateUbersuggestState(ubersuggest);
    if (ubersuggestErrors.length) throw new Error(`Ongeldige Ubersuggest-staat: ${ubersuggestErrors.join(' ')}`);
    if (!existingUbersuggest) writeMemoryAtomic(memoryPath, replaceStateBlock(content, UBERSUGGEST_BLOCK, ubersuggest));
    return {
      rotation,
      ubersuggest,
      weeklyDiscoveryDue: isWeeklyDiscoveryDue(ubersuggest, now),
      createdUbersuggestState: !existingUbersuggest,
    };
  });
}

function startAutomationRun({ memoryPath, threadId, invocationAt }) {
  return withMemoryLock(memoryPath, () => {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const rotation = parseStateBlock(content, ROTATION_BLOCK);
    const errors = validateRotationState(rotation);
    if (errors.length) throw new Error(`Ongeldige rotatiestaat: ${errors.join(' ')}`);
    if (String(rotation.activeThreadId) !== String(threadId || '')) {
      throw new Error(`Verkeerde automation-task: verwacht ${rotation.activeThreadId}, kreeg ${threadId || 'geen'}.`);
    }
    if (!String(invocationAt || '').trim() || !Number.isFinite(new Date(invocationAt).getTime())) {
      throw new Error('invocationAt moet een geldige ISO-datum zijn.');
    }
    if (rotation.lastInvocationAt === invocationAt) {
      return { ...rotation, idempotent: true };
    }
    if (Number(rotation.completedRunsInActiveThread) >= Number(rotation.maxRunsPerThread)) {
      const error = new Error('ROTATION_REQUIRED: deze task heeft al 15 heartbeat-runs verwerkt.');
      error.code = 'ROTATION_REQUIRED';
      throw error;
    }
    const completedRunsInActiveThread = Number(rotation.completedRunsInActiveThread) + 1;
    const next = {
      ...rotation,
      completedRunsInActiveThread,
      lastInvocationAt: invocationAt,
      rotationStatus: completedRunsInActiveThread >= Number(rotation.maxRunsPerThread) ? 'rotation_due' : 'active',
    };
    writeMemoryAtomic(memoryPath, replaceStateBlock(content, ROTATION_BLOCK, next));
    return next;
  });
}

function recordUbersuggestRun({
  memoryPath,
  status,
  runDate,
  contentCallsUsed = 0,
  weeklyCallsUsed = 0,
  evidencePath = null,
  authCheckedAt = null,
  weeklyDiscoveryAt = null,
}) {
  return withMemoryLock(memoryPath, () => {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const current = parseStateBlock(content, UBERSUGGEST_BLOCK);
    if (!current) throw new Error('Ubersuggest-staatblok ontbreekt; voer eerst ensure uit.');
    const next = {
      ...current,
      lastStatus: String(status || 'not_checked'),
      lastRunDate: runDate || null,
      contentCallsUsed: Number(contentCallsUsed),
      weeklyCallsUsed: Number(weeklyCallsUsed),
      lastEvidencePath: evidencePath || null,
      lastAuthCheckAt: authCheckedAt || current.lastAuthCheckAt,
      lastWeeklyDiscoveryAt: weeklyDiscoveryAt || current.lastWeeklyDiscoveryAt,
    };
    const errors = validateUbersuggestState(next);
    if (errors.length) throw new Error(`Ongeldige Ubersuggest-staat: ${errors.join(' ')}`);
    writeMemoryAtomic(memoryPath, replaceStateBlock(content, UBERSUGGEST_BLOCK, next));
    return next;
  });
}

module.exports = {
  DEFAULT_MAX_RUNS_PER_THREAD,
  ROTATION_BLOCK,
  UBERSUGGEST_BLOCK,
  UBERSUGGEST_STATUSES,
  defaultUbersuggestState,
  ensureAutomationState,
  formatStateBlock,
  inspectAutomationState,
  isWeeklyDiscoveryDue,
  parseStateBlock,
  recordUbersuggestRun,
  replaceStateBlock,
  startAutomationRun,
  validateRotationState,
  validateUbersuggestState,
};
