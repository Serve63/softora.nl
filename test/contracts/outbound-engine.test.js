const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createOutboundDryRunPlan,
  isLeadEligible,
  resolveInboxDailyLimit,
  validateOutboundCampaign,
} = require('../../server/services/outbound-engine');

const NOW = '2026-05-21T10:00:00.000Z';

function approvedCampaign(overrides = {}) {
  return {
    id: 'campaign-webdesign-1',
    status: 'approved',
    subject: 'Nieuw webdesign gemaakt',
    body: 'Persoonlijke intro met relevante aanleiding.',
    landingPageUrl: 'https://demo.softora-outbound.nl/acme',
    optOutUrl: 'https://demo.softora-outbound.nl/opt-out',
    ...overrides,
  };
}

function lead(id, overrides = {}) {
  return {
    id,
    email: `${id}@voorbeeld.nl`,
    companyName: `Bedrijf ${id}`,
    website: `${id}.nl`,
    relevanceReason: 'Heeft een verouderde website en past bij webdesign-aanbod.',
    ...overrides,
  };
}

test('outbound engine protects the current softora.nl safe lane', () => {
  const plan = createOutboundDryRunPlan({
    now: NOW,
    domains: [
      { id: 'softora', name: 'softora.nl', status: 'active', spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    ],
    inboxes: [
      { email: 'serve@softora.nl', domainId: 'softora', status: 'active', dailyLimit: 25 },
    ],
    campaigns: [approvedCampaign()],
    leads: [lead('lead1')],
  });

  assert.equal(plan.canSendRealMail, false);
  assert.equal(plan.jobs.length, 0);
  assert.equal(plan.summary.healthyInboxes, 0);
  assert.match(plan.blockedInboxes[0].reasons.join(','), /protected_sender_domain/);
  assert.match(plan.summary.systemReasons.join(','), /no_healthy_inboxes/);
});

test('dry-run planner spreads volume over healthy separate inboxes and never enables real sending', () => {
  const leads = Array.from({ length: 5 }, (_, index) => lead(`lead${index + 1}`));
  const plan = createOutboundDryRunPlan({
    now: NOW,
    domains: [
      { id: 'd1', name: 'softora-growth.nl', status: 'active', spf: 'pass', dkim: 'pass', dmarc: 'pass' },
      { id: 'd2', name: 'softora-studio.nl', status: 'active', spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    ],
    inboxes: [
      { email: 'serve@softora-growth.nl', domainId: 'd1', status: 'active', dailyLimit: 2 },
      { email: 'martijn@softora-studio.nl', domainId: 'd2', status: 'active', dailyLimit: 2 },
    ],
    campaigns: [approvedCampaign()],
    leads,
  });

  assert.equal(plan.summary.plannedJobs, 4);
  assert.equal(plan.jobs.every((job) => job.dryRun === true), true);
  assert.equal(plan.jobs.every((job) => job.sendAllowed === false), true);
  assert.equal(plan.jobs.filter((job) => job.senderEmail === 'serve@softora-growth.nl').length, 2);
  assert.equal(plan.jobs.filter((job) => job.senderEmail === 'martijn@softora-studio.nl').length, 2);
  assert.deepEqual([...new Set(plan.jobs.map((job) => job.senderDomain))].sort(), [
    'softora-growth.nl',
    'softora-studio.nl',
  ]);
});

test('health stop rules block risky inboxes before they can enter the queue', () => {
  const plan = createOutboundDryRunPlan({
    now: NOW,
    domains: [
      { id: 'bad', name: 'softora-scale.nl', status: 'active', spf: 'fail', dkim: 'pass', dmarc: 'pass' },
      { id: 'good', name: 'softora-demo.nl', status: 'active', spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    ],
    inboxes: [
      { email: 'sales@softora-scale.nl', domainId: 'bad', status: 'active', dailyLimit: 25 },
      { email: 'sales@softora-demo.nl', domainId: 'good', status: 'active', dailyLimit: 25 },
    ],
    health: {
      inboxes: {
        'sales@softora-scale.nl': {
          bounceRate: 0.03,
          complaintRate: 0.001,
          seedSpamPlacements: 1,
        },
      },
    },
    campaigns: [approvedCampaign()],
    leads: [lead('lead1'), lead('lead2')],
  });

  assert.equal(plan.jobs.length, 2);
  assert.equal(plan.jobs.every((job) => job.senderEmail === 'sales@softora-demo.nl'), true);
  assert.match(plan.blockedInboxes[0].reasons.join(','), /spf_failed/);
  assert.match(plan.blockedInboxes[0].reasons.join(','), /bounce_rate_high/);
  assert.match(plan.blockedInboxes[0].reasons.join(','), /seed_inbox_spam_placement/);
  assert.match(plan.blockedInboxes[0].warnings.join(','), /complaint_rate_warning/);
});

test('lead validation blocks weak data, suppressions and duplicates', () => {
  const seen = new Set();
  assert.deepEqual(isLeadEligible(lead('ok'), new Set(), seen), { ok: true, reasons: [] });
  assert.match(isLeadEligible(lead('no-reason', { relevanceReason: '' }), new Set(), seen).reasons.join(','), /relevance_reason_missing/);
  assert.match(isLeadEligible(lead('optout', { optedOut: true }), new Set(), seen).reasons.join(','), /lead_suppressed/);
  assert.match(isLeadEligible(lead('blocked'), new Set(['blocked@voorbeeld.nl']), seen).reasons.join(','), /lead_on_suppression_list/);
  assert.match(isLeadEligible(lead('ok'), new Set(), seen).reasons.join(','), /duplicate_lead/);
});

test('campaigns must be approved and include opt-out plus landing page before planning', () => {
  const invalid = validateOutboundCampaign(approvedCampaign({
    status: 'draft',
    optOutUrl: '',
    landingPageUrl: '',
    attachments: [{ name: 'mockup.png' }],
  }));

  assert.equal(invalid.ok, false);
  assert.match(invalid.reasons.join(','), /campaign_not_approved/);
  assert.match(invalid.reasons.join(','), /campaign_opt_out_missing/);
  assert.match(invalid.reasons.join(','), /campaign_landing_page_missing/);
  assert.match(invalid.reasons.join(','), /attachments_not_allowed_for_scale/);
});

test('ramp-up keeps new inboxes at conservative daily caps', () => {
  assert.deepEqual(resolveInboxDailyLimit({
    email: 'sales@softora-growth.nl',
    dailyLimit: 25,
    rampUpStartedAt: '2026-05-01T00:00:00.000Z',
  }, undefined, NOW), {
    limit: 5,
    warnings: ['ramp_up_limit_5'],
  });
});
