const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'assets', 'transferwereld-data.js');
const SCOPE_DATA_PATH = path.join(ROOT, 'assets', 'transferwereld-scope-data.js');

function evaluateDataFile(filePath, globalName) {
  if (!fs.existsSync(filePath)) return null;
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(filePath, 'utf8'), context);
  return context.window[globalName] || null;
}

function loadTransferwereldDataset() {
  const dataset = evaluateDataFile(DATA_PATH, 'TRANSFERWERELD_DATA') || { clubs: [] };
  const scope = evaluateDataFile(SCOPE_DATA_PATH, 'TRANSFERWERELD_SCOPE_DATA');
  if (!scope?.clubs?.length) return dataset;
  return {
    ...dataset,
    clubs: [...(dataset.clubs || []), ...scope.clubs],
    scopeLeagues: scope.scopeLeagues || dataset.scopeLeagues,
  };
}

function writeTransferwereldDataset(dataset) {
  const baseClubCount = Number(dataset.meta?.baseClubCount) || Math.min(101, dataset.clubs?.length || 0);
  const baseClubs = (dataset.clubs || []).slice(0, baseClubCount);
  const scopeClubs = (dataset.clubs || []).slice(baseClubCount);
  const core = {
    ...dataset,
    meta: { ...dataset.meta, baseClubCount },
    clubs: baseClubs,
  };
  delete core.scopeLeagues;
  const scope = {
    clubs: scopeClubs,
    scopeLeagues: dataset.scopeLeagues || [],
  };
  fs.writeFileSync(DATA_PATH, `window.TRANSFERWERELD_DATA=${JSON.stringify(core)};\n`, 'utf8');
  fs.writeFileSync(SCOPE_DATA_PATH, `window.TRANSFERWERELD_SCOPE_DATA=${JSON.stringify(scope)};\n`, 'utf8');
  return {
    baseBytes: fs.statSync(DATA_PATH).size,
    scopeBytes: fs.statSync(SCOPE_DATA_PATH).size,
    baseClubs: baseClubs.length,
    scopeClubs: scopeClubs.length,
  };
}

module.exports = {
  DATA_PATH,
  SCOPE_DATA_PATH,
  loadTransferwereldDataset,
  writeTransferwereldDataset,
};
