/**
 * UI-state scopes that contain sensitive data and therefore require an
 * authenticated admin session, not just a generic premium login.
 */
const ADMIN_ONLY_UI_STATE_SCOPES = Object.freeze([
  'premium_active_orders',
  'premium_api_costs',
  'premium_bookkeeping',
  'premium_coldmailing_settings',
  'premium_customers_database',
  'premium_dashboard_ai_management',
  'premium_database_photos',
  'premium_monthly_costs',
  'premium_password_register',
]);

function createAdminOnlyUiStateScopesSet() {
  return new Set(ADMIN_ONLY_UI_STATE_SCOPES);
}

module.exports = {
  ADMIN_ONLY_UI_STATE_SCOPES,
  createAdminOnlyUiStateScopesSet,
};
