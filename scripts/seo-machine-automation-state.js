#!/usr/bin/env node
const path = require('node:path');

const {
  ensureAutomationState,
  inspectAutomationState,
  recordUbersuggestRun,
  startAutomationRun,
} = require('../server/services/seo-machine-automation-state');

const DEFAULT_MEMORY_PATH = path.join(
  process.env.CODEX_HOME || path.join(process.env.HOME || '', '.codex'),
  'automations',
  'softora-seo-actiemachine',
  'memory.md'
);

function parseArgs(argv = process.argv.slice(2)) {
  const args = { command: argv[0] || 'inspect', memoryPath: DEFAULT_MEMORY_PATH };
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = value;
    index += 1;
  }
  if (args.memory) args.memoryPath = path.resolve(args.memory);
  return args;
}

function runAutomationStateCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  let result;
  if (args.command === 'inspect') {
    result = inspectAutomationState(args.memoryPath, new Date(args.now || Date.now()));
    const stateErrors = [...result.rotationErrors, ...result.ubersuggestErrors];
    if (stateErrors.length) {
      const error = new Error(`Automation-state ongeldig: ${stateErrors.join(' ')}`);
      error.code = 'INVALID_AUTOMATION_STATE';
      throw error;
    }
  } else if (args.command === 'ensure') {
    result = ensureAutomationState(args.memoryPath, new Date(args.now || Date.now()));
  } else if (args.command === 'start-run') {
    result = startAutomationRun({
      memoryPath: args.memoryPath,
      threadId: args.thread,
      invocationAt: args['invocation-at'],
    });
  } else if (args.command === 'record-keywords') {
    result = recordUbersuggestRun({
      memoryPath: args.memoryPath,
      status: args.status,
      runDate: args['run-date'],
      contentCallsUsed: args['content-calls'],
      weeklyCallsUsed: args['weekly-calls'],
      evidencePath: args['evidence-path'],
      authCheckedAt: args['auth-checked-at'],
      weeklyDiscoveryAt: args['weekly-discovery-at'],
    });
  } else {
    throw new Error(`Onbekend automation-state commando: ${args.command}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try {
    runAutomationStateCli();
  } catch (error) {
    console.error(`[seo-automation-state] ${error.message || String(error)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_MEMORY_PATH,
  parseArgs,
  runAutomationStateCli,
};
