const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAILBOX_CAMPAIGN_SNAPSHOT_MAX_CHARS,
  parseMailboxCampaignSnapshot,
  serializeMailboxCampaignSnapshot,
} = require('../../server/services/mailbox-campaign-snapshot');

test('mailbox campaign snapshot blijft compact en opent de nieuwste mail direct', () => {
  const messages = Array.from({ length: 100 }, (_, index) => ({
    id: `inbox:${100 - index}`,
    uid: 100 - index,
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    from: `Bedrijf ${index}`,
    email: `bedrijf-${index}@example.test`,
    subject: `Reactie ${index}`,
    preview: `Preview ${index}`,
    body: `Volledige inhoud ${index} ${'x'.repeat(59_000)}`,
    date: new Date(Date.UTC(2026, 6, 22, 14, 0, 0) - index * 60_000).toISOString(),
    unread: index < 2,
    indexed: true,
    bodyImages: [{ alt: 'Ontwerp', dataUrl: `data:image/png;base64,${'a'.repeat(150_000)}` }],
    campaign: {
      company: `Bedrijf ${index}`,
      account: 'serve@softora.nl',
      customerId: `customer-${index}`,
      status: 'reactie_ontvangen',
      actionRequired: true,
    },
  }));

  const serialized = serializeMailboxCampaignSnapshot(
    { ok: true, messages, sync: { indexed: true, stale: false } },
    { savedAt: '2026-07-22T21:00:00.000Z' }
  );
  const parsed = parseMailboxCampaignSnapshot(serialized);

  assert.ok(serialized.length <= MAILBOX_CAMPAIGN_SNAPSHOT_MAX_CHARS);
  assert.equal(parsed.messages.length, 100);
  assert.match(parsed.messages[0].body, /^Volledige inhoud 0/);
  assert.equal(parsed.messages[0].campaign.company, 'Bedrijf 0');
  assert.deepEqual(parsed.messages[0].bodyImages, []);
  assert.equal(parsed.messages[0].bodyImagesTruncated, true);
  assert.equal(parsed.messages.at(-1).body, '');
  assert.equal(parsed.sync.source, 'campaign-replies-snapshot');
});

test('mailbox campaign snapshot bewaart alleen complete afbeeldingen', () => {
  const smallImage = `data:image/png;base64,${'a'.repeat(120)}`;
  const oversizedImage = `data:image/jpeg;base64,${'b'.repeat(90_000)}`;
  const serialized = serializeMailboxCampaignSnapshot({
    ok: true,
    messages: [{
      id: 'inbox:1',
      body: 'Bericht met afbeeldingen',
      bodyImages: [
        { alt: 'Klein ontwerp', dataUrl: smallImage },
        { alt: 'Grote mockup', dataUrl: oversizedImage },
      ],
    }],
  });
  const [message] = parseMailboxCampaignSnapshot(serialized).messages;

  assert.deepEqual(message.bodyImages, [{ alt: 'Klein ontwerp', dataUrl: smallImage }]);
  assert.equal(message.bodyImagesTruncated, true);
  assert.doesNotMatch(serialized, new RegExp(oversizedImage.slice(0, 80_000)));
});

test('mailbox campaign snapshot weigert lege en ongeldige data', () => {
  assert.equal(serializeMailboxCampaignSnapshot({ ok: true, messages: [] }), '');
  assert.equal(parseMailboxCampaignSnapshot('{kapot'), null);
  assert.equal(parseMailboxCampaignSnapshot(JSON.stringify({ version: 1, messages: [] })), null);
});
