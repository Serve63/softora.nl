(function (global) {
  const config = Object.freeze({
    TEST_LEAD_STORAGE_KEY: 'softora_coldcalling_test_lead_phone',
    LEAD_ROWS_STORAGE_KEY: 'softora_coldcalling_lead_rows_json',
    AI_NOTEBOOK_ROWS_STORAGE_KEY: 'softora_ai_notebook_rows_json',
    LEAD_DATABASE_OVERRIDES_STORAGE_KEY: 'softora_coldcalling_lead_database_overrides_json',
    CALL_DISPATCH_MODE_STORAGE_KEY: 'softora_call_dispatch_mode',
    CALL_DISPATCH_DELAY_STORAGE_KEY: 'softora_call_dispatch_delay_seconds',
    STATS_RESET_BASELINE_STORAGE_KEY: 'softora_stats_reset_baseline_started',
    CAMPAIGN_AMOUNT_SLIDER_INDEX_STORAGE_KEY: 'softora_campaign_amount_slider_index',
    CAMPAIGN_AMOUNT_CUSTOM_STORAGE_KEY: 'softora_campaign_amount_custom',
    CAMPAIGN_BRANCHE_STORAGE_KEY: 'softora_campaign_branche',
    CAMPAIGN_REGIO_STORAGE_KEY: 'softora_campaign_regio',
    CAMPAIGN_REGIO_CUSTOM_KM_STORAGE_KEY: 'softora_campaign_regio_custom_km',
    CAMPAIGN_MIN_PRICE_STORAGE_KEY: 'softora_campaign_min_price',
    CAMPAIGN_MAX_DISCOUNT_STORAGE_KEY: 'softora_campaign_max_discount',
    CAMPAIGN_INSTRUCTIONS_STORAGE_KEY: 'softora_campaign_instructions',
    CAMPAIGN_COLDCALLING_STACK_STORAGE_KEY: 'softora_campaign_coldcalling_stack',
    CAMPAIGN_FILL_AGENDA_10_WORKDAYS_STORAGE_KEY: 'softora_campaign_fill_agenda_10_workdays',
    CAMPAIGN_AMOUNT_QUESTION_MODE_STORAGE_KEY: 'softora_campaign_amount_question_mode',
    CAMOUNT_Q_BELLEN: 'bellen',
    CAMOUNT_Q_AFSPRAKEN: 'afspraken',
    BUSINESS_MODE_STORAGE_KEY: 'softora_business_mode',
    DEFAULT_CAMPAIGN_REGIO_VALUE: 'unlimited',
    CUSTOM_CAMPAIGN_REGIO_VALUE: 'custom',
    AUTO_CAMPAIGN_REGIO_VALUE: 'auto',
    REMOTE_UI_STATE_SCOPE_BASE: 'coldcalling',
    REMOTE_UI_STATE_SCOPE_PREFERENCES: 'coldcalling_preferences',
    BUSINESS_MODE_ORDER: Object.freeze(['websites', 'voice_software', 'business_software']),
  });

  global.SoftoraColdcallingDashboardConfig = config;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = config;
  }
})(typeof window !== 'undefined' ? window : globalThis);
