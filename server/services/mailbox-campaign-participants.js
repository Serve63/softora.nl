'use strict';

const {
  getMailboxMessageDirection,
  isSameMailboxIdentity,
} = require('./mailbox-message-provenance');

const PERSONAL_MAILBOX_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mac.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'tuta.com',
  'tutamail.com',
  'yahoo.com',
  'ymail.com',
]);
const MAX_CAMPAIGN_PARTICIPANTS = 400;
const EMAIL_PATTERN = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const MESSAGE_ID_PATTERN = /<[^<>]+>/g;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function extractEmailAddresses(value) {
  return Array.from(new Set(normalizeText(value).toLowerCase().match(EMAIL_PATTERN) || []));
}

function getExternalParticipantEmails(message = {}) {
  const accountEmail = normalizeEmail(message.accountEmail);
  const candidates = getMailboxMessageDirection(message) === 'sent'
    ? extractEmailAddresses([message.to, message.cc].filter(Boolean).join(', '))
    : extractEmailAddresses(message.email || message.senderEmail);
  return candidates.filter((email) => email && !isSameMailboxIdentity(email, accountEmail));
}

function collectCampaignThreadParticipantEmails(messages = []) {
  const participants = new Set();
  (Array.isArray(messages) ? messages : []).forEach((message) => {
    getExternalParticipantEmails(message).forEach((email) => {
      if (participants.size < MAX_CAMPAIGN_PARTICIPANTS) participants.add(email);
    });
  });
  return Array.from(participants);
}

function collectCampaignThreadRecipientTerms(messages = []) {
  const terms = new Set();
  collectCampaignThreadParticipantEmails(messages).forEach((email) => {
    terms.add(email);
    const domain = email.split('@')[1] || '';
    if (domain && !PERSONAL_MAILBOX_DOMAINS.has(domain)) terms.add(domain);
  });
  return Array.from(terms);
}

function getMessageHeaderTokens(value) {
  const source = normalizeText(value);
  if (!source) return [];
  return source.match(MESSAGE_ID_PATTERN) || source.split(/[\s,]+/).filter(Boolean);
}

function collectCampaignThreadReferenceIds(messages = []) {
  const references = new Set();
  (Array.isArray(messages) ? messages : []).forEach((message) => {
    [message && message.messageId, message && message.inReplyTo, message && message.references]
      .flatMap(getMessageHeaderTokens)
      .map(normalizeText)
      .filter(Boolean)
      .forEach((value) => references.add(value));
  });
  return Array.from(references);
}

module.exports = {
  MAX_CAMPAIGN_PARTICIPANTS,
  PERSONAL_MAILBOX_DOMAINS,
  collectCampaignThreadParticipantEmails,
  collectCampaignThreadRecipientTerms,
  collectCampaignThreadReferenceIds,
  extractEmailAddresses,
  getExternalParticipantEmails,
};
