const { createMailAnalyticsRepository } = require('../repositories/mail-analytics');
const { resolveColdmailGuardSentAt } = require('./coldmail-guard-sent-at');
const { getMailboxMessageDirection, normalizeMailboxIdentity } = require('./mailbox-message-provenance');
const { summarizeMailboxBounceStats } = require('./coldmail-bounce-stats');
const { isAutomatedCampaignReply } = require('./mailbox-automated-reply');
const email = value => String(value || '').trim().toLowerCase();
const time = value => Date.parse(value) || 0;
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });
const day = value => dayFormatter.format(new Date(value));
const emails = value => (String(value || '').match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/ig) || []).map(email);
const refs = value => String(value || '').toLowerCase().match(/<[^>]+>|[^\s,]+/g) || [];
const refKey = value => email(value).replace(/^<|>$/g, '');

function parseAnalyticsFilters(query = {}, now = Date.now()) {
  const days = Number(query.days || 30);
  const provider = email(query.provider || 'all');
  const account = email(query.account);
  if (![7, 30, 90].includes(days) || !['all', 'softora', 'instantly'].includes(provider) || (account && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account))) {
    throw Object.assign(new Error('Kies een geldige periode, kanaal en mailbox.'), { status: 400 });
  }
  // Calendar days in Amsterdam, including today. Wide UTC read, exact local-day filter below.
  const from = new Date(now - days * 86400000).toISOString();
  const todayNoon = Date.parse(`${day(now)}T12:00:00Z`);
  const startDate = new Date(todayNoon - (days - 1) * 86400000).toISOString().slice(0, 10);
  return { days, provider, account, from, until: new Date(now).toISOString(), startDate };
}

function summarizeMailAnalytics({ guards = [], messages = [], bounceMessages = [] }, filters) {
  const acquired = new Map();
  const normalized = messages.map(m => ({ ...m.payload, ...m, accountEmail: m.account_email, email: m.sender_email, to: m.recipients_text, date: m.date || m.internal_date, body: '', messageId: m.message_id }));
  const inPeriod = date => time(date) && time(date) <= time(filters.until) && day(date) >= filters.startDate;
  for (const guard of guards) {
    // Mailbox-ledger guards can also represent ordinary client correspondence; never call them acquisition.
    if (guard.status !== 'sent' || guard.key_type !== 'email' || guard.channel !== 'coldmail' || guard.provider !== 'softora') continue;
    if (!/^(?:(?:softora-)?coldmail|instantly)/.test(guard.source || '') || /invalid|test|warmup/.test(guard.source || '') || guard.payload?.sentStatsExcluded === true) continue;
    const recipient = email(guard.recipient_email), sender = email(guard.sender_email);
    const at = resolveColdmailGuardSentAt(guard);
    if (!recipient || !sender || !time(at)) continue;
    const key = `${guard.provider}|${sender}|${recipient}`;
    const previous = acquired.get(key);
    if (!previous || time(at) < time(previous.at)) acquired.set(key, { key, provider: guard.provider, account: sender, recipient, at, guard });
  }
  // Legacy Instantly guards can mean uploaded rather than sent. Use actual provider campaign messages instead.
  for (const message of normalized) {
    if (message.folder !== 'instantly' || message.originalCampaignOutbound !== true || getMailboxMessageDirection(message) !== 'sent' || !time(message.date)) continue;
    const account = email(message.email || message.providerAccountEmail);
    if (!account) continue;
    for (const recipient of emails(message.to)) {
      const key = `instantly|${account}|${recipient}`, previous = acquired.get(key);
      if (!previous || time(message.date) < time(previous.at)) acquired.set(key, { key, provider:'instantly', account, recipient, at:message.date });
    }
  }
  const allContacts = [...acquired.values()];
  const byRecipient = new Map();
  for (const c of allContacts) { if (!byRecipient.has(c.recipient)) byRecipient.set(c.recipient, []); byRecipient.get(c.recipient).push(c); }
  const contacts = allContacts.filter(c => inPeriod(c.at) && (filters.provider === 'all' || filters.provider === c.provider) && (!filters.account || filters.account === c.account));
  const selected = new Set(contacts.map(c => c.key));
  const groups = new Map(), days = new Map(), outbound = new Map(), duplicates = new Set();
  const rowFor = c => {
    const key = `${c.provider}|${c.account}`;
    if (!groups.has(key)) groups.set(key, { provider: c.provider, account: c.account, contacts: new Set(), sends: new Set(), replies: new Set(), automatic: new Set(), fallback: new Set() });
    return groups.get(key);
  };
  const dayFor = at => { const key = day(at); if (!days.has(key)) days.set(key, { date: key, sent: 0, replies: 0 }); return days.get(key); };
  for (const c of contacts) rowFor(c).contacts.add(c.recipient);
  const outgoing = normalized.filter(m => getMailboxMessageDirection(m) === 'sent');
  for (const m of outgoing) {
    const recipientEmails = emails(m.to);
    const candidates = [...new Set(recipientEmails.flatMap(recipient => byRecipient.get(recipient) || []))].filter(c => (m.folder !== 'instantly' || c.provider === 'instantly') && normalizeMailboxIdentity(c.account) === normalizeMailboxIdentity(m.email) && time(m.date) >= time(c.at) - 300000);
    // A provider copy and an IMAP copy of the same RFC message share one event.
    const id = refKey(m.messageId) || `${m.payload?.provider || ''}:${m.provider_id || m.message_key}`;
    if (!id) continue;
    for (const candidate of candidates) {
      const providerThread = candidate.provider === 'instantly' && m.providerThreadId ? `thread:instantly:${m.providerThreadId}` : '';
      for (const reference of [m.messageId, m.provider_id, providerThread]) {
        if (!reference) continue;
        const key = refKey(reference); if (!outbound.has(key)) outbound.set(key, new Map()); outbound.get(key).set(candidate.key, candidate);
      }
      if (!selected.has(candidate.key) || !inPeriod(m.date)) continue;
      // Manual answers to customers are correspondence, not campaign follow-ups.
      if (m.softoraSendMode === 'reply' || m.payload?.softoraSendMode === 'reply') continue;
      const campaignEvidence = m.originalCampaignOutbound === true || Math.abs(time(m.date) - time(candidate.at)) <= 300000;
      if (!campaignEvidence) continue;
      const row = rowFor(candidate), eventKey = `${candidate.provider}|${candidate.account}|${id}`;
      if (!row.sends.has(eventKey)) { row.sends.add(eventKey); dayFor(m.date).sent += 1; }
      if (Math.abs(time(m.date) - time(candidate.at)) <= 300000) candidate.hasMessage = true;
    }
  }
  // The guard proves at least one send; it cannot reconstruct missing follow-ups.
  for (const c of contacts) if (!c.hasMessage) { const row = rowFor(c); row.sends.add(`guard:${c.key}`); row.fallback.add(c.key); dayFor(c.at).sent += 1; }
  for (const m of normalized) {
    if (getMailboxMessageDirection(m) === 'sent' || !inPeriod(m.date)) continue;
    const id = refKey(m.messageId) || m.provider_id || m.message_key;
    if (!id || duplicates.has(id)) continue;
    const matches = new Map();
    const messageRefs = refs([m.in_reply_to, m.references_text].filter(Boolean).join(' '));
    if (m.folder === 'instantly' && m.providerThreadId) messageRefs.push(`thread:instantly:${m.providerThreadId}`);
    for (const reference of messageRefs) {
      for (const [key, c] of outbound.get(refKey(reference)) || []) {
        if (email(m.email) === c.recipient && time(m.date) >= time(c.at) && selected.has(key)) matches.set(key, c);
      }
    }
    // Ambiguous or unlinked inbox mail is deliberately excluded.
    const matchedGroups = new Set([...matches.values()].map(c => `${c.provider}|${c.account}`));
    if (matchedGroups.size !== 1) continue;
    duplicates.add(id);
    const c = [...matches.values()][0], row = rowFor(c);
    if (isAutomatedCampaignReply(m)) row.automatic.add(id);
    else { row.replies.add(c.recipient); dayFor(m.date).replies += 1; }
  }
  const bounceCounts = {};
  for (const row of groups.values()) {
    if (row.provider !== 'softora') continue;
    const key = `softora|${row.account}`;
    const provenRecipients = Object.fromEntries([...row.contacts].map(recipient => [`email:${recipient}`,1]));
    const relevant = bounceMessages.filter(m => inPeriod(m.date || m.internal_date) && normalizeMailboxIdentity(m.account_email) === normalizeMailboxIdentity(row.account));
    const stats = summarizeMailboxBounceStats(relevant, { requireSentRecipientMatch:true, sentRecipientCounts:provenRecipients });
    bounceCounts[key] = stats.bounceRecords.filter(b => contacts.some(c => c.provider === 'softora' && c.account === row.account && c.recipient === b.email && time(b.at) >= time(c.at))).length;
  }
  const rows = [...groups.values()].map(row => ({ provider: row.provider, account: row.account, sent: row.sends.size, contacted: row.contacts.size,
    replied: row.replies.size, replyRate: row.contacts.size ? row.replies.size / row.contacts.size * 100 : null,
    automaticReplies: row.automatic.size, minimumOnly: row.fallback.size > 0, clicks: null, clickRate: null, bounces: row.provider === 'softora' ? bounceCounts[`softora|${row.account}`] || 0 : null }));
  const total = { sent: 0, contacted: 0, replied: 0, automaticReplies: 0, minimumOnly: false, clickRate: null, bounces: filters.provider === 'instantly' ? null : Object.values(bounceCounts).reduce((sum,count) => sum + count,0) };
  const recipientSet = new Set(), replySet = new Set();
  for (const row of groups.values()) { row.contacts.forEach(v => recipientSet.add(v)); row.replies.forEach(v => replySet.add(v)); }
  for (const row of rows) { total.sent += row.sent; total.automaticReplies += row.automaticReplies; total.minimumOnly ||= row.minimumOnly; }
  total.contacted = recipientSet.size; total.replied = replySet.size; total.replyRate = total.contacted ? total.replied / total.contacted * 100 : null;
  return { ok: true, filters, totals: total, rows: rows.sort((a,b) => b.sent - a.sent), daily: [...days.values()].sort((a,b) => a.date.localeCompare(b.date)),
    accounts: [...new Set(allContacts.map(c => c.account))].sort(), fetchedAt: filters.until,
    coverage: { source: 'confirmed-softora-guards-and-provider-campaign-messages', scope: 'available-history', replies: 'reference-linked-only', clickTracking: 'not-measured', bounces: 'softora-confirmed-only' } };
}

function createMailAnalyticsService(options = {}) {
  const repository = options.repository || createMailAnalyticsRepository(options);
  let cached = null, pending = null;
  return { async get(query) {
    const now = options.now?.() ?? Date.now();
    const filters = parseAnalyticsFilters(query, now);
    // One bounded cached read for all filters, without starting mailbox or provider synchronization.
    if (!cached || now - cached.at > 60000) {
      if (!pending) pending = repository.load({ from: new Date(now - 90 * 86400000).toISOString(), until: filters.until }).then(data => { cached = { at: now, data }; }).finally(() => { pending = null; });
      await pending;
    }
    const result = summarizeMailAnalytics(cached.data, filters);
    result.fetchedAt = new Date(cached.at).toISOString();
    return result;
  } };
}
module.exports = { createMailAnalyticsService, summarizeMailAnalytics, parseAnalyticsFilters };
