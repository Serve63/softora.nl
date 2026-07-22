const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

test('least privilege routes keep mailbox, costs and recordings admin-only', () => {
  const featureRoutes = readRepoFile('server/services/feature-routes-runtime.js');
  const mailboxRoutes = readRepoFile('server/routes/mailbox.js');
  const openAiCostRoutes = readRepoFile('server/routes/openai-costs.js');
  const supabaseCostRoutes = readRepoFile('server/routes/supabase-costs.js');
  const supabaseMaintenanceRoutes = readRepoFile('server/routes/supabase-maintenance.js');
  const coldcallingRoutes = readRepoFile('server/routes/coldcalling.js');
  const coldmailingRoutes = readRepoFile('server/routes/coldmailing.js');
  const instantlyRoutes = readRepoFile('server/routes/instantly.js');
  const revenueProofRoutes = readRepoFile('server/routes/revenue-proof.js');

  assert.match(featureRoutes, /requirePremiumAdminApiAccess: premiumRouteRuntime\?\.requirePremiumAdminApiAccess/);
  assert.match(mailboxRoutes, /app\.get\('\/api\/mailbox\/accounts', requireAdmin,/);
  assert.match(mailboxRoutes, /app\.get\('\/api\/mailbox\/campaign-replies', requireAdmin,/);
  assert.match(mailboxRoutes, /app\.get\('\/api\/mailbox\/messages', requireAdmin,/);
  assert.match(mailboxRoutes, /app\.post\('\/api\/mailbox\/send', requireAdmin,/);
  assert.match(openAiCostRoutes, /app\.get\('\/api\/openai-costs', requireAdmin,/);
  assert.match(openAiCostRoutes, /app\.get\('\/api\/openai\/cost-summary', requireAdmin,/);
  assert.match(openAiCostRoutes, /app\.get\('\/api\/api-cost-summary', requireAdmin,/);
  assert.match(openAiCostRoutes, /app\.get\('\/api\/api-cost-diagnostics', requireAdmin,/);
  assert.match(supabaseCostRoutes, /app\.get\('\/api\/supabase\/cost-summary', requireAdmin,/);
  assert.match(supabaseCostRoutes, /app\.get\('\/api\/supabase\/cost-diagnostics', requireAdmin,/);
  assert.match(supabaseMaintenanceRoutes, /createSupabaseMaintenanceAccessGuard/);
  assert.match(
    supabaseMaintenanceRoutes,
    /app\.post\('\/api\/supabase\/database\/restart', requireMaintenance,/
  );
  assert.ok(
    featureRoutes.indexOf('registerSupabaseMaintenanceRoutes(app') < featureRoutes.indexOf('createPremiumRouteRuntime({'),
    'Supabase maintenance restart route must stay before generic /api premium-auth middleware'
  );
  assert.match(coldmailingRoutes, /app\.post\('\/api\/coldmailing\/outreach\/status', requirePremiumAdminApiAccess,/);
  assert.match(instantlyRoutes, /app\.post\('\/api\/instantly\/sync', requirePremiumAdminApiAccess,/);
  assert.match(instantlyRoutes, /app\.get\('\/api\/instantly\/status', requirePremiumAdminApiAccess,/);
  assert.match(instantlyRoutes, /app\.post\('\/api\/instantly\/webhook', async \(req, res\)/);
  assert.match(revenueProofRoutes, /app\.post\('\/api\/revenue-proof\/events', requireAdmin,/);
  assert.match(revenueProofRoutes, /app\.get\('\/api\/revenue-proof\/status', requireAdmin,/);
  assert.match(revenueProofRoutes, /app\.post\('\/api\/revenue-proof\/bunq-webhook', \(req, res, next\)/);
  assert.match(coldcallingRoutes, /app\.get\('\/api\/coldcalling\/recording-proxy', requireAdmin,/);
  assert.match(coldcallingRoutes, /app\.get\('\/api\/coldcalling\/cost-summary', requireAdmin,/);
});

test('least privilege call data responses redact transcripts and recordings for non-admin users', () => {
  const coldcallingRoutes = readRepoFile('server/routes/coldcalling.js');

  assert.match(coldcallingRoutes, /function canViewSensitiveCallData\(req\)/);
  assert.match(coldcallingRoutes, /req\.premiumAuth\.isAdmin && req\.premiumAuth\.user/);
  assert.match(coldcallingRoutes, /'transcriptFull'/);
  assert.match(coldcallingRoutes, /'recordingUrl'/);
  assert.match(coldcallingRoutes, /updates: filterSensitiveCallPayloadForRequest\(req, filtered\.slice\(0, limit\)\)/);
  assert.match(coldcallingRoutes, /detail: filterSensitiveCallPayloadForRequest\(req, detail\)/);
  assert.match(coldcallingRoutes, /insights: filterSensitiveCallPayloadForRequest\(req, deps\.recentAiCallInsights\.slice\(0, limit\)\)/);
});
