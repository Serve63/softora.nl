'use strict';

const { OUTBOUND_SENDER_PROFILE_KEYS } = require('./outbound-sender-identity');

const SENDER_FIELDS = Object.freeze([
  'instantlySenderEmail', 'instantly_sender_email', 'instantlyActualSenderEmail',
  'instantly_actual_sender_email', 'lastColdmailSenderEmail', 'senderEmail',
  'sender_email', 'sentFromEmail', 'sent_from_email', 'outreachSentFromEmail',
  'outreach_sent_from_email', 'replyMailboxAccount', 'lastColdmailReplyMailboxAccount',
  'mailboxAccount', 'accountEmail', 'account_email', 'fromEmail', 'mailFrom',
  'mail_from', 'instantlySenderProfileKey', 'instantly_sender_profile_key',
  'instantlySenderProfile', 'instantly_sender_profile', 'senderProfileKey',
  'senderKey', 'profileKey', 'senderDisplayName', 'senderName', 'fromName',
]);
const OWNER_FIELDS = Object.freeze([
  'leadOwnerKey', 'ownerKey', 'assignedOwnerKey', 'leadOwnerEmail', 'ownerEmail',
  'responsibleEmail', 'leadOwnerFullName', 'leadOwnerName', 'ownerFullName',
  'ownerName', 'responsible', 'verantwoordelijk', 'claimedBy', 'assignedTo',
]);
const NESTED_FIELDS = Object.freeze([
  'payload', 'legacyMeta', 'legacy_meta', 'sender', 'senderProfile', 'profile',
  'leadOwner', 'owner', 'responsibleUser', 'assignedUser',
]);
const EMAIL_ALIASES = Object.freeze({
  ...OUTBOUND_SENDER_PROFILE_KEYS,
  'serve@websoftora.com': 'serve', 'servecreusen@websoftora.com': 'serve',
  'martijn@websoftora.com': 'martijn', 'martijnven@websoftora.com': 'martijn',
  'martijnvandeven@websoftora.com': 'martijn',
});

function ownerFromValue(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (EMAIL_ALIASES[raw]) return EMAIL_ALIASES[raw];
  const name = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (/^(serve|serve creusen)$/.test(name)) return 'serve';
  if (/^(martijn|martijn van de ven)$/.test(name)) return 'martijn';
  return '';
}

function resolveInstantlyDesignOwner(row, photo) {
  const assignedValues = [row, photo].flatMap((source) => [
    source && source.designOwnerEmail,
    source && source.legacyMeta && source.legacyMeta.designOwnerEmail,
    source && source.legacy_meta && source.legacy_meta.designOwnerEmail,
  ]).map((value) => String(value || '').trim()).filter(Boolean);
  const assignedOwners = new Set(assignedValues.map(ownerFromValue));
  if (assignedValues.length && (assignedOwners.has('') || assignedOwners.size !== 1)) {
    return { owner: '', reason: 'conflicting_sender' };
  }
  const senderSignals = new Set();
  const ownerSignals = new Set();
  const seen = new Set();
  let unknownSender = false;
  const visit = (source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source) || seen.has(source)) return;
    seen.add(source);
    for (const field of SENDER_FIELDS) {
      const value = String(source[field] || '').trim();
      if (!value) continue;
      const owner = ownerFromValue(value);
      if (owner) senderSignals.add(owner);
      else unknownSender = true;
    }
    for (const field of OWNER_FIELDS) {
      const owner = ownerFromValue(source[field]);
      if (owner) ownerSignals.add(owner);
    }
    for (const field of NESTED_FIELDS) visit(source[field]);
  };
  visit(row);
  visit(photo);
  if (assignedValues.length) {
    const assignedOwner = [...assignedOwners][0];
    if (unknownSender || [...senderSignals].some((owner) => owner !== assignedOwner)) {
      return { owner: '', reason: 'conflicting_sender' };
    }
    return { owner: assignedOwner, reason: '' };
  }
  const signals = new Set([...senderSignals, ...ownerSignals]);
  if (signals.size > 1) return { owner: '', reason: 'conflicting_sender' };
  if (unknownSender) return { owner: '', reason: 'unrecognized_sender' };
  if (signals.size !== 1) return { owner: '', reason: 'missing_sender' };
  return { owner: [...signals][0], reason: '' };
}

module.exports = { resolveInstantlyDesignOwner };
