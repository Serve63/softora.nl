/**
 * UI-state scopes that contain sensitive data and therefore require an
 * authenticated admin session, not just a generic premium login.
 */
const ADMIN_ONLY_UI_STATE_SCOPES = Object.freeze([
  'premium_password_register',
]);

function createAdminOnlyUiStateScopesSet() {
  return new Set(ADMIN_ONLY_UI_STATE_SCOPES);
}

module.exports = {
  ADMIN_ONLY_UI_STATE_SCOPES,
  createAdminOnlyUiStateScopesSet,
};
