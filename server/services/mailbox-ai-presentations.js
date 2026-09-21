'use strict';
const contract = require('../../assets/premium-mailbox-ai-presentation');
const { buildSource, buildRequest, createMailboxAiClassifier } = require('./mailbox-ai-classifier');
const { createMailboxAiRepository } = require('../repositories/mailbox-ai-presentations');
function createMailboxAiPresentations({ env = {}, getOpenAiApiKey, getSupabaseClient,
  repository = createMailboxAiRepository({ getClient: getSupabaseClient }),
  classifier = createMailboxAiClassifier({ getApiKey: getOpenAiApiKey }), logger = console } = {}) {
  const enabled = () => env.MAILBOX_AI_PRESENTATION_ENABLED === 'true';
  const presentation = (source, row) => ({ version: contract.VERSION, model: contract.MODEL,
    reasoningEffort: 'max', status: row?.status === 'ready' ? 'ready' : row?.status === 'failed' ? 'unavailable' : 'pending',
    ...(row?.status === 'ready' ? { sourceBody: source.body, decision: row.decision } : {}) });
  function sourceFor(message) {
    const source = buildSource(message);
    if (!source) return null;
    try { buildRequest(source); } catch (_) { source.unsupported = true; }
    return { ...source, messageKey: String(message.messageKey || message.id || source.identity) };
  }
  async function enrich(messages) {
    if (!enabled()) return messages;
    const sources = messages.map(sourceFor);
    let rows = [];
    try { rows = await repository.enqueue(sources.filter(Boolean)); }
    catch (_) { logger.warn?.('[MailboxAI] Presentation storage unavailable; original body retained.'); }
    const byId = new Map((rows || []).map((row) => [row.id, row]));
    return messages.map((message, index) => sources[index] ? {
      ...message, aiPresentation: presentation(sources[index], byId.get(sources[index].id)),
    } : { ...message, aiPresentation: { version: contract.VERSION, status: 'unavailable' } });
  }
  async function enrichTree(messages) {
    if (!enabled()) return messages;
    const flat = [];
    function collect(message, account) {
      const copy = { ...message, accountEmail: message.accountEmail || account };
      flat.push(copy);
      if (Array.isArray(message.threadMessages)) copy.threadMessages = message.threadMessages.map((child) => collect(child, copy.accountEmail));
      return copy;
    }
    const tree = messages.map((message) => collect(message, message.accountEmail));
    const results = await enrich(flat);
    results.forEach((result, index) => { flat[index].aiPresentation = result.aiPresentation; });
    return tree;
  }
  async function enrichPayload(payload) {
    return enabled() && Array.isArray(payload.messages) ? { ...payload, messages: await enrichTree(payload.messages) } : payload;
  }
  async function processQueue() {
    if (!enabled() || !getOpenAiApiKey?.()) return { skipped: true, processed: 0 };
    let stage = 'candidates';
    try {
      const candidates = await repository.candidates();
      stage = 'enqueue';
      await repository.enqueue((candidates || []).map((row) => sourceFor({ body: row.body_text,
        accountEmail: row.account_email, id: row.provider_id, messageKey: row.message_key,
        messageId: row.message_id, from: row.sender_name || row.sender_email || 'Onbekend', email: row.sender_email,
        folder: row.folder, direction: row.payload?.direction, sourceHtml: row.payload?.sourceHtml,
        bodyTruncated: row.body_truncated })).filter(Boolean));
      let processed = 0;
      for (let count = 0; count < 2; count += 1) {
        stage = 'claim';
        const job = await repository.claim();
        if (!job) break; // Includes exhausted/unapproved lifetime budget.
        let result = null;
        try { result = await classifier.classify(job.source); }
        catch (error) {
          const code = /^MAILBOX_AI_[A-Z_]+$/.test(error?.message) ? error.message
            : error?.name === 'TimeoutError' ? 'MAILBOX_AI_TIMEOUT' : 'MAILBOX_AI_REQUEST_FAILED';
          logger.warn?.('[MailboxAI] Classification failed; original body retained, no automatic retry.', { code });
        }
        stage = 'finish';
        await repository.finish(job, result);
        processed += 1;
      }
      return { processed };
    } catch (_) {
      logger.warn?.('[MailboxAI] Background storage unavailable; original body retained.', { stage });
      return { processed: 0, unavailable: true };
    }
  }
  return { enrich, enrichTree, enrichPayload, processQueue };
}
module.exports = { createMailboxAiPresentations };
