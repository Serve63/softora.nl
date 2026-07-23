const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../../server/config/coldmail-campaign');

test('coldmail campaign config keeps the safe nine-per-mailbox and 81-per-package pacing', () => {
  assert.equal(config.DEFAULT_COLDMAIL_DAILY_SEND_LIMIT, 9);
  assert.equal(config.DEFAULT_COLDMAIL_PERSONAL_MAILBOX_DAILY_LIMIT, 9);
  assert.equal(config.DEFAULT_COLDMAIL_PACKAGE_DAILY_SEND_LIMIT, 81);
  assert.equal(config.DEFAULT_COLDMAIL_AUTOPILOT_DAILY_TARGET_MINIMUM, 81);
  assert.equal(config.DEFAULT_COLDMAIL_AUTOPILOT_BATCH_SIZE, 1);
  assert.equal(config.DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE, 'Europe/Amsterdam');
  assert.equal(config.DEFAULT_COLDMAIL_AUTOPILOT_START_HOUR, 7);
  assert.equal(config.DEFAULT_COLDMAIL_AUTOPILOT_END_HOUR, 17);
  assert.equal(config.DEFAULT_COLDMAIL_AUTOPILOT_SENDER_MIN_INTERVAL_MINUTES, 60);
  assert.equal(config.DEFAULT_COLDMAIL_AUTOPILOT_SENDER_MAX_INTERVAL_MINUTES, 74);
});

test('coldmail campaign config keeps sender identities aligned across every safety list', () => {
  const allowedSenders = [...config.COLDMAIL_AUTOPILOT_ALLOWED_SENDER_EMAILS].sort();
  const profileSenders = Object.keys(config.DEFAULT_COLDMAIL_SENDER_PROFILES).sort();
  const leadRecipients = [...config.COLDMAIL_WEBDESIGN_LEAD_RECIPIENT_EMAILS].sort();
  const blockedPrivateCopySenders = [...config.COLDMAIL_PRIVATE_COPY_BLOCKED_SENDERS].sort();

  assert.equal(config.COLDMAIL_AUTOPILOT_MAX_SENDER_EMAILS, 12);
  assert.equal(allowedSenders.length, 9);
  assert.deepEqual(profileSenders, allowedSenders);
  assert.deepEqual(leadRecipients, allowedSenders);
  assert.deepEqual(blockedPrivateCopySenders, allowedSenders);
});

test('coldmail campaign service loads static policy from the dedicated config module', () => {
  const serviceSource = fs.readFileSync(
    path.resolve(__dirname, '../../server/services/coldmail-campaign.js'),
    'utf8'
  );

  assert.match(serviceSource, /require\('\.\.\/config\/coldmail-campaign'\)/);
  assert.doesNotMatch(serviceSource, /const DEFAULT_COLDMAIL_DAILY_SEND_LIMIT\s*=/);
  assert.doesNotMatch(serviceSource, /const DEFAULT_COLDMAIL_SENDER_PROFILES\s*=/);
});
