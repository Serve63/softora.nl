const test = require('node:test');
const assert = require('node:assert/strict');

const campaignInbox = require('../../assets/premium-mailbox-campaign-inbox.js');
const compose = require('../../assets/premium-mailbox-compose.js');

test('Instantly rows are filtered only by server-proven owner, never by display name or guessed account', () => {
  const messages = [
    {
      id: 'serve',
      provider: 'instantly',
      providerOwner: 'serve',
      accountEmail: 'connected-serve@example.com',
      conversationId: 'serve-thread',
      receivedAt: '2026-07-25T11:00:00.000Z',
    },
    {
      id: 'martijn',
      provider: 'instantly',
      providerOwner: 'martijn',
      accountEmail: 'connected-martijn@example.com',
      conversationId: 'martijn-thread',
      receivedAt: '2026-07-25T11:01:00.000Z',
    },
    {
      id: 'guessed',
      provider: 'instantly',
      providerOwner: '',
      accountEmail: 'unknown@example.com',
      from: 'Servé Creusen',
      conversationId: 'unknown-thread',
      receivedAt: '2026-07-25T11:02:00.000Z',
    },
  ];
  assert.deepEqual(
    campaignInbox.filterMessages(messages, 'serve').map((message) => message.id),
    ['serve']
  );
  assert.deepEqual(
    campaignInbox.filterMessages(messages, 'martijn').map((message) => message.id),
    ['martijn']
  );
});

test('campaign loader requests only the currently selected owner and asks for safe polling', async () => {
  campaignInbox.setOwner('martijn');
  let requestedUrl = '';
  const result = await campaignInbox.load(
    'outreach',
    (message) => message,
    async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        async json() {
          return { ok: true, messages: [], sync: {} };
        },
      };
    },
    { skipBootstrap: true }
  );
  const url = new URL(requestedUrl, 'https://www.softora.nl');
  assert.equal(url.pathname, '/api/mailbox/campaign-replies');
  assert.equal(url.searchParams.get('owner'), 'martijn');
  assert.equal(url.searchParams.get('refreshInstantly'), '1');
  assert.deepEqual(result.messages, []);
  campaignInbox.setOwner('serve');
});

test('reply and new-message contexts retain exact Instantly provenance for safe sending', () => {
  const mail = {
    id: 'thread',
    provider: 'instantly',
    providerMessageId: 'email-1',
    providerThreadId: 'thread-1',
    providerOwner: 'serve',
    accountEmail: 'connected-serve@example.com',
    email: 'prospect@example.org',
    subject: 'Re: Website',
    folder: 'inbox',
    threadMessages: [],
  };
  const reply = compose.buildReplyContext(mail, {
    activeFolder: 'outreach',
    getAccount: (message) => message.accountEmail,
  });
  assert.equal(reply.provider, 'instantly');
  assert.equal(reply.providerMessageId, 'email-1');
  assert.equal(reply.providerThreadId, 'thread-1');
  assert.equal(reply.providerOwner, 'serve');

  const newMessage = compose.buildNewMessageContext(mail, {
    latestMessage: {
      ...mail,
      folder: 'sent',
      to: 'prospect@example.org',
    },
  });
  assert.equal(newMessage.provider, 'instantly');
  assert.equal(newMessage.providerOwner, 'serve');
  assert.equal(newMessage.to, 'prospect@example.org');
});

test('Instantly provider rows use their durable provider folder for local-only hide/read operations', () => {
  assert.equal(campaignInbox.getFolder({
    provider: 'instantly',
    folder: 'inbox',
    storageFolder: 'instantly',
  }, 'outreach'), 'instantly');
});

test('opened Instantly conversation shows the exact connected sender account and provider', () => {
  assert.equal(campaignInbox.renderDetailAccount({
    campaign: { provider: 'instantly' },
    provider: 'instantly',
    accountEmail: 'connected-serve@example.com',
  }, String), '<div class="detail-campaign-account">connected-serve@example.com · Instantly</div>');
});
