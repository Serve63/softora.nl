const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyOutboundEvent,
  createOutboundEngineState,
  reduceOutboundEvents,
} = require('../../server/services/outbound-engine-state');

const NOW = '2026-05-21T10:00:00.000Z';

test('outbound state is dry-run by default and cannot enable live sending', () => {
  const state = createOutboundEngineState({ liveSendingEnabled: true });

  assert.equal(state.mode, 'dry_run');
  assert.equal(state.liveSendingEnabled, false);
  assert.deepEqual(state.domains, []);
  assert.deepEqual(state.inboxes, []);
});

test('events register domains, inboxes, campaigns, leads and audit entries', () => {
  const state = reduceOutboundEvents([
    {
      type: 'domain_registered',
      createdAt: NOW,
      payload: { id: 'd1', name: 'Softora-Growth.nl', status: 'active', spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    },
    {
      type: 'inbox_registered',
      createdAt: NOW,
      payload: { email: 'Serve@Softora-Growth.nl', domainId: 'd1', status: 'active', dailyLimit: 80 },
    },
    {
      type: 'campaign_saved',
      createdAt: NOW,
      payload: {
        id: 'c1',
        status: 'approved',
        subject: 'Nieuw webdesign',
        body: 'Persoonlijke intro.',
        landingPageUrl: 'https://softora-growth.nl/demo',
        optOutUrl: 'https://softora-growth.nl/opt-out',
      },
    },
    {
      type: 'lead_imported',
      createdAt: NOW,
      payload: {
        id: 'l1',
        email: 'Lead@Voorbeeld.nl',
        companyName: 'Voorbeeld BV',
        website: 'voorbeeld.nl',
        relevanceReason: 'Website is verouderd.',
      },
    },
  ]);

  assert.equal(state.domains[0].name, 'softora-growth.nl');
  assert.equal(state.inboxes[0].email, 'serve@softora-growth.nl');
  assert.equal(state.inboxes[0].dailyLimit, 9);
  assert.equal(state.campaigns[0].status, 'approved');
  assert.equal(state.leads[0].email, 'lead@voorbeeld.nl');
  assert.equal(state.auditLog.length, 4);
  assert.equal(state.liveSendingEnabled, false);
});

test('suppression and health events are stored centrally', () => {
  let result = applyOutboundEvent(createOutboundEngineState(), {
    type: 'suppression_added',
    createdAt: NOW,
    payload: { email: 'Stop@Voorbeeld.nl', reason: 'unsubscribe' },
  });
  result = applyOutboundEvent(result.state, {
    type: 'health_metric_recorded',
    createdAt: NOW,
    payload: {
      scope: 'inbox',
      email: 'serve@softora-growth.nl',
      metrics: { bounceRate: 0.012, complaintRate: 0 },
    },
  });

  assert.deepEqual(result.state.suppressionList[0], {
    email: 'stop@voorbeeld.nl',
    domain: undefined,
    leadId: undefined,
    reason: 'unsubscribe',
    active: true,
    createdAt: null,
  });
  assert.equal(result.state.health.inboxes['serve@softora-growth.nl'].bounceRate, 0.012);
});

test('emergency pause and operation connection events update readiness inputs', () => {
  let result = applyOutboundEvent(createOutboundEngineState(), {
    type: 'operation_connected',
    createdAt: NOW,
    payload: { name: 'bounceProcessorConnected', connected: true },
  });
  result = applyOutboundEvent(result.state, {
    type: 'emergency_pause_changed',
    createdAt: NOW,
    payload: { active: true, reason: 'Provider warning' },
  });

  assert.equal(result.state.operations.bounceProcessorConnected, true);
  assert.deepEqual(result.state.emergencyPause, {
    active: true,
    reason: 'Provider warning',
  });
});

test('live sending event types are rejected and audited', () => {
  const result = applyOutboundEvent(createOutboundEngineState(), {
    type: 'mail_send_requested',
    createdAt: NOW,
    payload: { id: 'danger' },
  });

  assert.equal(result.state.liveSendingEnabled, false);
  assert.equal(result.auditEntry.accepted, false);
  assert.equal(result.auditEntry.reason, 'live_sending_event_not_supported');
  assert.equal(result.auditEntry.originalType, 'mail_send_requested');
});
