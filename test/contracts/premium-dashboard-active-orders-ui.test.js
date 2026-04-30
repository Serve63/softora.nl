const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium dashboard leest actieve opdrachten uit chunked Supabase state', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-dashboard.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(
    pageSource,
    /readPremiumDashboardChunkedStateValue\(safeValues, PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY\)/
  );
  assert.match(
    pageSource,
    /readPremiumDashboardChunkedStateValue\(safeValues, PREMIUM_ACTIVE_RUNTIME_KEY\)/
  );
  assert.doesNotMatch(pageSource, /amount <= 0\) return null;/);
  assert.match(pageSource, /!merged\.clientName \|\| !merged\.title \|\| !merged\.description \|\| !merged\.amount/);
  assert.match(
    pageSource,
    /const activeOrders = orders\.filter\(\(order\) => !order\?\.ui\?\.isBuilt\);/
  );
});
