const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createOutboundCockpitModel,
} = require('../../server/services/outbound-engine-cockpit');
const {
  createOutboundControlPlane,
} = require('../../server/services/outbound-engine-control-plane');
const {
  prepareOutboundLeadImport,
} = require('../../server/services/outbound-engine-import');
const {
  createOutboundOptOutRecord,
} = require('../../server/services/outbound-engine-opt-out');
const {
  createDryRunReview,
} = require('../../server/services/outbound-engine-review');

const NOW = '2026-05-21T10:00:00.000Z';

const READY_OPERATIONS = {
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

function readyControlPlane() {
  return createOutboundControlPlane({
    now: NOW,
    targetDailyVolume: 40,
    domains: [
      { id: 'd1', name: 'softora-growth.nl', status: 'active', spf: 'pass', dkim: 'pass', dmarc: 'pass' },
      { id: 'd2', name: 'softora-studio.nl', status: 'active', spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    ],
    inboxes: [
      { email: 'serve@softora-growth.nl', domainId: 'd1', status: 'active', dailyLimit: 20 },
      { email: 'martijn@softora-studio.nl', domainId: 'd2', status: 'active', dailyLimit: 20 },
    ],
    campaigns: [{
      id: 'c1',
      status: 'approved',
      subject: 'Nieuw webdesign gemaakt',
      body: 'Persoonlijk bericht.',
      landingPageUrl: 'https://softora-growth.nl/demo',
      optOutUrl: 'https://softora-growth.nl/opt-out',
    }],
    leads: [
      {
        id: 'l1',
        email: 'lead1@voorbeeld.nl',
        companyName: 'Voorbeeld 1',
        website: 'voorbeeld1.nl',
        relevanceReason: 'Website is verouderd.',
      },
      {
        id: 'l2',
        email: 'lead2@voorbeeld.nl',
        companyName: 'Voorbeeld 2',
        website: 'voorbeeld2.nl',
        relevanceReason: 'Website is verouderd.',
      },
    ],
    suppressionList: [{ email: 'blocked@voorbeeld.nl', reason: 'unsubscribe' }],
    operations: READY_OPERATIONS,
  });
}

test('lead import prepares events but never sends mail', () => {
  const result = prepareOutboundLeadImport({
    now: NOW,
    sourceName: 'bedrijvenregister',
    suppressionList: [{ email: 'stop@voorbeeld.nl', reason: 'unsubscribe' }],
    rows: [
      {
        id: 'l1',
        email: 'ok@voorbeeld.nl',
        companyName: 'Ok BV',
        website: 'ok.nl',
        relevanceReason: 'Past bij aanbod.',
      },
      {
        id: 'l2',
        email: 'stop@voorbeeld.nl',
        companyName: 'Stop BV',
        website: 'stop.nl',
        relevanceReason: 'Past bij aanbod.',
      },
      {
        id: 'l3',
        email: '',
        companyName: '',
        website: '',
        relevanceReason: '',
      },
    ],
  });

  assert.equal(result.canSendRealMail, false);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.events[0].type, 'lead_imported');
  assert.equal(result.rejected.length, 2);
  assert.match(result.rejected[0].reasons.join(','), /lead_on_suppression_list/);
  assert.match(result.rejected[1].reasons.join(','), /lead_email_missing/);
});

test('dry-run review requires every planned job to be approved by a human', () => {
  const control = readyControlPlane();
  const pending = createDryRunReview({
    now: NOW,
    reviewer: 'Serve',
    plan: control.plan,
    approvedJobIds: [control.plan.jobs[0].id],
  });
  const approved = createDryRunReview({
    now: NOW,
    reviewer: 'Serve',
    plan: control.plan,
    approvedJobIds: control.plan.jobs.map((job) => job.id),
  });

  assert.equal(pending.ok, false);
  assert.match(pending.summary.blockers.join(','), /dry_run_jobs_pending_review/);
  assert.equal(approved.ok, true);
  assert.equal(approved.canSendRealMail, false);
  assert.equal(approved.approvalEvent.type, 'operation_connected');
  assert.equal(approved.approvalEvent.payload.name, 'dryRunReviewedByHuman');
});

test('opt-out builder creates a suppression event with stable fingerprint', () => {
  const first = createOutboundOptOutRecord({
    now: NOW,
    email: 'Stop@Voorbeeld.nl',
  });
  const second = createOutboundOptOutRecord({
    now: NOW,
    email: 'stop@voorbeeld.nl',
  });

  assert.equal(first.ok, true);
  assert.equal(first.canSendRealMail, false);
  assert.equal(first.event.type, 'suppression_added');
  assert.equal(first.record.email, 'stop@voorbeeld.nl');
  assert.equal(first.record.fingerprint, second.record.fingerprint);
});

test('cockpit model exposes dashboard-ready data without live sending', () => {
  const control = readyControlPlane();
  const cockpit = createOutboundCockpitModel({
    controlPlane: control,
    state: {
      domains: control.plan.jobs.map((job) => ({ id: job.senderDomain, name: job.senderDomain, status: 'active' })),
      inboxes: [
        { email: 'serve@softora-growth.nl', domainId: 'd1', status: 'active', dailyLimit: 20 },
        { email: 'martijn@softora-studio.nl', domainId: 'd2', status: 'active', dailyLimit: 20 },
      ],
      campaigns: [{ id: 'c1', status: 'approved', subject: 'Nieuw webdesign', optOutUrl: 'https://x.nl/u', landingPageUrl: 'https://x.nl' }],
      suppressionList: [{ email: 'blocked@voorbeeld.nl', reason: 'unsubscribe' }],
    },
  });

  assert.equal(cockpit.mode, 'dry_run');
  assert.equal(cockpit.canSendRealMail, false);
  assert.equal(cockpit.status, 'ready_for_closed_pilot');
  assert.equal(cockpit.cards.some((card) => card.id === 'capacity'), true);
  assert.equal(cockpit.dryRunPreview.every((job) => job.sendAllowed === false), true);
});
