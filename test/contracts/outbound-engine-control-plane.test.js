const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createOutboundControlPlane,
  createOutboundRampForecast,
  summarizeSuppressionList,
} = require('../../server/services/outbound-engine-control-plane');

const NOW = '2026-05-21T10:00:00.000Z';

const ALL_OPERATIONS_READY = {
  centralSuppressionListConnected: true,
  bounceProcessorConnected: true,
  replyProcessorConnected: true,
  optOutEndpointConnected: true,
  seedInboxChecksConnected: true,
  dmarcReportsConnected: true,
  providerPostmasterConnected: true,
  legalReviewApproved: true,
  dryRunReviewedByHuman: true,
};

function domain(id, name) {
  return { id, name, status: 'active', spf: 'pass', dkim: 'pass', dmarc: 'pass' };
}

function inbox(email, domainId, overrides = {}) {
  return { email, domainId, status: 'active', dailyLimit: 20, ...overrides };
}

function campaign(overrides = {}) {
  return {
    id: 'campaign-1',
    status: 'approved',
    subject: 'Nieuw webdesign gemaakt',
    body: 'Persoonlijk bericht met relevante aanleiding.',
    landingPageUrl: 'https://softora-growth.nl/demo/acme',
    optOutUrl: 'https://softora-growth.nl/opt-out',
    ...overrides,
  };
}

function lead(id, overrides = {}) {
  return {
    id,
    email: `${id}@voorbeeld.nl`,
    companyName: `Bedrijf ${id}`,
    website: `${id}.nl`,
    relevanceReason: 'Past bij het webdesign-aanbod.',
    ...overrides,
  };
}

test('control plane starts as dry-run only and points out missing safety operations', () => {
  const result = createOutboundControlPlane({
    now: NOW,
    domains: [domain('d1', 'softora-growth.nl')],
    inboxes: [inbox('serve@softora-growth.nl', 'd1')],
    campaigns: [campaign()],
    leads: [lead('lead1')],
    suppressionList: [],
  });

  assert.equal(result.mode, 'dry_run');
  assert.equal(result.canSendRealMail, false);
  assert.equal(result.sendTransportImplemented, false);
  assert.equal(result.dashboard.status, 'draft');
  assert.match(result.readiness.blockers.join(','), /central_suppression_not_connected/);
  assert.match(result.readiness.blockers.join(','), /bounce_processor_not_connected/);
  assert.match(result.dashboard.nextActions.join(' '), /centrale suppressielijst/);
});

test('ready control plane can start closed pilot but still cannot send real mail', () => {
  const result = createOutboundControlPlane({
    now: NOW,
    targetDailyVolume: 40,
    domains: [
      domain('d1', 'softora-growth.nl'),
      domain('d2', 'softora-studio.nl'),
    ],
    inboxes: [
      inbox('serve@softora-growth.nl', 'd1'),
      inbox('martijn@softora-studio.nl', 'd2'),
    ],
    campaigns: [campaign()],
    leads: [lead('lead1'), lead('lead2'), lead('lead3')],
    suppressionList: [{ email: 'blocked@voorbeeld.nl', reason: 'unsubscribe' }],
    operations: ALL_OPERATIONS_READY,
  });

  assert.equal(result.ok, true);
  assert.equal(result.dashboard.status, 'ready_for_closed_pilot');
  assert.equal(result.readiness.pilotReady, true);
  assert.equal(result.canSendRealMail, false);
  assert.deepEqual(result.readiness.liveSendingBlockers, [
    'send_transport_not_implemented',
    'manual_production_approval_required',
  ]);
  assert.equal(result.plan.jobs.length, 3);
});

test('emergency pause overrides otherwise ready outbound setup', () => {
  const result = createOutboundControlPlane({
    now: NOW,
    domains: [domain('d1', 'softora-growth.nl')],
    inboxes: [inbox('serve@softora-growth.nl', 'd1')],
    campaigns: [campaign()],
    leads: [lead('lead1')],
    suppressionList: [{ email: 'blocked@voorbeeld.nl', reason: 'unsubscribe' }],
    operations: ALL_OPERATIONS_READY,
    emergencyPause: { active: true, reason: 'seed inbox spam' },
  });

  assert.equal(result.ok, false);
  assert.equal(result.dashboard.status, 'paused');
  assert.match(result.dashboard.headline, /Noodpauze/);
  assert.match(result.readiness.blockers.join(','), /emergency_pause_active/);
  assert.match(result.dashboard.nextActions.join(' '), /noodpauze/i);
});

test('ramp forecast shows how many inboxes are needed for the 500/day target', () => {
  const forecast = createOutboundRampForecast({
    targetDailyVolume: 500,
    inboxCount: 12,
    maxDailyPerInbox: 25,
  });

  assert.equal(forecast.requiredInboxes, 56);
  assert.equal(forecast.missingInboxes, 44);
  assert.equal(forecast.currentDailyCapacity, 108);
  assert.equal(forecast.phases.find((phase) => phase.label === 'Week 6-8').estimatedDailyVolume, 108);
});

test('suppression summary counts only active entries by reason', () => {
  assert.deepEqual(summarizeSuppressionList([
    'persoon@voorbeeld.nl',
    { email: 'bounce@voorbeeld.nl', reason: 'bounce' },
    { domain: 'blocked.nl', type: 'unsubscribe' },
    { email: 'inactive@voorbeeld.nl', reason: 'manual', active: false },
  ]), {
    activeEntries: 3,
    byReason: {
      manual: 1,
      bounce: 1,
      unsubscribe: 1,
    },
  });
});
