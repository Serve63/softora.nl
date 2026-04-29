const UI_STATE_SCOPE_PREFIX = 'ui_state:';

const supabaseUiStateScopes = Object.freeze({
  coldcalling: 'coldcalling',
  coldcallingBusinessSoftware: 'coldcalling_business_software',
  coldcallingPreferences: 'coldcalling_preferences',
  coldcallingVoiceSoftware: 'coldcalling_voice_software',
});

const supabaseUiStateStorageKeys = Object.freeze({
  coldcallingBusinessMode: 'softora_business_mode',
  coldcallingLeadRowsJson: 'softora_coldcalling_lead_rows_json',
  coldcallingStatsResetBaselineStarted: 'softora_stats_reset_baseline_started',
});

function normalizeColdcallingBusinessMode(mode) {
  const raw = String(mode || '').trim().toLowerCase();
  if (raw === 'voice_software') return 'voice_software';
  if (raw === 'business_software') return 'business_software';
  return 'websites';
}

function resolveColdcallingUiStateScopeForBusinessMode(mode, baseScope = supabaseUiStateScopes.coldcalling) {
  const normalizedMode = normalizeColdcallingBusinessMode(mode);
  const normalizedBaseScope = String(baseScope || '').trim() || supabaseUiStateScopes.coldcalling;
  if (normalizedMode === 'voice_software') return `${normalizedBaseScope}_voice_software`;
  if (normalizedMode === 'business_software') return `${normalizedBaseScope}_business_software`;
  return normalizedBaseScope;
}

module.exports = {
  UI_STATE_SCOPE_PREFIX,
  normalizeColdcallingBusinessMode,
  resolveColdcallingUiStateScopeForBusinessMode,
  supabaseUiStateScopes,
  supabaseUiStateStorageKeys,
};
