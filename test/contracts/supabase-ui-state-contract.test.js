const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  resolveColdcallingUiStateScopeForBusinessMode,
  supabaseUiStateScopes,
  supabaseUiStateStorageKeys,
} = require('../../server/config/supabase-ui-state-contract');

const repoRoot = path.resolve(__dirname, '../..');

test('supabase ui-state contract centralizes coldcalling scopes and storage keys', () => {
  assert.equal(supabaseUiStateScopes.coldcalling, 'coldcalling');
  assert.equal(supabaseUiStateScopes.coldcallingPreferences, 'coldcalling_preferences');
  assert.equal(
    resolveColdcallingUiStateScopeForBusinessMode('voice_software'),
    'coldcalling_voice_software'
  );
  assert.equal(
    resolveColdcallingUiStateScopeForBusinessMode('business_software'),
    'coldcalling_business_software'
  );
  assert.equal(
    supabaseUiStateStorageKeys.coldcallingLeadRowsJson,
    'softora_coldcalling_lead_rows_json'
  );
  assert.equal(supabaseUiStateStorageKeys.coldcallingBusinessMode, 'softora_business_mode');
});

test('coldcalling dashboard frontend stays aligned with the Supabase ui-state contract', () => {
  const dashboardSource = fs.readFileSync(
    path.join(repoRoot, 'assets/coldcalling-dashboard.js'),
    'utf8'
  );

  assert.match(
    dashboardSource,
    new RegExp(`const LEAD_ROWS_STORAGE_KEY = '${supabaseUiStateStorageKeys.coldcallingLeadRowsJson}';`)
  );
  assert.match(
    dashboardSource,
    new RegExp(`const BUSINESS_MODE_STORAGE_KEY = '${supabaseUiStateStorageKeys.coldcallingBusinessMode}';`)
  );
  assert.match(
    dashboardSource,
    new RegExp(`const REMOTE_UI_STATE_SCOPE_BASE = '${supabaseUiStateScopes.coldcalling}';`)
  );
  assert.match(
    dashboardSource,
    new RegExp(`const REMOTE_UI_STATE_SCOPE_PREFERENCES = '${supabaseUiStateScopes.coldcallingPreferences}';`)
  );
});
