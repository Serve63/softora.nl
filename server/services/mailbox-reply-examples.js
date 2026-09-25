'use strict';

const { OUTBOUND_SENDER_IDENTITIES } = require('./outbound-sender-identity');
const {
  analyzeMailboxReplyContext,
  authoredReplyText,
  meaningfulTokens,
} = require('./mailbox-reply-policy');
const { createMailboxReplyExamplesRepository } = require('../repositories/mailbox-reply-examples');

const REPLY_EXAMPLES_CACHE_MS = 15 * 60 * 1000;
const REPLY_EXAMPLES_LIMIT = 5;
// Examples travel to the model for other customers: never pass on secrets
// and strip contact details that could identify this customer.
const SENSITIVE_EXAMPLE_PATTERN = /\b(?:wachtwoord|password|passwd|inlog(?:gegevens|code)?|login|gebruikersnaam|username|iban|pincode|verificatiecode|api[- ]?key|token)\b/i;
const GREETING_LINE_PATTERN = /^(?:beste|hoi|hallo|hey|goedendag|goedemorgen|goedemiddag|goedenavond|geachte|dag)\b[^\n]{0,60}$/i;

function getProfileAccountEmails(profileKey) {
  return Object.entries(OUTBOUND_SENDER_IDENTITIES)
    .filter(([, identity]) => identity.profileKey === profileKey)
    .map(([email]) => email);
}

function redactContactDetails(value) {
  return String(value || '')
    .replace(/[^\s<>()]+@[^\s<>()]+\.[a-z]{2,}/gi, '[e-mail]')
    .replace(/(?:https?:\/\/|www\.)[^\s<>")]+/gi, '[link]')
    .replace(/(?:\+31|0031|\b0)[\s-]?\(?\d{1,3}\)?(?:[\s-]?\d){6,9}\b/g, '[telefoon]');
}

function cleanExampleReply(value) {
  const lines = authoredReplyText(value).split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length && GREETING_LINE_PATTERN.test(lines[0].trim())) lines.shift();
  return redactContactDetails(lines.join('\n')).replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);
}

function cleanExampleInbound(value) {
  return redactContactDetails(authoredReplyText(value)).replace(/\n{3,}/g, '\n\n').trim().slice(0, 1200);
}

function similarity(leftTokens, rightTokens) {
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  leftTokens.forEach((token) => { if (rightTokens.has(token)) shared += 1; });
  return shared / Math.sqrt(leftTokens.size * rightTokens.size);
}

// Picks the sender's own earlier replies to the most comparable customer
// mails: same kind of mail first (rejection, price question, ...), then
// shared wording, then recency.
function selectMailboxReplyExamples(rows, inboundText, options = {}) {
  const limit = Math.max(1, Math.min(8, Number(options.limit) || REPLY_EXAMPLES_LIMIT));
  const target = cleanExampleInbound(inboundText);
  if (!target) return [];
  const targetTokens = new Set(meaningfulTokens(target));
  const targetIntent = analyzeMailboxReplyContext(target).intent;
  const seenInbound = new Set();
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const klantMail = cleanExampleInbound(row && row.inbound_body);
      const mijnAntwoord = cleanExampleReply(row && row.reply_body);
      return { klantMail, mijnAntwoord, index };
    })
    .filter((example) => example.klantMail && example.mijnAntwoord)
    .filter((example) => !SENSITIVE_EXAMPLE_PATTERN.test(`${example.klantMail}\n${example.mijnAntwoord}`))
    .filter((example) => example.klantMail !== target)
    .filter((example) => {
      if (seenInbound.has(example.klantMail)) return false;
      seenInbound.add(example.klantMail);
      return true;
    })
    .map((example) => ({
      ...example,
      score: (analyzeMailboxReplyContext(example.klantMail).intent === targetIntent ? 1 : 0) +
        similarity(targetTokens, new Set(meaningfulTokens(example.klantMail))) -
        example.index * 0.0005,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ klantMail, mijnAntwoord }) => ({ klantMail, mijnAntwoord }));
}

function createMailboxReplyExamples(deps = {}) {
  const {
    repository = createMailboxReplyExamplesRepository(deps),
    logger = console,
    now = () => Date.now(),
    cacheMs = REPLY_EXAMPLES_CACHE_MS,
  } = deps;
  const cache = new Map();

  function loadRows(profileKey) {
    const cached = cache.get(profileKey);
    if (cached && now() - cached.at < cacheMs) return cached.rows;
    const rows = Promise.resolve()
      .then(() => repository.listReplyExamples({ accountEmails: getProfileAccountEmails(profileKey) }))
      .catch((error) => {
        cache.delete(profileKey);
        logger.error?.('[Mailbox][ReplyExamples]', error?.message || error);
        return [];
      });
    cache.set(profileKey, { at: now(), rows });
    return rows;
  }

  // Never blocks a suggestion: without examples the prompt still works.
  async function findReplyExamples({ profileKey, inboundText, limit } = {}) {
    if (!profileKey || !getProfileAccountEmails(profileKey).length) return [];
    return selectMailboxReplyExamples(await loadRows(profileKey), inboundText, { limit });
  }

  return { findReplyExamples };
}

module.exports = {
  REPLY_EXAMPLES_CACHE_MS,
  createMailboxReplyExamples,
  selectMailboxReplyExamples,
};
