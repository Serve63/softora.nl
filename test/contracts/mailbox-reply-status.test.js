const test = require('node:test');
const assert = require('node:assert/strict');

global.SoftoraMailboxMessageProvenance = require('../../assets/premium-mailbox-message-provenance');
const campaignInbox = require('../../assets/premium-mailbox-campaign-inbox');
global.SoftoraMailboxCampaignInbox = campaignInbox;
const list = require('../../assets/premium-mailbox-list');
const uiState = require('../../assets/premium-mailbox-ui-state');

const listOptions = { escapeHtml: String, display: { getListPrimaryText: () => 'Contact' } };
const incomingAt = '2026-09-03T07:35:54.000Z';
const answeredAt = '2026-09-03T10:12:08.000Z';
function conversation(extra = {}) {
  return { id: 'inbox:reply-status', accountEmail: 'serve@softora.nl', email: 'contact@example.test',
    folder: 'inbox', receivedAt: incomingAt, latestInboundAt: incomingAt,
    latestOutboundAt: answeredAt, threadMessages: [], ...extra };
}

function assertNeedsReply(mail, expected) {
  assert.equal(/mail-reply-corner/.test(list.renderItem(mail, listOptions)), expected);
  assert.equal(uiState.getReadState(mail, campaignInbox).replyHandled, !expected);
}

test('antwoordstatus gebruikt de bekende verzendtijd voordat het verzonden detailbericht is geladen', () => {
  const partial = conversation();
  const original = structuredClone(partial);
  assertNeedsReply(partial, false);
  assert.deepEqual(partial, original);
  // A status summary must not invent a sent message or change the reply target.
  assert.equal(campaignInbox.getConversationAction(partial).kind, 'reply');
  assert.equal(campaignInbox.getConversationAction(partial).message.id, partial.id);
});

test('antwoordstatus blijft gelijk bij metadata en volledige hydratatie van hetzelfde antwoord', () => {
  for (const body of ['', 'Bedankt voor je reactie.']) {
    assertNeedsReply(conversation({ threadMessages: [{ id: 'sent:reply-status', folder: 'sent',
      accountEmail: 'serve@softora.nl', date: answeredAt, body }] }), false);
  }
});

test('een later ontvangen antwoord blijft aandacht vragen ondanks een oudere verzendsamenvatting', () => {
  const newerAt = '2026-09-04T08:00:00.000Z';
  assertNeedsReply(conversation({ latestInboundAt: newerAt }), true);
  assertNeedsReply(conversation({ receivedAt: newerAt }), true);
  assertNeedsReply(conversation({ threadMessages: [{ id: 'inbox:follow-up', folder: 'inbox',
    accountEmail: 'serve@softora.nl', date: newerAt }] }), true);
});

test('ontbrekende ongeldige of gelijke verzendtijden verbergen geen openstaande reactie', () => {
  for (const latestOutboundAt of ['', 'not-a-date', incomingAt, '2026-09-02T08:00:00.000Z']) {
    assertNeedsReply(conversation({ latestOutboundAt }), true);
  }
});

test('antwoordstatus blijft per mailbox en respecteert expliciet afhandelen', () => {
  assertNeedsReply(conversation(), false);
  assertNeedsReply(conversation({ accountEmail: 'martijn@softora.nl', latestOutboundAt: '' }), true);
  assertNeedsReply(conversation({ latestOutboundAt: '', replyDismissedAt: answeredAt }), false);
});
