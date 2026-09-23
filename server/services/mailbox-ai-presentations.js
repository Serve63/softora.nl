'use strict';
const { restoreMailboxParagraphs } = require('./mailbox-provider-rich-body');
const contract = require('../../assets/premium-mailbox-ai-presentation');
const { buildSource, buildRequest, createMailboxAiClassifier } = require('./mailbox-ai-classifier');
const { createMailboxAiRepository } = require('../repositories/mailbox-ai-presentations');
function createMailboxAiPresentations({ env = {}, getOpenAiApiKey, getSupabaseClient,
  repository = createMailboxAiRepository({ getClient: getSupabaseClient }),
  classifier = createMailboxAiClassifier({ getApiKey: getOpenAiApiKey }), logger = console } = {}) {
  const enabled = () => env.MAILBOX_AI_PRESENTATION_ENABLED === 'true';
  const presentation = (source, row) => ({ version: contract.VERSION, model: contract.MODEL,
    reasoningEffort: 'max', status: row?.status === 'ready' ? 'ready' : row?.status === 'failed' || row?.reason ? 'unavailable' : 'pending',
    ...(row?.status !== 'ready' && source.html ? { displayBody: restoreMailboxParagraphs(source.body, source.html) } : {}),
    gate: row?.gate === true, reason: row?.reason || (!row ? 'storage' : null),
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
      // Two waves of four: worst-case 480s model time, below the 800s runtime.
      // SQL enforces the global cap across overlapping cron invocations.
      for (let wave = 0; wave < 2; wave += 1) {
        const jobs = [];
        stage = 'claim';
        for (let i = 0; i < 4; i += 1) {
          const job = await repository.claim();
          if (!job) break;
          jobs.push(job);
        }
        if (!jobs.length) break;
        stage = 'finish';
        const outcomes = await Promise.allSettled(jobs.map(async (job) => {
          let result = null, failedUsage = null;
          try { result = await classifier.classify(job.source); }
          catch (error) {
            const code = /^MAILBOX_AI_[A-Z_]+$/.test(error?.message) ? error.message
              : error?.name === 'TimeoutError' ? 'MAILBOX_AI_TIMEOUT' : 'MAILBOX_AI_REQUEST_FAILED';
            failedUsage = error.mailboxUsage ? { ...error.mailboxUsage, errorCode: code } : null;
            logger.warn?.('[MailboxAI] Classification failed; original body retained.', { code, ...(Number.isInteger(error?.providerStatus) ? { providerStatus: error.providerStatus, providerCode: error.code, parameter: error.param } : {}) });
          }
          await repository.finish(job, result, failedUsage);
          processed += 1;
        }));
        if (outcomes.some((item) => item.status === 'rejected')) throw new Error('MAILBOX_AI_STORAGE_UNAVAILABLE');
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
