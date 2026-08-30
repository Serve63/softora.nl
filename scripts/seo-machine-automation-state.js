#!/usr/bin/env node
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROTATION_BLOCK = 'SEO_THREAD_ROTATION_STATE';
const UBERSUGGEST_BLOCK = 'SEO_UBERSUGGEST_STATE';
const RUN_LIFECYCLE_BLOCK = 'SEO_RUN_LIFECYCLE_STATE';
const DEFAULT_MAX_RUNS_PER_THREAD = 15;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const AUTOMATION_ID = 'softora-seo-actiemachine';
const AUTOMATION_NAME = 'Softora SEO dagmachine';
const AUTOMATION_RRULE = 'FREQ=DAILY;BYHOUR=8;BYMINUTE=15;BYSECOND=0';
const AUTOMATION_PROMPT_VERSION = 6;
const RUN_GATE_VERSION = 2;
const UBERSUGGEST_STATUSES = Object.freeze([
  'not_checked', 'not_required', 'ready', 'external_research_unavailable', 'auth_blocked', 'quota_blocked',
]);
const REQUIRED_UBERSUGGEST_TOOLS = Object.freeze([
  'mcp__ubersuggest__keyword_suggestions',
  'mcp__ubersuggest__google_suggestions',
  'mcp__ubersuggest__keyword_overview',
  'mcp__ubersuggest__serp_analysis',
]);
const RUN_GATES = Object.freeze([
  'cadence',
  'reviews',
  'selection',
  'keywords',
  'visuals',
  'verify_critical',
  'live_production',
  'live_route',
]);
const REQUIRED_PUBLISHED_RUN_GATES = Object.freeze([...RUN_GATES]);
const REQUIRED_PUBLISHED_RUN_GATES_BY_VERSION = Object.freeze({
  1: Object.freeze(RUN_GATES.filter((gate) => gate !== 'reviews')),
  2: REQUIRED_PUBLISHED_RUN_GATES,
});
const TREE_BOUND_RUN_GATES = Object.freeze([
  'keywords',
  'visuals',
  'verify_critical',
  'live_production',
  'live_route',
]);
const RUN_OUTCOMES = Object.freeze([
  'published', 'completed_no_publication', 'operations_p0', 'blocked', 'failed', 'interrupted',
]);
const PUBLIC_EFFECTS = Object.freeze(['live', 'scheduled', 'pr_only', 'none', 'unverified']);
const DEFAULT_MEMORY_PATH = path.join(
  os.homedir(), '.codex', 'automations', AUTOMATION_ID, 'memory.md'
);
const DEFAULT_AUTOMATIONS_ROOT = path.join(os.homedir(), '.codex', 'automations');
const DEFAULT_AUTOMATION_PATH = path.join(DEFAULT_AUTOMATIONS_ROOT, AUTOMATION_ID, 'automation.toml');
const REQUIRED_PROMPT_MARKERS = Object.freeze([
  Object.freeze({ label: 'prompt_version', pattern: /SEO_MACHINE_PROMPT_VERSION=6/ }),
  Object.freeze({ label: 'single_automation_identity', pattern: /sole automation id is softora-seo-actiemachine/i }),
  Object.freeze({ label: 'atomic_run_counter', pattern: /seo:automation-state -- start-run/i }),
  Object.freeze({ label: 'finish_run_receipt', pattern: /seo:automation-state -- finish-run/i }),
  Object.freeze({ label: 'explicit_run_recovery', pattern: /seo:automation-state -- recover-run/i }),
  Object.freeze({ label: 'run_gate_receipts', pattern: /--record-run-gate/i }),
  Object.freeze({ label: 'selection_gate', pattern: /seo:selection:check/i }),
  Object.freeze({ label: 'reviews_gate', pattern: /seo:reviews:check/i }),
  Object.freeze({
    label: 'review_evidence_metrics_schema',
    pattern: /metrics object with nonBrandedClicks, nonBrandedImpressions, averagePosition and baselineComparison/i,
  }),
  Object.freeze({ label: 'fresh_gsc_evidence_window', pattern: /30-minute fresh GSC window/i }),
  Object.freeze({
    label: 'canonical_ready_selection_binding',
    pattern: /new_url must not exist there yet and must exactly match a ready path/i,
  }),
  Object.freeze({ label: 'live_route_gate', pattern: /seo:live-route:check/i }),
  Object.freeze({ label: 'ubersuggest_keyword_suggestions', pattern: /mcp__ubersuggest__keyword_suggestions/i }),
  Object.freeze({ label: 'ubersuggest_google_suggestions', pattern: /mcp__ubersuggest__google_suggestions/i }),
  Object.freeze({ label: 'ubersuggest_keyword_overview', pattern: /mcp__ubersuggest__keyword_overview/i }),
  Object.freeze({ label: 'ubersuggest_serp_analysis', pattern: /mcp__ubersuggest__serp_analysis/i }),
  Object.freeze({ label: 'ubersuggest_data_smoke', pattern: /seo:automation-state -- record-tool-smoke/i }),
  Object.freeze({ label: 'iab_browser_binding', pattern: /agent\.browsers\.get\(["']iab["']\)/i }),
  Object.freeze({ label: 'iab_browser_identity', pattern: /built-in ChatGPT\/Codex browser binding/i }),
  Object.freeze({ label: 'private_browser_prohibition', pattern: /Google Chrome and Microsoft Edge are forbidden/i }),
  Object.freeze({ label: 'browser_fallback_prohibition', pattern: /no generic browser fallback/i }),
  Object.freeze({ label: 'evergreen_continuation', pattern: /remains ACTIVE until Serve explicitly pauses/i }),
  Object.freeze({ label: 'post_deadline_rule', pattern: /After 31 December 2026/i }),
  Object.freeze({ label: 'cost_stop', pattern: /Never buy credits/i }),
  Object.freeze({ label: 'qwen_stop', pattern: /Never use Qwen/i }),
]);
const FORBIDDEN_PROMPT_MARKERS = Object.freeze([
  Object.freeze({ label: 'edge_browser_binding', pattern: /agent\.browsers\.get\(["']edge["']\)/i }),
  Object.freeze({ label: 'chrome_browser_binding', pattern: /agent\.browsers\.get\(["']chrome["']\)/i }),
  Object.freeze({ label: 'extension_browser_binding', pattern: /agent\.browsers\.get\(["']extension["']\)/i }),
  Object.freeze({ label: 'generic_browser_binding', pattern: /agent\.browsers\.(?:getDefault|getForUrl)\s*\(/i }),
  Object.freeze({ label: 'edge_extension_identity', pattern: /family=edge/i }),
]);

function parseTomlString(content, key) {
  const safe = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(content || '').match(new RegExp(`^\\s*${safe}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")\\s*$`, 'm'));
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch (error) {
    throw new Error(`automation.toml veld ${key} is ongeldig: ${error.message}`);
  }
}

function parseAutomationToml(content) {
  const versionMatch = String(content || '').match(/^\s*version\s*=\s*(\d+)\s*$/m);
  return {
    version: versionMatch ? Number(versionMatch[1]) : null,
    id: parseTomlString(content, 'id'),
    kind: parseTomlString(content, 'kind'),
    name: parseTomlString(content, 'name'),
    prompt: parseTomlString(content, 'prompt'),
    status: parseTomlString(content, 'status'),
    rrule: parseTomlString(content, 'rrule'),
    targetThreadId: parseTomlString(content, 'target_thread_id'),
  };
}

function findSeoAutomationPaths(automationsRoot) {
  if (!fs.existsSync(automationsRoot)) return [];
  const matches = [];
  for (const entry of fs.readdirSync(automationsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidatePath = path.join(automationsRoot, entry.name, 'automation.toml');
    if (!fs.existsSync(candidatePath)) continue;
    const content = fs.readFileSync(candidatePath, 'utf8');
    let config;
    try { config = parseAutomationToml(content); } catch {
      if (content.includes(AUTOMATION_ID) || content.includes(AUTOMATION_NAME)) matches.push(candidatePath);
      continue;
    }
    if (
      config.id === AUTOMATION_ID
      || config.name === AUTOMATION_NAME
      || String(config.prompt || '').includes(`sole automation id is ${AUTOMATION_ID}`)
    ) matches.push(candidatePath);
  }
  return matches.sort();
}
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
  if (state.bindingRepairHistory !== undefined) {
    if (!Array.isArray(state.bindingRepairHistory)) {
      errors.push('bindingRepairHistory is ongeldig.');
    } else {
      state.bindingRepairHistory.forEach((repair, index) => {
        if (!repair || typeof repair !== 'object') errors.push(`bindingRepairHistory ${index + 1} is ongeldig.`);
        else if (
          !String(repair.fromThreadId || '').trim()
          || !String(repair.toThreadId || '').trim()
          || repair.fromThreadId === repair.toThreadId
          || !Number.isFinite(new Date(repair.repairedAt).getTime())
          || String(repair.reason || '').trim().length < 8
          || String(repair.evidence || '').trim().length < 8
        ) errors.push(`bindingRepairHistory ${index + 1} mist geldig bewijs.`);
      });
    }
  }
  return errors;
}
function defaultUbersuggestState() {
  return {
    schemaVersion: 1, provider: 'ubersuggest', role: 'advisory_only', lastAuthCheckAt: null,
    lastWeeklyDiscoveryAt: null, lastStatus: 'not_checked', lastRunDate: null,
    contentCallsUsed: 0, weeklyCallsUsed: 0, lastEvidencePath: null,
    boundThreadId: null, toolBindingCheckedAt: null, boundTools: [], toolBindingEvidence: null,
    dataSmokeStatus: 'not_checked', dataSmokeThreadId: null, dataSmokeCheckedAt: null,
    dataSmokeTools: [], dataSmokeOutcomes: {}, dataSmokeEvidence: null,
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
  if (state.boundThreadId !== null && !String(state.boundThreadId || '').trim()) errors.push('boundThreadId is ongeldig.');
  if (state.toolBindingCheckedAt !== null && !Number.isFinite(new Date(state.toolBindingCheckedAt).getTime())) {
    errors.push('toolBindingCheckedAt is ongeldig.');
  }
  if (!Array.isArray(state.boundTools) || state.boundTools.some((tool) => !String(tool || '').trim())) {
    errors.push('boundTools is ongeldig.');
  } else if (new Set(state.boundTools).size !== state.boundTools.length) {
    errors.push('boundTools bevat dubbelen.');
  }
  if (state.toolBindingEvidence !== null && String(state.toolBindingEvidence || '').trim().length < 8) {
    errors.push('toolBindingEvidence is te vaag.');
  }
  if (!['not_checked', 'ready'].includes(String(state.dataSmokeStatus || ''))) {
    errors.push('dataSmokeStatus is ongeldig.');
  }
  if (state.dataSmokeThreadId !== null && !String(state.dataSmokeThreadId || '').trim()) {
    errors.push('dataSmokeThreadId is ongeldig.');
  }
  if (state.dataSmokeCheckedAt !== null && !validIso(state.dataSmokeCheckedAt)) {
    errors.push('dataSmokeCheckedAt is ongeldig.');
  }
  if (!Array.isArray(state.dataSmokeTools) || state.dataSmokeTools.some((tool) => !String(tool || '').trim())) {
    errors.push('dataSmokeTools is ongeldig.');
  } else if (new Set(state.dataSmokeTools).size !== state.dataSmokeTools.length) {
    errors.push('dataSmokeTools bevat dubbelen.');
  }
  if (!state.dataSmokeOutcomes || typeof state.dataSmokeOutcomes !== 'object' || Array.isArray(state.dataSmokeOutcomes)) {
    errors.push('dataSmokeOutcomes is ongeldig.');
  }
  if (state.dataSmokeEvidence !== null && String(state.dataSmokeEvidence || '').trim().length < 8) {
    errors.push('dataSmokeEvidence is te vaag.');
  }
  if (state.dataSmokeStatus === 'ready') {
    const missingSmokeTools = REQUIRED_UBERSUGGEST_TOOLS.filter((tool) => !state.dataSmokeTools.includes(tool));
    const missingOutcomes = REQUIRED_UBERSUGGEST_TOOLS.filter((tool) => {
      const outcome = state.dataSmokeOutcomes?.[tool];
      return !outcome
        || !['ok', 'ok_empty'].includes(String(outcome.status || ''))
        || !Number.isInteger(Number(outcome.resultCount))
        || Number(outcome.resultCount) < 0;
    });
    if (!state.dataSmokeThreadId || !state.dataSmokeCheckedAt || missingSmokeTools.length || missingOutcomes.length) {
      errors.push(`Een ready Ubersuggest data-smoke vereist task, datum en vier geldige tooluitkomsten; ontbrekend: ${missingOutcomes.join(', ') || 'geen'}.`);
    }
  }
  return errors;
}

function defaultRunLifecycleState() {
  return { schemaVersion: 1, activeRun: null, lastReceipt: null, receipts: [] };
}

function validIso(value) {
  return Boolean(String(value || '').trim()) && Number.isFinite(new Date(value).getTime());
}

function validSoftoraUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'https:' && ['softora.nl', 'www.softora.nl'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function normalizeSoftoraPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, 'https://www.softora.nl');
    if (!['softora.nl', 'www.softora.nl'].includes(parsed.hostname) || parsed.search || parsed.hash) return '';
    return parsed.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return '';
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digestRunGateDetails(details) {
  return crypto.createHash('sha256').update(stableJson(details || {})).digest('hex');
}

function validateRunGateReceipt(receipt, activeRun, label = 'gate') {
  const errors = [];
  if (!receipt || typeof receipt !== 'object') return [`${label} ontbreekt.`];
  if (!RUN_GATES.includes(String(receipt.gate || ''))) errors.push(`${label}.gate is ongeldig.`);
  if (receipt.status !== 'ready') errors.push(`${label}.status moet ready zijn.`);
  if (!validIso(receipt.checkedAt)) errors.push(`${label}.checkedAt is ongeldig.`);
  if (activeRun && validIso(receipt.checkedAt) && new Date(receipt.checkedAt) < new Date(activeRun.startedAt)) {
    errors.push(`${label} is ouder dan de actieve run.`);
  }
  if (activeRun && (receipt.threadId !== activeRun.threadId || receipt.invocationAt !== activeRun.invocationAt)) {
    errors.push(`${label} hoort niet bij de actieve invocation.`);
  }
  if (!/^[a-f0-9]{64}$/.test(String(receipt.resultDigest || ''))) errors.push(`${label}.resultDigest is ongeldig.`);
  if (!receipt.summary || typeof receipt.summary !== 'object' || Array.isArray(receipt.summary)) {
    errors.push(`${label}.summary is ongeldig.`);
  } else if (digestRunGateDetails(receipt.summary) !== receipt.resultDigest) {
    errors.push(`${label}.resultDigest wijkt af van de opgeslagen uitkomst.`);
  }
  if (TREE_BOUND_RUN_GATES.includes(receipt.gate) && !/^[a-f0-9]{40}$/i.test(String(receipt.treeSha || ''))) {
    errors.push(`${label}.treeSha ontbreekt of is ongeldig.`);
  }
  if (receipt.gate === 'live_production' && !/^[a-f0-9]{7,40}$/i.test(String(receipt.liveCommit || ''))) {
    errors.push(`${label}.liveCommit ontbreekt.`);
  }
  if (receipt.gate === 'live_route') {
    if (!/^[a-f0-9]{7,40}$/i.test(String(receipt.liveCommit || ''))) errors.push(`${label}.liveCommit ontbreekt.`);
    if (!validSoftoraUrl(receipt.changedUrl)) errors.push(`${label}.changedUrl ontbreekt of is ongeldig.`);
  }
  return errors;
}

function validatePublishedRunGates(run, { liveCommit, changedUrl } = {}) {
  const errors = [];
  const gates = run?.gates && typeof run.gates === 'object' ? run.gates : {};
  const gateVersion = Number(run?.gateVersion || 1);
  const requiredGates = REQUIRED_PUBLISHED_RUN_GATES_BY_VERSION[gateVersion]
    || REQUIRED_PUBLISHED_RUN_GATES;
  for (const gateName of requiredGates) {
    const receipt = gates[gateName];
    errors.push(...validateRunGateReceipt(receipt, run, `gates.${gateName}`));
  }
  const liveGate = gates.live_production;
  const routeGate = gates.live_route;
  if (liveGate?.liveCommit && String(liveGate.liveCommit) !== String(liveCommit || '')) {
    errors.push('gates.live_production wijkt af van --live-commit.');
  }
  if (routeGate?.liveCommit && String(routeGate.liveCommit) !== String(liveCommit || '')) {
    errors.push('gates.live_route wijkt af van --live-commit.');
  }
  if (routeGate?.changedUrl && String(routeGate.changedUrl) !== String(changedUrl || '')) {
    errors.push('gates.live_route wijkt af van --changed-url.');
  }
  if (gateVersion >= 2) {
    const selectionSummary = gates.selection?.summary || {};
    const routeSummary = gates.live_route?.summary?.summary || gates.live_route?.summary || {};
    const selectedPath = normalizeSoftoraPath(selectionSummary.selectedPath);
    const liveRoutePath = normalizeSoftoraPath(routeGate?.changedUrl || routeSummary.url || changedUrl);
    if (!selectedPath) {
      errors.push('gates.selection.selectedPath ontbreekt of is ongeldig.');
    } else if (!liveRoutePath || selectedPath !== liveRoutePath) {
      errors.push(`gates.selection.selectedPath ${selectedPath} wijkt af van de live route ${liveRoutePath || '(ongeldig)'}.`);
    }
    const selectedActionType = String(selectionSummary.selectedActionType || '').trim();
    if (!['new_url', 'substantial_refresh', 'other_growth_action'].includes(selectedActionType)) {
      errors.push('gates.selection.selectedActionType ontbreekt of is ongeldig.');
    }
    const selectedSupportingAction = selectionSummary.supportingAction || null;
    const liveSupportingAction = routeSummary.supportingAction || null;
    if (!selectedSupportingAction) {
      errors.push('gates.selection.supportingAction ontbreekt voor de geselecteerde groei-actie.');
    }
    if (selectedSupportingAction) {
      const selectedProof = {
        type: String(selectedSupportingAction.type || '').trim(),
        path: normalizeSoftoraPath(selectedSupportingAction.path),
        verification: {
          kind: String(selectedSupportingAction.verification?.kind || '').trim(),
          value: String(selectedSupportingAction.verification?.value || '').trim() || null,
        },
      };
      const liveProof = liveSupportingAction ? {
        type: String(liveSupportingAction.type || '').trim(),
        path: normalizeSoftoraPath(liveSupportingAction.path),
        verification: {
          kind: String(liveSupportingAction.verification?.kind || '').trim(),
          value: String(liveSupportingAction.verification?.value || '').trim() || null,
        },
      } : null;
      if (!liveSupportingAction || liveSupportingAction.verified !== true) {
        errors.push('gates.live_route mist groen supportingAction-bewijs.');
      } else if (stableJson(selectedProof) !== stableJson(liveProof)) {
        errors.push('gates.live_route supportingAction wijkt af van de selectie.');
      }
    }
  }
  const finalTreeSha = liveGate?.treeSha;
  if (finalTreeSha) {
    for (const gateName of TREE_BOUND_RUN_GATES) {
      if (gates[gateName]?.treeSha && gates[gateName].treeSha !== finalTreeSha) {
        errors.push(`gates.${gateName} is niet uitgevoerd op de live productietree.`);
      }
    }
  }
  return errors;
}

function validateRunIdentity(run, label = 'activeRun') {
  const errors = [];
  if (!run || typeof run !== 'object') return [`${label} is ongeldig.`];
  if (!String(run.threadId || '').trim()) errors.push(`${label}.threadId ontbreekt.`);
  if (!validIso(run.invocationAt)) errors.push(`${label}.invocationAt is ongeldig.`);
  if (!validIso(run.startedAt)) errors.push(`${label}.startedAt is ongeldig.`);
  if (!Number.isInteger(Number(run.runNumber)) || Number(run.runNumber) < 1 || Number(run.runNumber) > 15) {
    errors.push(`${label}.runNumber is ongeldig.`);
  }
  if (run.gateVersion !== undefined && ![1, 2].includes(Number(run.gateVersion))) {
    errors.push(`${label}.gateVersion is ongeldig.`);
  }
  if (run.gates !== undefined && (!run.gates || typeof run.gates !== 'object' || Array.isArray(run.gates))) {
    errors.push(`${label}.gates is ongeldig.`);
  } else if (run.gates) {
    for (const [gateName, gateReceipt] of Object.entries(run.gates)) {
      if (gateName !== gateReceipt?.gate) errors.push(`${label}.gates.${gateName} heeft een afwijkende naam.`);
      errors.push(...validateRunGateReceipt(gateReceipt, run, `${label}.gates.${gateName}`));
    }
  }
  return errors;
}

function validateRunReceipt(receipt, label = 'receipt') {
  const errors = validateRunIdentity(receipt, label);
  if (!validIso(receipt?.finishedAt)) errors.push(`${label}.finishedAt is ongeldig.`);
  if (validIso(receipt?.startedAt) && validIso(receipt?.finishedAt)
    && new Date(receipt.finishedAt) < new Date(receipt.startedAt)) errors.push(`${label}.finishedAt ligt voor startedAt.`);
  if (!RUN_OUTCOMES.includes(String(receipt?.outcome || ''))) errors.push(`${label}.outcome is ongeldig.`);
  if (!PUBLIC_EFFECTS.includes(String(receipt?.publicEffect || ''))) errors.push(`${label}.publicEffect is ongeldig.`);
  if (String(receipt?.evidence || '').trim().length < 8 || String(receipt?.evidence || '').length > 500) {
    errors.push(`${label}.evidence moet 8-500 tekens bevatten.`);
  }
  if (receipt?.prNumber !== null && receipt?.prNumber !== undefined
    && (!Number.isInteger(Number(receipt.prNumber)) || Number(receipt.prNumber) < 1)) errors.push(`${label}.prNumber is ongeldig.`);
  if (receipt?.liveCommit !== null && receipt?.liveCommit !== undefined
    && !/^[a-f0-9]{7,40}$/i.test(String(receipt.liveCommit))) errors.push(`${label}.liveCommit is ongeldig.`);
  if (receipt?.changedUrl !== null && receipt?.changedUrl !== undefined && !validSoftoraUrl(receipt.changedUrl)) {
    errors.push(`${label}.changedUrl moet een geldige Softora-URL zijn.`);
  }
  if (receipt?.outcome === 'published' && receipt?.publicEffect !== 'live') {
    errors.push(`${label} mag published alleen met publicEffect=live zijn.`);
  }
  if (receipt?.publicEffect === 'live' && (!receipt.liveCommit || !receipt.changedUrl)) {
    errors.push(`${label} met live effect vereist liveCommit en changedUrl.`);
  }
  if (receipt?.outcome === 'published' && (!Number.isInteger(Number(receipt.prNumber)) || Number(receipt.prNumber) < 1)) {
    errors.push(`${label} met published vereist een PR-nummer.`);
  }
  if (receipt?.outcome === 'published' && [1, 2].includes(Number(receipt?.gateVersion))) {
    errors.push(...validatePublishedRunGates(receipt, receipt).map((error) => `${label}.${error}`));
  }
  if (receipt?.outcome === 'interrupted' && receipt?.publicEffect !== 'unverified') {
    errors.push(`${label} met interrupted vereist publicEffect=unverified.`);
  }
  return errors;
}

function validateRunLifecycleState(state) {
  const errors = [];
  if (!state || typeof state !== 'object') return ['Run-lifecyclestaat ontbreekt.'];
  if (Number(state.schemaVersion) !== 1) errors.push('Run-lifecycle schemaVersion moet 1 zijn.');
  if (state.activeRun !== null) errors.push(...validateRunIdentity(state.activeRun));
  if (state.lastReceipt !== null) errors.push(...validateRunReceipt(state.lastReceipt, 'lastReceipt'));
  if (!Array.isArray(state.receipts) || state.receipts.length > 30) {
    errors.push('Run-lifecycle receipts is ongeldig.');
  } else {
    state.receipts.forEach((receipt, index) => errors.push(...validateRunReceipt(receipt, `receipts[${index}]`)));
    const keys = state.receipts.map((receipt) => `${receipt.threadId}|${receipt.invocationAt}`);
    if (new Set(keys).size !== keys.length) errors.push('Run-lifecycle receipts bevat dubbele invocations.');
  }
  if (state.lastReceipt !== null && Array.isArray(state.receipts)) {
    const last = state.receipts.at(-1);
    if (!last || last.threadId !== state.lastReceipt.threadId || last.invocationAt !== state.lastReceipt.invocationAt) {
      errors.push('lastReceipt wijkt af van de laatste receipt.');
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
  const storedUbersuggest = parseStateBlock(content, UBERSUGGEST_BLOCK);
  const ubersuggest = { ...defaultUbersuggestState(), ...(storedUbersuggest || {}) };
  const storedLifecycle = parseStateBlock(content, RUN_LIFECYCLE_BLOCK);
  const lifecycle = storedLifecycle || defaultRunLifecycleState();
  return {
    rotation, rotationErrors: validateRotationState(rotation), ubersuggest,
    ubersuggestErrors: storedUbersuggest ? validateUbersuggestState(ubersuggest) : ['Ubersuggest-staatblok ontbreekt.'],
    ubersuggestStatePresent: Boolean(storedUbersuggest), weeklyDiscoveryDue: isWeeklyDiscoveryDue(ubersuggest, now),
    lifecycle, lifecycleErrors: storedLifecycle ? validateRunLifecycleState(lifecycle) : ['Run-lifecyclestaatblok ontbreekt.'],
    lifecycleStatePresent: Boolean(storedLifecycle),
  };
}

function auditAutomationInstallation({
  memoryPath = DEFAULT_MEMORY_PATH,
  automationPath = DEFAULT_AUTOMATION_PATH,
  automationsRoot = DEFAULT_AUTOMATIONS_ROOT,
  now = new Date(),
} = {}) {
  const errors = [];
  let state = null;
  let config = null;
  try {
    state = inspectAutomationState(memoryPath, now);
    errors.push(...state.rotationErrors, ...state.ubersuggestErrors, ...state.lifecycleErrors);
  } catch (error) {
    errors.push(`Automation memory kan niet worden gelezen: ${error.message}`);
  }

  try {
    config = parseAutomationToml(fs.readFileSync(automationPath, 'utf8'));
  } catch (error) {
    errors.push(`Automationconfig kan niet worden gelezen: ${error.message}`);
  }

  const matchingAutomationPaths = findSeoAutomationPaths(automationsRoot);
  if (matchingAutomationPaths.length !== 1) {
    errors.push(`Er moeten exact 1 Softora SEO-automation zijn; gevonden: ${matchingAutomationPaths.length}.`);
  } else if (path.resolve(matchingAutomationPaths[0]) !== path.resolve(automationPath)) {
    errors.push('De enige gevonden Softora SEO-automation staat niet op het canonieke pad.');
  }

  const missingPromptMarkers = [];
  const forbiddenPromptMarkers = [];
  if (config) {
    if (config.version !== 1) errors.push('Automation version moet 1 zijn.');
    if (config.id !== AUTOMATION_ID) errors.push(`Automation id moet ${AUTOMATION_ID} zijn.`);
    if (config.kind !== 'heartbeat') errors.push('Automation kind moet heartbeat zijn.');
    if (config.name !== AUTOMATION_NAME) errors.push(`Automation name moet ${AUTOMATION_NAME} zijn.`);
    if (config.status !== 'ACTIVE') errors.push('Automation status moet ACTIVE zijn.');
    if (config.rrule !== AUTOMATION_RRULE) errors.push('Automation schedule moet dagelijks om 08:15 blijven.');
    if (!String(config.targetThreadId || '').trim()) errors.push('Automation target_thread_id ontbreekt.');
    if (
      state?.rotation?.activeThreadId
      && config.targetThreadId !== state.rotation.activeThreadId
    ) errors.push('Automation target_thread_id wijkt af van de actieve rotatietask.');
    if (state?.rotation?.activeThreadId && state?.ubersuggest?.boundThreadId !== state.rotation.activeThreadId) {
      errors.push('Ubersuggest-toolbinding is niet bewezen voor de actieve automation-task.');
    }
    const missingUbersuggestTools = REQUIRED_UBERSUGGEST_TOOLS.filter(
      (toolName) => !state?.ubersuggest?.boundTools?.includes(toolName)
    );
    if (missingUbersuggestTools.length) {
      errors.push(`Ubersuggest-toolbinding mist: ${missingUbersuggestTools.join(', ')}.`);
    }
    const missingSmokeTools = REQUIRED_UBERSUGGEST_TOOLS.filter(
      (toolName) => !state?.ubersuggest?.dataSmokeTools?.includes(toolName)
    );
    if (
      state?.rotation?.activeThreadId
      && (
        state?.ubersuggest?.dataSmokeStatus !== 'ready'
        || state?.ubersuggest?.dataSmokeThreadId !== state.rotation.activeThreadId
        || missingSmokeTools.length
      )
    ) {
      errors.push(`Ubersuggest data-smoke is niet bewezen voor de actieve task; ontbrekend: ${missingSmokeTools.join(', ') || 'status/task-bewijs'}.`);
    }
    for (const marker of REQUIRED_PROMPT_MARKERS) {
      if (!marker.pattern.test(String(config.prompt || ''))) missingPromptMarkers.push(marker.label);
    }
    for (const marker of FORBIDDEN_PROMPT_MARKERS) {
      if (marker.pattern.test(String(config.prompt || ''))) forbiddenPromptMarkers.push(marker.label);
    }
    if (missingPromptMarkers.length) {
      errors.push(`Automationprompt mist verplichte controles: ${missingPromptMarkers.join(', ')}.`);
    }
    if (forbiddenPromptMarkers.length) {
      errors.push(`Automationprompt bevat een verboden browserroute: ${forbiddenPromptMarkers.join(', ')}.`);
    }
  }

  return {
    status: errors.length ? 'invalid' : 'ready',
    errors,
    automation: config ? {
      version: config.version,
      id: config.id,
      kind: config.kind,
      name: config.name,
      status: config.status,
      rrule: config.rrule,
      targetThreadId: config.targetThreadId,
      missingPromptMarkers,
      forbiddenPromptMarkers,
    } : null,
    matchingAutomationCount: matchingAutomationPaths.length,
    matchingAutomationPaths,
    rotation: state?.rotation || null,
    ubersuggest: state?.ubersuggest || null,
    lifecycle: state?.lifecycle || null,
    weeklyDiscoveryDue: state?.weeklyDiscoveryDue ?? null,
  };
}
function ensureAutomationState(memoryPath, now = new Date()) {
  return withMemoryLock(memoryPath, () => {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const rotation = parseStateBlock(content, ROTATION_BLOCK);
    const rotationErrors = validateRotationState(rotation);
    if (rotationErrors.length) throw new Error(`Ongeldige rotatiestaat: ${rotationErrors.join(' ')}`);
    const existing = parseStateBlock(content, UBERSUGGEST_BLOCK);
    const ubersuggest = { ...defaultUbersuggestState(), ...(existing || {}) };
    const errors = validateUbersuggestState(ubersuggest);
    if (errors.length) throw new Error(`Ongeldige Ubersuggest-staat: ${errors.join(' ')}`);
    const existingLifecycle = parseStateBlock(content, RUN_LIFECYCLE_BLOCK);
    const lifecycle = existingLifecycle || defaultRunLifecycleState();
    const lifecycleErrors = validateRunLifecycleState(lifecycle);
    if (lifecycleErrors.length) throw new Error(`Ongeldige run-lifecyclestaat: ${lifecycleErrors.join(' ')}`);
    const ubersuggestNeedsWrite = !existing || JSON.stringify(existing) !== JSON.stringify(ubersuggest);
    let nextContent = content;
    if (ubersuggestNeedsWrite) nextContent = replaceStateBlock(nextContent, UBERSUGGEST_BLOCK, ubersuggest);
    if (!existingLifecycle) nextContent = replaceStateBlock(nextContent, RUN_LIFECYCLE_BLOCK, lifecycle);
    if (nextContent !== content) writeMemoryAtomic(memoryPath, nextContent);
    return {
      rotation, ubersuggest, lifecycle, weeklyDiscoveryDue: isWeeklyDiscoveryDue(ubersuggest, now),
      createdUbersuggestState: !existing, migratedUbersuggestState: Boolean(existing && ubersuggestNeedsWrite),
      createdLifecycleState: !existingLifecycle,
    };
  });
}
function startAutomationRun({ memoryPath, threadId, invocationAt }) {
  return withMemoryLock(memoryPath, () => {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const current = parseStateBlock(content, ROTATION_BLOCK);
    const errors = validateRotationState(current);
    if (errors.length) throw new Error(`Ongeldige rotatiestaat: ${errors.join(' ')}`);
    const lifecycle = parseStateBlock(content, RUN_LIFECYCLE_BLOCK);
    const lifecycleErrors = validateRunLifecycleState(lifecycle);
    if (lifecycleErrors.length) throw new Error(`Ongeldige run-lifecyclestaat: ${lifecycleErrors.join(' ')}`);
    if (String(current.activeThreadId) !== String(threadId || '')) throw new Error('Verkeerde automation-task.');
    if (!String(invocationAt || '').trim() || !Number.isFinite(new Date(invocationAt).getTime())) throw new Error('invocationAt is ongeldig.');
    if (current.lastInvocationAt === invocationAt) {
      const matchingReceipt = lifecycle.receipts.find(
        (receipt) => receipt.threadId === threadId && receipt.invocationAt === invocationAt
      );
      const matchingActiveRun = lifecycle.activeRun?.threadId === threadId
        && lifecycle.activeRun?.invocationAt === invocationAt;
      if (!matchingReceipt && !matchingActiveRun) {
        throw new Error('RUN_STATE_MISMATCH: rotatie verwijst naar een invocation zonder actieve run of receipt.');
      }
      return {
        ...current,
        lifecycle: matchingReceipt ? 'finished' : 'running',
        receipt: matchingReceipt || null,
        idempotent: true,
      };
    }
    if (lifecycle.activeRun) {
      throw new Error(
        `ACTIVE_RUN_REQUIRES_RECOVERY: invocation ${lifecycle.activeRun.invocationAt} staat nog open; inspecteer externe effecten en gebruik recover-run.`
      );
    }
    if (Number(current.completedRunsInActiveThread) >= 15) throw new Error('ROTATION_REQUIRED: deze task heeft al 15 heartbeat-runs verwerkt.');
    const completedRunsInActiveThread = Number(current.completedRunsInActiveThread) + 1;
    const next = { ...current, completedRunsInActiveThread, lastInvocationAt: invocationAt, rotationStatus: completedRunsInActiveThread === 15 ? 'rotation_due' : 'active' };
    const activeRun = {
      threadId: String(threadId), invocationAt, runNumber: completedRunsInActiveThread, startedAt: invocationAt,
      gateVersion: RUN_GATE_VERSION, gates: {},
    };
    const nextLifecycle = {
      ...lifecycle,
      activeRun,
      lastReceipt: lifecycle.lastReceipt,
      receipts: lifecycle.receipts.slice(-30),
    };
    const nextLifecycleErrors = validateRunLifecycleState(nextLifecycle);
    if (nextLifecycleErrors.length) throw new Error(`Nieuwe run-lifecyclestaat is ongeldig: ${nextLifecycleErrors.join(' ')}`);
    let nextContent = replaceStateBlock(content, ROTATION_BLOCK, next);
    nextContent = replaceStateBlock(nextContent, RUN_LIFECYCLE_BLOCK, nextLifecycle);
    writeMemoryAtomic(memoryPath, nextContent);
    return { ...next, lifecycle: 'running', activeRun };
  });
}

function recoverInterruptedRun({ memoryPath, threadId, recoveredAt, evidence }) {
  return withMemoryLock(memoryPath, () => {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const lifecycle = parseStateBlock(content, RUN_LIFECYCLE_BLOCK);
    const lifecycleErrors = validateRunLifecycleState(lifecycle);
    if (lifecycleErrors.length) throw new Error(`Ongeldige run-lifecyclestaat: ${lifecycleErrors.join(' ')}`);
    const normalizedThreadId = String(threadId || '');
    const normalizedEvidence = String(evidence || '').trim();
    if (!lifecycle.activeRun) {
      if (
        lifecycle.lastReceipt?.outcome === 'interrupted'
        && lifecycle.lastReceipt.threadId === normalizedThreadId
        && lifecycle.lastReceipt.finishedAt === recoveredAt
        && lifecycle.lastReceipt.evidence === normalizedEvidence
      ) return { ...lifecycle.lastReceipt, idempotent: true };
      throw new Error('NO_INTERRUPTED_RUN: er is geen open run om te herstellen.');
    }
    if (lifecycle.activeRun.threadId !== normalizedThreadId) throw new Error('RUN_IDENTITY_MISMATCH: verkeerde recovery-task.');
    if (!validIso(recoveredAt) || new Date(recoveredAt) < new Date(lifecycle.activeRun.startedAt)) {
      throw new Error('recoveredAt is ongeldig.');
    }
    const receipt = {
      ...lifecycle.activeRun,
      finishedAt: recoveredAt,
      outcome: 'interrupted',
      publicEffect: 'unverified',
      evidence: normalizedEvidence,
      prNumber: null,
      liveCommit: null,
      changedUrl: null,
      autoClosed: true,
    };
    const receiptErrors = validateRunReceipt(receipt, 'recoveredRun');
    if (receiptErrors.length) throw new Error(`Runherstel is ongeldig: ${receiptErrors.join(' ')}`);
    const nextLifecycle = {
      ...lifecycle,
      activeRun: null,
      lastReceipt: receipt,
      receipts: [...lifecycle.receipts, receipt].slice(-30),
    };
    writeMemoryAtomic(memoryPath, replaceStateBlock(content, RUN_LIFECYCLE_BLOCK, nextLifecycle));
    return receipt;
  });
}

function recordAutomationRunGate({
  memoryPath, threadId, invocationAt, gate, checkedAt, details = {},
  treeSha = null, liveCommit = null, changedUrl = null,
}) {
  return withMemoryLock(memoryPath, () => {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const lifecycle = parseStateBlock(content, RUN_LIFECYCLE_BLOCK);
    const lifecycleErrors = validateRunLifecycleState(lifecycle);
    if (lifecycleErrors.length) throw new Error(`Ongeldige run-lifecyclestaat: ${lifecycleErrors.join(' ')}`);
    const activeRun = lifecycle.activeRun;
    if (!activeRun) throw new Error('NO_ACTIVE_RUN: run-gate kan alleen binnen een actieve heartbeat worden geregistreerd.');
    if (activeRun.threadId !== String(threadId || '') || activeRun.invocationAt !== invocationAt) {
      throw new Error('RUN_IDENTITY_MISMATCH: run-gate hoort niet bij de actieve invocation.');
    }
    const receipt = {
      gate: String(gate || ''),
      status: 'ready',
      checkedAt,
      threadId: activeRun.threadId,
      invocationAt: activeRun.invocationAt,
      resultDigest: digestRunGateDetails(details),
      treeSha: treeSha || null,
      liveCommit: liveCommit || null,
      changedUrl: changedUrl || null,
      summary: details,
    };
    const errors = validateRunGateReceipt(receipt, activeRun);
    if (errors.length) throw new Error(`Ongeldige run-gate receipt: ${errors.join(' ')}`);
    const nextLifecycle = {
      ...lifecycle,
      activeRun: {
        ...activeRun,
        gateVersion: Number(activeRun.gateVersion) || RUN_GATE_VERSION,
        gates: { ...(activeRun.gates || {}), [receipt.gate]: receipt },
      },
    };
    const nextErrors = validateRunLifecycleState(nextLifecycle);
    if (nextErrors.length) throw new Error(`Nieuwe run-gatestaat is ongeldig: ${nextErrors.join(' ')}`);
    writeMemoryAtomic(memoryPath, replaceStateBlock(content, RUN_LIFECYCLE_BLOCK, nextLifecycle));
    return receipt;
  });
}

function finishAutomationRun({
  memoryPath, threadId, invocationAt, finishedAt, outcome, publicEffect,
  evidence, prNumber = null, liveCommit = null, changedUrl = null,
}) {
  return withMemoryLock(memoryPath, () => {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const rotation = parseStateBlock(content, ROTATION_BLOCK);
    const rotationErrors = validateRotationState(rotation);
    if (rotationErrors.length) throw new Error(`Ongeldige rotatiestaat: ${rotationErrors.join(' ')}`);
    const lifecycle = parseStateBlock(content, RUN_LIFECYCLE_BLOCK);
    const lifecycleErrors = validateRunLifecycleState(lifecycle);
    if (lifecycleErrors.length) throw new Error(`Ongeldige run-lifecyclestaat: ${lifecycleErrors.join(' ')}`);
    const existingReceipt = lifecycle.receipts.find(
      (receipt) => receipt.threadId === threadId && receipt.invocationAt === invocationAt
    );
    if (!lifecycle.activeRun && existingReceipt) {
      const normalizedPrNumber = prNumber === null || prNumber === undefined || prNumber === '' ? null : Number(prNumber);
      const matches = existingReceipt.finishedAt === finishedAt
        && existingReceipt.outcome === outcome
        && existingReceipt.publicEffect === publicEffect
        && existingReceipt.evidence === String(evidence || '').trim()
        && existingReceipt.prNumber === normalizedPrNumber
        && existingReceipt.liveCommit === (liveCommit || null)
        && existingReceipt.changedUrl === (changedUrl || null);
      if (!matches) throw new Error('FINISH_RECEIPT_MISMATCH: deze invocation is al met andere uitkomst of bewijs afgesloten.');
      return { ...existingReceipt, idempotent: true };
    }
    if (!lifecycle.activeRun) throw new Error('NO_ACTIVE_RUN: er is geen open run om af te sluiten.');
    if (lifecycle.activeRun.threadId !== String(threadId || '') || lifecycle.activeRun.invocationAt !== invocationAt) {
      throw new Error('RUN_IDENTITY_MISMATCH: finish-run hoort niet bij de actieve invocation.');
    }
    if (rotation.activeThreadId !== threadId || rotation.lastInvocationAt !== invocationAt) {
      throw new Error('RUN_ROTATION_MISMATCH: rotatie- en lifecyclestaat lopen uiteen.');
    }
    if (outcome === 'interrupted') throw new Error('interrupted is gereserveerd voor expliciet recover-run-herstel.');
    if (outcome === 'published') {
      const gateErrors = validatePublishedRunGates(lifecycle.activeRun, { liveCommit, changedUrl });
      if (gateErrors.length) throw new Error(`PUBLISHED_GATES_INCOMPLETE: ${gateErrors.join(' ')}`);
    }
    const receipt = {
      ...lifecycle.activeRun,
      finishedAt,
      outcome,
      publicEffect,
      evidence: String(evidence || '').trim(),
      prNumber: prNumber === null || prNumber === undefined || prNumber === '' ? null : Number(prNumber),
      liveCommit: liveCommit || null,
      changedUrl: changedUrl || null,
      autoClosed: false,
      completionGateStatus: outcome === 'published' ? 'ready' : 'not_required',
    };
    const receiptErrors = validateRunReceipt(receipt);
    if (receiptErrors.length) throw new Error(`Ongeldige finish-run receipt: ${receiptErrors.join(' ')}`);
    const nextLifecycle = {
      ...lifecycle,
      activeRun: null,
      lastReceipt: receipt,
      receipts: [...lifecycle.receipts, receipt].slice(-30),
    };
    const nextErrors = validateRunLifecycleState(nextLifecycle);
    if (nextErrors.length) throw new Error(`Nieuwe run-lifecyclestaat is ongeldig: ${nextErrors.join(' ')}`);
    writeMemoryAtomic(memoryPath, replaceStateBlock(content, RUN_LIFECYCLE_BLOCK, nextLifecycle));
    return receipt;
  });
}
function rotateAutomationThread({ memoryPath, fromThreadId, toThreadId, rotatedAt, evidence }) {
  return withMemoryLock(memoryPath, () => {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const current = parseStateBlock(content, ROTATION_BLOCK);
    const errors = validateRotationState(current);
    if (errors.length) throw new Error(`Ongeldige rotatiestaat: ${errors.join(' ')}`);
    const lifecycle = parseStateBlock(content, RUN_LIFECYCLE_BLOCK);
    const lifecycleErrors = validateRunLifecycleState(lifecycle);
    if (lifecycleErrors.length) throw new Error(`Ongeldige run-lifecyclestaat: ${lifecycleErrors.join(' ')}`);
    const ubersuggest = { ...defaultUbersuggestState(), ...(parseStateBlock(content, UBERSUGGEST_BLOCK) || {}) };
    const ubersuggestErrors = validateUbersuggestState(ubersuggest);
    if (ubersuggestErrors.length) throw new Error(`Ongeldige Ubersuggest-staat: ${ubersuggestErrors.join(' ')}`);
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
    if (lifecycle.activeRun) throw new Error('RUN_NOT_FINISHED: sluit run 15 eerst af met finish-run.');
    if (lifecycle.lastReceipt?.threadId !== fromThread || Number(lifecycle.lastReceipt?.runNumber) !== 15) {
      throw new Error('RUN_15_RECEIPT_MISSING: rotatie vereist een geldige finish-run receipt voor run 15.');
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
    const nextUbersuggest = {
      ...ubersuggest,
      boundThreadId: null,
      toolBindingCheckedAt: null,
      boundTools: [],
      toolBindingEvidence: null,
      dataSmokeStatus: 'not_checked',
      dataSmokeThreadId: null,
      dataSmokeCheckedAt: null,
      dataSmokeTools: [],
      dataSmokeOutcomes: {},
      dataSmokeEvidence: null,
    };
    let nextContent = replaceStateBlock(content, ROTATION_BLOCK, next);
    nextContent = replaceStateBlock(nextContent, UBERSUGGEST_BLOCK, nextUbersuggest);
    writeMemoryAtomic(memoryPath, nextContent);
    return next;
  });
}

function repairAutomationThreadBinding({ memoryPath, fromThreadId, toThreadId, repairedAt, reason, evidence }) {
  return withMemoryLock(memoryPath, () => {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const current = parseStateBlock(content, ROTATION_BLOCK);
    const errors = validateRotationState(current);
    if (errors.length) throw new Error(`Ongeldige rotatiestaat: ${errors.join(' ')}`);
    const lifecycle = parseStateBlock(content, RUN_LIFECYCLE_BLOCK);
    const lifecycleErrors = validateRunLifecycleState(lifecycle);
    if (lifecycleErrors.length) throw new Error(`Ongeldige run-lifecyclestaat: ${lifecycleErrors.join(' ')}`);
    const ubersuggest = { ...defaultUbersuggestState(), ...(parseStateBlock(content, UBERSUGGEST_BLOCK) || {}) };
    const fromThread = String(fromThreadId || '').trim();
    const toThread = String(toThreadId || '').trim();
    const repairReason = String(reason || '').trim();
    const repairEvidence = String(evidence || '').trim();
    if (!fromThread || !toThread || fromThread === toThread) throw new Error('Oude en nieuwe binding-task moeten geldig en verschillend zijn.');
    if (!validIso(repairedAt)) throw new Error('repairedAt is ongeldig.');
    if (repairReason.length < 8 || repairEvidence.length < 8) throw new Error('Binding-repair mist reden of bewijs.');
    const previousRepair = current.bindingRepairHistory?.at(-1);
    if (
      current.activeThreadId === toThread
      && previousRepair?.fromThreadId === fromThread
      && previousRepair?.toThreadId === toThread
      && previousRepair?.repairedAt === repairedAt
    ) return { ...current, idempotent: true };
    if (current.activeThreadId !== fromThread) throw new Error('De actieve task komt niet overeen met --from-thread.');
    if (Number(current.completedRunsInActiveThread) >= 15 || current.rotationStatus !== 'active') {
      throw new Error('BINDING_REPAIR_NOT_ALLOWED: gebruik na run 15 de normale rotatie.');
    }
    if (lifecycle.activeRun) throw new Error('RUN_NOT_FINISHED: repareer de taskbinding alleen tussen twee runs.');
    if (current.previousThreadIds.includes(toThread)) throw new Error('De nieuwe binding-task is al historisch gebruikt.');
    const repair = { fromThreadId: fromThread, toThreadId: toThread, repairedAt, reason: repairReason, evidence: repairEvidence };
    const next = {
      ...current,
      activeThreadId: toThread,
      previousThreadIds: [...current.previousThreadIds, fromThread],
      bindingRepairHistory: [...(current.bindingRepairHistory || []), repair],
      evidence: repairEvidence,
    };
    const nextErrors = validateRotationState(next);
    if (nextErrors.length) throw new Error(`Nieuwe rotatiestaat is ongeldig: ${nextErrors.join(' ')}`);
    const nextUbersuggest = {
      ...ubersuggest,
      boundThreadId: null,
      toolBindingCheckedAt: null,
      boundTools: [],
      toolBindingEvidence: null,
      dataSmokeStatus: 'not_checked',
      dataSmokeThreadId: null,
      dataSmokeCheckedAt: null,
      dataSmokeTools: [],
      dataSmokeOutcomes: {},
      dataSmokeEvidence: null,
    };
    let nextContent = replaceStateBlock(content, ROTATION_BLOCK, next);
    nextContent = replaceStateBlock(nextContent, UBERSUGGEST_BLOCK, nextUbersuggest);
    writeMemoryAtomic(memoryPath, nextContent);
    return next;
  });
}

function recordUbersuggestToolBinding({ memoryPath, threadId, checkedAt, tools, evidence }) {
  return withMemoryLock(memoryPath, () => {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const rotation = parseStateBlock(content, ROTATION_BLOCK);
    const rotationErrors = validateRotationState(rotation);
    if (rotationErrors.length) throw new Error(`Ongeldige rotatiestaat: ${rotationErrors.join(' ')}`);
    const current = { ...defaultUbersuggestState(), ...(parseStateBlock(content, UBERSUGGEST_BLOCK) || {}) };
    const boundTools = Array.from(new Set(String(tools || '').split(',').map((tool) => tool.trim()).filter(Boolean))).sort();
    if (rotation.activeThreadId !== String(threadId || '').trim()) throw new Error('Toolbinding hoort niet bij de actieve automation-task.');
    if (!validIso(checkedAt)) throw new Error('checkedAt is ongeldig.');
    const missing = REQUIRED_UBERSUGGEST_TOOLS.filter((toolName) => !boundTools.includes(toolName));
    if (missing.length) throw new Error(`Toolbinding mist verplichte Ubersuggest-tools: ${missing.join(', ')}.`);
    if (String(evidence || '').trim().length < 8) throw new Error('Toolbindingbewijs ontbreekt.');
    const next = {
      ...current,
      boundThreadId: String(threadId).trim(),
      toolBindingCheckedAt: checkedAt,
      boundTools,
      toolBindingEvidence: String(evidence).trim(),
    };
    const errors = validateUbersuggestState(next);
    if (errors.length) throw new Error(`Ongeldige Ubersuggest-toolbinding: ${errors.join(' ')}`);
    writeMemoryAtomic(memoryPath, replaceStateBlock(content, UBERSUGGEST_BLOCK, next));
    return next;
  });
}

function recordUbersuggestDataSmoke({ memoryPath, threadId, checkedAt, tools, outcomes, evidence }) {
  return withMemoryLock(memoryPath, () => {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const rotation = parseStateBlock(content, ROTATION_BLOCK);
    const rotationErrors = validateRotationState(rotation);
    if (rotationErrors.length) throw new Error(`Ongeldige rotatiestaat: ${rotationErrors.join(' ')}`);
    const current = { ...defaultUbersuggestState(), ...(parseStateBlock(content, UBERSUGGEST_BLOCK) || {}) };
    const smokeTools = Array.from(new Set(String(tools || '').split(',').map((tool) => tool.trim()).filter(Boolean))).sort();
    let smokeOutcomes;
    try {
      smokeOutcomes = typeof outcomes === 'string' ? JSON.parse(outcomes) : outcomes;
    } catch (error) {
      throw new Error(`Data-smoke outcomes-JSON is ongeldig: ${error.message}`);
    }
    const normalizedThreadId = String(threadId || '').trim();
    if (rotation.activeThreadId !== normalizedThreadId || current.boundThreadId !== normalizedThreadId) {
      throw new Error('Data-smoke hoort niet bij de actieve, gebonden automation-task.');
    }
    if (!validIso(checkedAt)) throw new Error('checkedAt is ongeldig.');
    const missing = REQUIRED_UBERSUGGEST_TOOLS.filter((toolName) => !smokeTools.includes(toolName));
    if (missing.length) throw new Error(`Data-smoke mist verplichte Ubersuggest-tools: ${missing.join(', ')}.`);
    if (String(evidence || '').trim().length < 20) throw new Error('Data-smokebewijs is te vaag.');
    const next = {
      ...current,
      lastAuthCheckAt: checkedAt,
      lastStatus: 'ready',
      dataSmokeStatus: 'ready',
      dataSmokeThreadId: normalizedThreadId,
      dataSmokeCheckedAt: checkedAt,
      dataSmokeTools: smokeTools,
      dataSmokeOutcomes: smokeOutcomes,
      dataSmokeEvidence: String(evidence).trim(),
    };
    const errors = validateUbersuggestState(next);
    if (errors.length) throw new Error(`Ongeldige Ubersuggest data-smoke: ${errors.join(' ')}`);
    writeMemoryAtomic(memoryPath, replaceStateBlock(content, UBERSUGGEST_BLOCK, next));
    return next;
  });
}

function extractRunGateCliOptions(argv = []) {
  const remaining = [];
  const options = { enabled: false, threadId: null, invocationAt: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--record-run-gate') {
      options.enabled = true;
      continue;
    }
    if (arg === '--run-thread' || arg === '--run-invocation-at') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} mist een waarde.`);
      if (arg === '--run-thread') options.threadId = value;
      else options.invocationAt = value;
      index += 1;
      continue;
    }
    remaining.push(arg);
  }
  if (options.enabled && (!String(options.threadId || '').trim() || !validIso(options.invocationAt))) {
    throw new Error('--record-run-gate vereist --run-thread en --run-invocation-at.');
  }
  if (!options.enabled && (options.threadId || options.invocationAt)) {
    throw new Error('--run-thread/--run-invocation-at mogen alleen met --record-run-gate.');
  }
  return { ...options, remaining };
}

function resolveGitTreeSha(ref = 'HEAD', { cwd = path.resolve(__dirname, '..'), requireClean = false } = {}) {
  if (requireClean) {
    const status = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
    if (status.status !== 0) throw new Error('Git-status kon niet worden gecontroleerd voor de run-gate.');
    if (String(status.stdout || '').trim()) throw new Error('TREE_GATE_DIRTY: treegebonden run-gates vereisen een schone checkout.');
  }
  const result = spawnSync('git', ['rev-parse', `${ref}^{tree}`], { cwd, encoding: 'utf8' });
  const treeSha = String(result.stdout || '').trim();
  if (result.status !== 0 || !/^[a-f0-9]{40}$/i.test(treeSha)) {
    throw new Error(`Git tree voor ${ref} kon niet betrouwbaar worden bepaald.`);
  }
  return treeSha;
}

function recordAutomationRunGateFromCli({
  gateOptions,
  gate,
  details,
  memoryPath = DEFAULT_MEMORY_PATH,
  treeRef = null,
  liveCommit = null,
  changedUrl = null,
  cwd = path.resolve(__dirname, '..'),
}) {
  if (!gateOptions?.enabled) return null;
  const needsTree = TREE_BOUND_RUN_GATES.includes(gate);
  const resolvedTreeRef = treeRef || (needsTree ? 'HEAD' : null);
  const treeSha = resolvedTreeRef
    ? resolveGitTreeSha(resolvedTreeRef, { cwd, requireClean: needsTree && resolvedTreeRef === 'HEAD' })
    : null;
  return recordAutomationRunGate({
    memoryPath,
    threadId: gateOptions.threadId,
    invocationAt: gateOptions.invocationAt,
    gate,
    checkedAt: new Date().toISOString(),
    details,
    treeSha,
    liveCommit,
    changedUrl,
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
  const auditOptions = {
    memoryPath,
    automationPath: options.automationPath || DEFAULT_AUTOMATION_PATH,
    automationsRoot: options.automationsRoot || DEFAULT_AUTOMATIONS_ROOT,
    now: new Date(args.now || Date.now()),
  };
  let result;
  if (args.command === 'audit') {
    result = auditAutomationInstallation(auditOptions);
    if (result.errors.length) throw new Error(`Automation-installatie ongeldig: ${result.errors.join(' ')}`);
  } else if (args.command === 'inspect') {
    result = inspectAutomationState(memoryPath, new Date(args.now || Date.now()));
    const errors = [...result.rotationErrors, ...result.ubersuggestErrors, ...result.lifecycleErrors];
    if (errors.length) throw new Error(`Automation-state ongeldig: ${errors.join(' ')}`);
  } else if (args.command === 'ensure') result = ensureAutomationState(memoryPath, new Date(args.now || Date.now()));
  else if (args.command === 'start-run') {
    const audit = auditAutomationInstallation(auditOptions);
    if (audit.errors.length) throw new Error(`Automation-installatie ongeldig: ${audit.errors.join(' ')}`);
    result = startAutomationRun({ memoryPath, threadId: args.thread, invocationAt: args['invocation-at'] });
  }
  else if (args.command === 'finish-run') result = finishAutomationRun({
    memoryPath, threadId: args.thread, invocationAt: args['invocation-at'], finishedAt: args['finished-at'],
    outcome: args.outcome, publicEffect: args['public-effect'], evidence: args.evidence,
    prNumber: args['pr-number'], liveCommit: args['live-commit'], changedUrl: args['changed-url'],
  });
  else if (args.command === 'recover-run') result = recoverInterruptedRun({
    memoryPath, threadId: args.thread, recoveredAt: args['recovered-at'], evidence: args.evidence,
  });
  else if (args.command === 'rotate-thread') result = rotateAutomationThread({
    memoryPath, fromThreadId: args['from-thread'], toThreadId: args['to-thread'],
    rotatedAt: args['rotated-at'], evidence: args.evidence,
  });
  else if (args.command === 'repair-thread-binding') result = repairAutomationThreadBinding({
    memoryPath, fromThreadId: args['from-thread'], toThreadId: args['to-thread'],
    repairedAt: args['repaired-at'], reason: args.reason, evidence: args.evidence,
  });
  else if (args.command === 'record-tool-binding') result = recordUbersuggestToolBinding({
    memoryPath, threadId: args.thread, checkedAt: args['checked-at'], tools: args.tools, evidence: args.evidence,
  });
  else if (args.command === 'record-tool-smoke') result = recordUbersuggestDataSmoke({
    memoryPath, threadId: args.thread, checkedAt: args['checked-at'], tools: args.tools,
    outcomes: args['outcomes-json'], evidence: args.evidence,
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
  AUTOMATION_ID, AUTOMATION_NAME, AUTOMATION_PROMPT_VERSION, AUTOMATION_RRULE, DEFAULT_AUTOMATION_PATH, DEFAULT_AUTOMATIONS_ROOT,
  DEFAULT_MAX_RUNS_PER_THREAD, DEFAULT_MEMORY_PATH, FORBIDDEN_PROMPT_MARKERS, PUBLIC_EFFECTS,
  REQUIRED_PROMPT_MARKERS, REQUIRED_UBERSUGGEST_TOOLS, REQUIRED_PUBLISHED_RUN_GATES,
  ROTATION_BLOCK, RUN_GATE_VERSION, RUN_GATES, RUN_LIFECYCLE_BLOCK, RUN_OUTCOMES,
  TREE_BOUND_RUN_GATES, UBERSUGGEST_BLOCK,
  UBERSUGGEST_STATUSES, auditAutomationInstallation, defaultUbersuggestState, ensureAutomationState,
  defaultRunLifecycleState, digestRunGateDetails, extractRunGateCliOptions, findSeoAutomationPaths,
  finishAutomationRun, formatStateBlock, inspectAutomationState, isWeeklyDiscoveryDue, parseArgs,
  parseAutomationToml, parseStateBlock, recordAutomationRunGate, recordAutomationRunGateFromCli,
  recordUbersuggestDataSmoke, recordUbersuggestRun, recordUbersuggestToolBinding, recoverInterruptedRun,
  repairAutomationThreadBinding, replaceStateBlock, resolveGitTreeSha, rotateAutomationThread,
  runAutomationStateCli, startAutomationRun, validatePublishedRunGates, validateRotationState,
  validateRunGateReceipt, validateRunLifecycleState, validateRunReceipt, validateUbersuggestState,
};
