const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateOutboundCampaignInput,
  validateOutboundDomainInput,
  validateOutboundEventInput,
  validateOutboundInboxInput,
  validateOutboundLeadInput,
  validateOutboundSuppressionInput,
} = require('../../server/schemas/outbound-engine');

test('outbound schemas reject protected softora.nl domains and inboxes', () => {
  const domain = validateOutboundDomainInput({ name: 'https://www.softora.nl/path', spf: 'pass' });
  const inbox = validateOutboundInboxInput({ email: 'serve@softora.nl', dailyLimit: 99 });

  assert.equal(domain.ok, false);
  assert.match(domain.errors.join(','), /protected_domain_not_allowed/);
  assert.equal(inbox.ok, false);
  assert.match(inbox.errors.join(','), /protected_sender_domain/);
  assert.equal(inbox.value.dailyLimit, 25);
});

test('outbound campaign validator requires approved-scale safety fields', () => {
  const result = validateOutboundCampaignInput({
    id: 'c1',
    status: 'approved',
    subject: '  Nieuw webdesign  ',
    body: '  Persoonlijk bericht  ',
    attachments: [{ name: 'mockup.png' }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.value.subject, 'Nieuw webdesign');
  assert.match(result.errors.join(','), /campaign_opt_out_missing/);
  assert.match(result.errors.join(','), /campaign_landing_page_missing/);
  assert.match(result.errors.join(','), /attachments_not_allowed_for_approved_scale_campaign/);
});

test('outbound lead and suppression validators normalize safe values', () => {
  const lead = validateOutboundLeadInput({
    email: ' Lead@Voorbeeld.nl ',
    companyName: ' Voorbeeld BV ',
    website: 'https://www.voorbeeld.nl/demo',
    relevanceReason: ' Past bij aanbod. ',
  });
  const suppression = validateOutboundSuppressionInput({
    email: ' Stop@Voorbeeld.nl ',
    reason: 'unsubscribe',
  });

  assert.equal(lead.ok, true);
  assert.equal(lead.value.email, 'lead@voorbeeld.nl');
  assert.equal(lead.value.website, 'voorbeeld.nl');
  assert.equal(suppression.ok, true);
  assert.equal(suppression.value.email, 'stop@voorbeeld.nl');
  assert.equal(suppression.value.reason, 'unsubscribe');
});

test('outbound event validator blocks live sending requests', () => {
  const result = validateOutboundEventInput({
    body: {
      type: 'mail_send_requested',
      payload: { id: 'danger' },
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(','), /live_sending_event_not_allowed/);
});
