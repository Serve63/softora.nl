const test = require('node:test');
const assert = require('node:assert/strict');

global.SoftoraMailboxMessageProvenance = require('../../assets/premium-mailbox-message-provenance.js');
const campaignInbox = require('../../assets/premium-mailbox-campaign-inbox.js');
const mailboxList = require('../../assets/premium-mailbox-list.js');
require('../../assets/premium-mailbox-display.js');
const display = global.SoftoraMailboxDisplay;
const uiState = require('../../assets/premium-mailbox-ui-state.js');

const now = '2026-09-07T08:30:00.000Z';
const accountEmail = 'serve@softora.nl';
const formatMailDate = (value) => display.formatMailDate(value, now);

function message(id, receivedAt, extra = {}) {
  const source = {
    id: `${accountEmail}|inbox:${id}`, mailboxId: `inbox:${id}`,
    accountEmail, folder: 'inbox', email: `${id}@example.test`,
    subject: 'Re: Kleine vraag over jullie website', receivedAt,
    campaign: { account: accountEmail }, ...extra,
  };
  return { ...source, ...uiState.normalizeMessageState(source, formatMailDate(receivedAt), formatMailDate) };
}

function row(mail, nowValue = now) {
  return mailboxList.renderItem(mail, {
    escapeHtml: String,
    display: { ...display, formatMailDate: (value) => display.formatMailDate(value, nowValue) },
  });
}

function oldSent() {
  return { id: 'sent:original', folder: 'sent', accountEmail, receivedAt: '2026-09-03T12:00:00.000Z' };
}

test('partial timeline preserves the indexed sent time and sorts the reply above older conversations', () => {
  const latestOutboundAt = '2026-09-07T08:17:00.000Z';
  const replied = message('replied', '2026-09-04T07:29:00.000Z', {
    latestOutboundAt, activityAt: latestOutboundAt, threadMessages: [oldSent()],
  });
  const other = message('other', '2026-09-07T07:20:00.000Z');
  const older = message('older', '2026-09-04T14:40:00.000Z');

  for (const threadMessages of [replied.threadMessages, [...replied.threadMessages, {
    id: 'sent:reply', folder: 'sent', accountEmail, receivedAt: latestOutboundAt,
  }]]) {
    const result = campaignInbox.filterMessages([other, older, { ...replied, threadMessages }], 'serve');
    assert.deepEqual(result.map((mail) => mail.email), [replied.email, other.email, older.email]);
    assert.equal(result[0].receivedAt, replied.receivedAt);
    assert.equal(result[0].latestOutboundAt, latestOutboundAt);
    assert.equal(result[0].activityAt, latestOutboundAt);
    assert.match(row(result[0]), /datetime="2026-09-07T08:17:00.000Z"/);
    assert.match(row(result[0]), /mail-time-value">10:17</);
    assert.doesNotMatch(row(result[0]), /mail-date-label/);
  }
});

test('partial inbound history does not replace a newer indexed inbound date', () => {
  const latestInboundAt = '2026-09-07T08:20:00.000Z';
  const root = message('inbound', '2026-09-04T07:29:00.000Z', { latestInboundAt });
  const [result] = campaignInbox.filterMessages([root], 'serve');
  assert.equal(result.latestInboundAt, latestInboundAt);
  assert.equal(result.activityAt, latestInboundAt);
});

test('grouping retains sent summary evidence from another row in the same conversation', () => {
  const email = 'shared@example.test';
  const latestOutboundAt = '2026-09-07T08:17:00.000Z';
  const primary = message('new-inbound', '2026-09-07T08:20:00.000Z', { email });
  const secondary = message('old-inbound', '2026-09-04T07:29:00.000Z', {
    email, latestOutboundAt, threadMessages: [oldSent()],
  });
  const [result] = campaignInbox.filterMessages([secondary, primary], 'serve');
  assert.equal(result.latestOutboundAt, latestOutboundAt);
  assert.equal(result.activityAt, primary.receivedAt);
});

test('an indexed activity date remains valid before its individual timeline message is available', () => {
  const activityAt = '2026-09-07T08:17:00.000Z';
  const root = message('summary', '2026-09-04T07:29:00.000Z', { activityAt, threadMessages: [oldSent()] });
  const [result] = campaignInbox.filterMessages([root], 'serve');
  assert.equal(result.activityAt, activityAt);
});

test('a hydrated newer sent message updates both list position and displayed time', () => {
  const root = message('hydrated', '2026-09-04T07:29:00.000Z', {
    threadMessages: [{ id: 'sent:reply', folder: 'sent', accountEmail, receivedAt: '2026-09-07T08:17:00.000Z' }],
  });
  const [result] = campaignInbox.filterMessages([root], 'serve');
  const html = row(result);
  assert.equal(result.activityAt, '2026-09-07T08:17:00.000Z');
  assert.match(html, /datetime="2026-09-07T08:17:00.000Z"/);
  assert.match(html, /mail-time-value">10:17</);
  assert.doesNotMatch(html, /mail-date-label|09:29/);
  assert.match(row(result, '2026-09-08T08:30:00.000Z'), /mail-date-label">Gisteren</);
});

test('invalid summary dates do not displace real message dates', () => {
  const root = message('invalid', '2026-09-04T07:29:00.000Z');
  const [result] = campaignInbox.filterMessages([{
    ...root, latestInboundAt: 'invalid', latestOutboundAt: 'invalid', activityAt: 'invalid',
  }], 'serve');
  assert.equal(result.activityAt, root.receivedAt);
  assert.doesNotMatch(row(result), /Invalid Date|NaN/);
});
