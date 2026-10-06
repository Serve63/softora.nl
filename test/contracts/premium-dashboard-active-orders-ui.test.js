const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium dashboard leest actieve opdrachten uit chunked Supabase state', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-dashboard.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const loadOrdersSource = pageSource.slice(
    pageSource.indexOf('async function loadPremiumDashboardOrders('),
    pageSource.indexOf('async function loadPremiumDashboardCustomers(')
  );
  const validationLine = loadOrdersSource.split('\n').find((line) => line.includes('Geen Supabase-opdrachtdata')) || '';

  assert.match(
    pageSource,
    /readPremiumDashboardChunkedStateValue\(safeValues, PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY\)/
  );
  assert.match(
    pageSource,
    /readPremiumDashboardChunkedStateValue\(safeValues, PREMIUM_ACTIVE_RUNTIME_KEY\)/
  );
  assert.match(validationLine, /getPremiumDashboardChunkMetaKey\(PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY\)/);
  assert.doesNotMatch(validationLine, /PREMIUM_ACTIVE_RUNTIME_KEY/);
  assert.match(pageSource, /safeValues\[PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY\]/);
  assert.match(pageSource, /safeValues\[PREMIUM_ACTIVE_RUNTIME_KEY\]/);
  assert.match(pageSource, /const amount = Math\.round\(Number\(item\?\.amount\)\);/);
  assert.match(pageSource, /if \(!Number\.isFinite\(amount\) \|\| amount <= 0\) return null;/);
  assert.match(pageSource, /companyName: String\(item\?\.companyName \|\| ''\)\.trim\(\),/);
  assert.match(pageSource, /contactName: String\(item\?\.contactName \|\| ''\)\.trim\(\),/);
  assert.match(pageSource, /clientName: String\(item\?\.clientName \|\| item\?\.companyName \|\| runtime\?\.name \|\| ''\)\.trim\(\),/);
  assert.match(pageSource, /statusKey: String\(runtime\?\.statusKey \|\| item\?\.statusKey \|\| item\?\.status \|\| ''\)\.trim\(\),/);
  assert.match(
    pageSource,
    /const activeOrders = orders\.filter\(\(order\) => !order\?\.ui\?\.isBuilt\);/
  );
  assert.match(pageSource, /typeof dashboardCore\.getCustomerRevenueDate === 'function'/);
  assert.match(pageSource, /dashboardCore\.getCustomerRevenueDate\(customer, paidOrders, now\)/);
  assert.match(pageSource, /data-kpi-active-total/);
  assert.match(pageSource, /dashboardCore\.updateActiveOrdersDisplay\(activeOrders\)/);
  assert.doesNotMatch(pageSource, /data-kpi-active-(website|business|voice|chatbot)|kpi-active-count|classifyPremiumDashboardOrderProductLine/);
});


test('dashboard refresh displays one total for all active order types and an empty list', () => {
  const dashboardCore = require('../../assets/premium-dashboard-core');
  const element = { textContent: '--', setAttribute(name, value) { this[name] = value; } };
  const doc = { getElementById: () => element };
  dashboardCore.updateActiveOrdersDisplay(['Website', 'CRM', 'Voice', 'Chatbot', 'Other'].map(title => ({ title })), doc);
  assert.equal(element.textContent, '5');
  assert.equal(element['aria-label'], 'Actieve opdrachten: 5');
  dashboardCore.updateActiveOrdersDisplay([], doc);
  assert.equal(element.textContent, '0');
});
