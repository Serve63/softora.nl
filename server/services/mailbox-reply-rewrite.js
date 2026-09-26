'use strict';

const {
  buildMailboxDraftRewriteSystemPrompt,
  buildMailboxReplyPromptPayload,
  buildMailboxReplySystemPrompt,
  buildSimpleRejectionReply,
  enforceMailboxReplyProfile,
  resolveMailboxReplySenderProfile,
} = require('./mailbox-reply-prompt');
const { buildOpenAiContextHeaders } = require('./openai-request-context');

const REWRITE_TIMEOUT_MS = 65000;
// Deep reasoning (e.g. "max") can take minutes; the API function allows 800s.
const REASONING_REWRITE_TIMEOUT_MS = 300000;

// "Voorgestelde reactie" and "Verwoord dit beter" for the mailbox composer.
function createMailboxReplyRewrite(deps = {}) {
  const {
    env = {},
    getOpenAiApiKey,
    openAiApiBaseUrl,
    openAiModel,
    reasoningEffort = '',
    fetchJsonWithTimeout,
    extractOpenAiTextContent,
    resolveRewriteIdentity,
    replyExamples = null,
    cleanPromptText,
    normalizeEmail,
    normalizeString,
    truncateText,
  } = deps;

  // Reasoning effort (up to "max") is only fully supported on the Responses
  // API, the same route the KVK workers use for gpt-6-luna.
  function buildRequest({ baseUrl, model, messages, temperature, effort }) {
    if (!effort) return { url: `${baseUrl}/chat/completions`, body: { model, temperature, messages } };
    return {
      url: `${baseUrl}/responses`,
      body: {
        model,
        reasoning: { effort },
        store: false,
        input: messages.map(({ role, content }) => ({ role: role === 'system' ? 'developer' : role, content })),
      },
    };
  }

  function readGeneratedText(data) {
    if (Array.isArray(data?.choices)) return extractOpenAiTextContent(data.choices[0]?.message?.content);
    return (Array.isArray(data?.output) ? data.output : [])
      .filter((item) => item?.type === 'message')
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .filter((part) => part?.type === 'output_text')
      .map((part) => part.text || '')
      .join('');
  }

  async function requestCompletion({ model, messages, temperature }) {
    const baseUrl = normalizeString(openAiApiBaseUrl) || 'https://api.openai.com/v1';
    const apiKey = normalizeString(typeof getOpenAiApiKey === 'function' ? getOpenAiApiKey() : '');
    const effort = normalizeString(reasoningEffort).toLowerCase();
    const request = buildRequest({ baseUrl, model, messages, temperature, effort });
    const { response, data } = await fetchJsonWithTimeout(
      request.url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...buildOpenAiContextHeaders({ env, openAiApiBaseUrl: baseUrl }),
        },
        body: JSON.stringify(request.body),
      },
      effort ? REASONING_REWRITE_TIMEOUT_MS : REWRITE_TIMEOUT_MS
    );
    if (!response.ok) {
      // Only the provider's error code/param: never its message or our payload.
      const code = [data?.error?.code, data?.error?.param].filter((value) => /^[a-zA-Z0-9_.-]{1,80}$/.test(value || '')).join(' ');
      const error = new Error(`OpenAI mailtekst verbeteren mislukt (${response.status}${code ? ` ${code}` : ''})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    if (!Array.isArray(data?.choices) && data?.status && data.status !== 'completed') {
      const error = new Error(`OpenAI gaf geen volledig antwoord (${data.status}).`);
      error.status = 502;
      throw error;
    }
    return { data, text: truncateText(normalizeString(readGeneratedText(data)), 8000) };
  }

  async function loadReplyExamples(payload, accountEmail) {
    if (!replyExamples || typeof replyExamples.findReplyExamples !== 'function') return [];
    const profileKey = resolveMailboxReplySenderProfile({
      accountEmail,
      senderName: payload.afzenderContext?.naam,
      originalSentMail: payload.oorspronkelijkeVerzondenMail,
    }).key;
    const inboundText = payload.ontvangenMail?.body || payload.ontvangenMail?.preview || '';
    return replyExamples.findReplyExamples({ profileKey, inboundText }).catch(() => []);
  }

  async function rewriteDraft({ accountEmail, to, subject, body, context, senderProfile, previousSuggestion }) {
    const draft = cleanPromptText(body, 8000);
    const hasReplyContext = Boolean(
      context && typeof context === 'object' && (cleanPromptText(context.body, 6000) || cleanPromptText(context.preview, 600))
    );
    if (!draft && !hasReplyContext) {
      const error = new Error('Typ eerst je mailtekst.');
      error.status = 400;
      throw error;
    }
    const model = normalizeString(openAiModel) || 'gpt-6-luna';
    const { resolvedAccountEmail, accountSenderName } = await resolveRewriteIdentity({ context, accountEmail, recipientEmail: to, isReply: hasReplyContext });
    const payloadOptions = {
      accountEmail: resolvedAccountEmail,
      senderName: accountSenderName,
      to,
      subject,
      body: draft,
      context,
      senderProfile,
      isReply: hasReplyContext,
      previousSuggestion: hasReplyContext ? previousSuggestion : '',
      cleanPromptText,
      normalizeEmail,
    };
    let payload = buildMailboxReplyPromptPayload(payloadOptions);
    const apiKey = normalizeString(typeof getOpenAiApiKey === 'function' ? getOpenAiApiKey() : '');
    const shortcut = hasReplyContext && !payload.vorigVoorstel ? buildSimpleRejectionReply(payload, resolvedAccountEmail) : '';
    if (shortcut && !apiKey) return { text: shortcut, model: 'policy', usage: null, provider: 'local' };
    if (!apiKey) {
      const error = new Error('OpenAI API-key ontbreekt.');
      error.status = 503;
      throw error;
    }

    if (!hasReplyContext) {
      const { data, text } = await requestCompletion({
        model,
        temperature: 0.25,
        messages: [
          { role: 'system', content: buildMailboxDraftRewriteSystemPrompt({ senderName: accountSenderName }) },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      });
      if (!text) {
        const error = new Error('OpenAI gaf geen verbeterde tekst terug.');
        error.status = 502;
        throw error;
      }
      return { text, model: normalizeString(data?.model || model) || model, usage: data?.usage || null, provider: 'openai' };
    }

    const examples = await loadReplyExamples(payload, resolvedAccountEmail);
    if (examples.length) payload = buildMailboxReplyPromptPayload({ ...payloadOptions, replyExamples: examples });
    const messages = [
      {
        role: 'system',
        content: buildMailboxReplySystemPrompt({
          hasDraft: Boolean(draft),
          senderName: payload.afzenderContext?.naam,
          hasExamples: examples.length > 0,
          hasPreviousSuggestion: Boolean(payload.vorigVoorstel),
        }),
      },
      { role: 'user', content: JSON.stringify(payload) },
    ];
    const enforceOptions = {
      firstName: payload.antwoordContext?.aanhefNaam,
      inboundText: payload.ontvangenMail?.body || payload.ontvangenMail?.preview || '',
      conversation: payload.gespreksverloop,
      accountEmail: resolvedAccountEmail,
      conceptText: draft,
      senderName: payload.afzenderContext?.naam,
      originalSentMail: payload.oorspronkelijkeVerzondenMail,
    };
    let lastError = null;
    let usedModel = model;
    let usage = null;
    // One automatic retry: the model hears why its first answer was refused.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, text: generated } = await requestCompletion({ model, messages, temperature: 0.15 });
      usedModel = normalizeString(data?.model || model) || model;
      usage = data?.usage || usage;
      try {
        const text = truncateText(enforceMailboxReplyProfile(generated, { ...enforceOptions, allowFallback: attempt > 0 }), 8000);
        if (text) return { text, model: usedModel, usage, provider: 'openai', attempts: attempt + 1 };
      } catch (error) {
        if (error?.code !== 'MAILBOX_REPLY_NEEDS_REVIEW') throw error;
        lastError = error;
        messages.push(
          { role: 'assistant', content: generated || '(leeg)' },
          { role: 'user', content: `Dit antwoord is geweigerd: ${error.reviewReason || 'het voldoet niet aan antwoordBeleid'}. Geef een verbeterde versie als geldige JSON.` }
        );
      }
    }
    if (shortcut) return { text: shortcut, model: 'policy', usage, provider: 'local' };
    throw lastError || Object.assign(new Error('OpenAI gaf geen verbeterde tekst terug.'), { status: 502 });
  }

  return { rewriteDraft };
}

module.exports = { createMailboxReplyRewrite };
