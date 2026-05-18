const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.join(__dirname, '../..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('iOS agenda app toont geen blokkerende popup bij tijdelijke Supabase-opslag hydration', () => {
  const storeSource = readSource('ios/SoftoraAgenda/SoftoraAgenda/AgendaStore.swift');

  assert.match(storeSource, /guard !isRecoverableSupabaseHydrationIssue\(error\) else \{ return \}/);
  assert.match(storeSource, /private func isRecoverableSupabaseHydrationIssue\(_ error: Error\) -> Bool/);
  assert.match(storeSource, /gedeelde supabase-opslag/);
  assert.match(storeSource, /niet veilig geladen/);
  assert.match(storeSource, /nog niet geladen/);
});
