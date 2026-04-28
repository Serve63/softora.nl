const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../..');
const contractPath = path.join(repoRoot, 'docs/customer-status-contract.md');

test('customer status contract keeps the central repository helper as the safe path', () => {
  const contract = fs.readFileSync(contractPath, 'utf8');

  assert.match(contract, /updateCustomerStatusWithHistoryInRows/);
  assert.match(contract, /Gebruik centrale repository-helpers/);
  assert.match(contract, /Schrijf geen nieuwe statusgeschiedenis/);
  assert.match(contract, /Breid `server\.js` niet uit met klantstatuslogica/);
  assert.match(contract, /updated === true/);
});

test('customer status contract documents the minimum regression coverage for future agents', () => {
  const contract = fs.readFileSync(contractPath, 'utf8');

  assert.match(contract, /de succesvolle update/);
  assert.match(contract, /een missende klantmatch/);
  assert.match(contract, /invalid of lege statusinput/);
  assert.match(contract, /brondata die niet gemuteerd mag worden/);
  assert.match(contract, /statusgeschiedenis die begrensd blijft/);
});

test('root agent instructions point status changes to the customer status contract', () => {
  const agentsPath = path.join(repoRoot, 'AGENTS.md');
  const instructions = fs.readFileSync(agentsPath, 'utf8');

  assert.match(instructions, /docs\/customer-status-contract\.md/);
  assert.match(instructions, /klantstatussen/);
});

test('repository migration plan points customer status migrations to the central contract', () => {
  const migrationPlanPath = path.join(repoRoot, 'docs/repository-migration-plan.md');
  const migrationPlan = fs.readFileSync(migrationPlanPath, 'utf8');

  assert.match(migrationPlan, /docs\/customer-status-contract\.md/);
  assert.match(migrationPlan, /updateCustomerStatusWithHistoryInRows/);
  assert.match(migrationPlan, /geen eigen statusnormalisatie/);
  assert.match(migrationPlan, /server\.js/);
});

test('data ownership map keeps customer statuses owned by the premium customer repository', () => {
  const ownershipMapPath = path.join(repoRoot, 'docs/data-ownership-map.md');
  const ownershipMap = fs.readFileSync(ownershipMapPath, 'utf8');

  assert.match(ownershipMap, /Klantstatussen/);
  assert.match(ownershipMap, /docs\/customer-status-contract\.md/);
  assert.match(ownershipMap, /updateCustomerStatusWithHistoryInRows/);
  assert.match(ownershipMap, /premium klantenrepository/);
  assert.match(ownershipMap, /niet de eigenaar van de statuswaarheid/);
  assert.match(ownershipMap, /server\.js/);
});

test('quality protocol routes larger customer status refactors through the central contract', () => {
  const qualityProtocolPath = path.join(repoRoot, 'docs/quality-protocol.md');
  const qualityProtocol = fs.readFileSync(qualityProtocolPath, 'utf8');

  assert.match(qualityProtocol, /docs\/customer-status-contract\.md/);
  assert.match(qualityProtocol, /premium klantenrepository als bron van waarheid/);
  assert.match(qualityProtocol, /updateCustomerStatusWithHistoryInRows/);
  assert.match(qualityProtocol, /geen nieuwe route-state/);
  assert.match(qualityProtocol, /server\.js/);
});

test('high-risk customer flows do not append customer status history directly', () => {
  const highRiskStatusFiles = [
    'server/routes/coldcalling.js',
    'server/services/agenda-post-call.js',
    'server/services/ai-dashboard.js',
    'server/services/coldcalling-lead-eligibility.js',
    'server/services/coldmail-campaign.js',
    'server/services/customers-page-bootstrap.js',
  ];

  for (const relativePath of highRiskStatusFiles) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

    assert.doesNotMatch(
      source,
      /\b(?:hist|history)\s*\.\s*push\s*\(/,
      `${relativePath} must use the premium customer repository history helper instead of direct history pushes`
    );
  }
});

test('server.js stays out of customer status helper wiring', () => {
  const serverPath = path.join(repoRoot, 'server.js');
  const source = fs.readFileSync(serverPath, 'utf8');

  assert.doesNotMatch(
    source,
    /updateCustomerStatusWithHistoryInRows/,
    'server.js must not wire customer status updates directly; use repository-backed services instead'
  );
  assert.doesNotMatch(
    source,
    /appendCustomerStatusHistory/,
    'server.js must not append customer status history directly; use the premium customer repository helper instead'
  );
});

test('premium customer repository keeps the central customer status helpers exported', () => {
  const premiumCustomersRepository = require('../../server/repositories/premium-customers-repository');

  assert.equal(typeof premiumCustomersRepository.appendCustomerStatusHistory, 'function');
  assert.equal(typeof premiumCustomersRepository.updateCustomerStatusWithHistoryInRows, 'function');
});

test('customer status contract requires updated true as the only success signal', () => {
  const contract = fs.readFileSync(contractPath, 'utf8');

  assert.match(contract, /Behandel alleen `updated === true` als een echte klantstatuswijziging/);
  assert.match(contract, /missende klantmatches/);
  assert.match(contract, /lege input/);
  assert.match(contract, /geweigerde statuswaarden/);
  assert.match(contract, /Gebruik altijd `updated === true`/);
  assert.match(contract, /persist, dashboardactiviteit of vervolgstatussen/);
});
