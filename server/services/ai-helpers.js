function createAiHelpers(deps = {}) {
  const {
    anthropicModel = '',
    env = process.env,
    normalizeString = (value) => String(value || '').trim(),
    openAiModel = '',
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  } = deps;

  function getByPath(obj, path) {
    return String(path || '')
      .split('.')
      .reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
  }

  function collectStringValuesByKey(root, keyRegex, options = {}) {
    const maxDepth = options.maxDepth ?? 8;
    const maxItems = options.maxItems ?? 10;
    const minLength = options.minLength ?? 1;
    const out = [];
    const seen = new Set();

    function walk(node, depth) {
      if (out.length >= maxItems) return;
      if (depth > maxDepth) return;
      if (!node || typeof node !== 'object') return;

      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item, depth + 1);
          if (out.length >= maxItems) return;
        }
        return;
      }

      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string' && keyRegex.test(key)) {
          const normalized = normalizeString(value);
          if (normalized.length >= minLength && !seen.has(normalized)) {
            seen.add(normalized);
            out.push(normalized);
            if (out.length >= maxItems) return;
          }
        }

        if (value && typeof value === 'object') {
          walk(value, depth + 1);
          if (out.length >= maxItems) return;
        }
      }
    }

    walk(root, 0);
    return out;
  }

  function formatTranscriptPartsFromEntries(entries, options = {}) {
    if (!Array.isArray(entries)) return '';
    const preferFull = options.preferFull !== false;
    const maxLength = Number.isFinite(options.maxLength) ? options.maxLength : 4000;

    const parts = entries
      .map((entry) => {
        if (!entry) return '';
        if (typeof entry === 'string') return normalizeString(entry);
        if (typeof entry !== 'object') return '';

        const speaker = normalizeString(
          entry.role ||
            entry.speaker ||
            entry.name ||
            entry.from ||
            entry.participant ||
            entry.channel ||
            entry.actor
        );

        const nestedMessage =
          (entry.message && typeof entry.message === 'object' ? entry.message : null) ||
          (entry.content && typeof entry.content === 'object' ? entry.content : null);

        const text = normalizeString(
          entry.text ||
            entry.content ||
            entry.message ||
            entry.utterance ||
            entry.transcript ||
            entry.value ||
            nestedMessage?.text ||
            nestedMessage?.content ||
            nestedMessage?.message
        );
        if (!text) return '';
        return speaker ? `${speaker}: ${text}` : text;
      })
      .filter(Boolean);

    if (parts.length === 0) return '';
    const joined = preferFull ? parts.join('\n') : parts.slice(-6).join(' | ');
    return truncateText(joined, maxLength);
  }

  function extractTranscriptText(payload, options = {}) {
    const maxLength = Number.isFinite(options.maxLength) ? Math.max(80, options.maxLength) : 4000;
    const preferFull = options.preferFull !== false;
    const transcriptCandidates = [
      getByPath(payload, 'message.call.transcript'),
      getByPath(payload, 'message.call.artifact.transcript'),
      getByPath(payload, 'message.artifact.transcript'),
      getByPath(payload, 'call.artifact.transcript'),
      getByPath(payload, 'message.transcript'),
      getByPath(payload, 'call.transcript'),
      getByPath(payload, 'transcript'),
      getByPath(payload, 'message.call.artifact.messages'),
      getByPath(payload, 'message.artifact.messages'),
      getByPath(payload, 'call.artifact.messages'),
      getByPath(payload, 'message.call.messages'),
      getByPath(payload, 'message.messages'),
      getByPath(payload, 'call.messages'),
      getByPath(payload, 'message.call.conversation'),
      getByPath(payload, 'message.conversation'),
      getByPath(payload, 'call.conversation'),
      getByPath(payload, 'message.call.utterances'),
      getByPath(payload, 'message.utterances'),
      getByPath(payload, 'call.utterances'),
    ];

    for (const candidate of transcriptCandidates) {
      if (!candidate) continue;

      if (typeof candidate === 'string') {
        return truncateText(candidate, maxLength);
      }

      if (Array.isArray(candidate)) {
        const formatted = formatTranscriptPartsFromEntries(candidate, { preferFull, maxLength });
        if (formatted) return formatted;
      }

      if (candidate && typeof candidate === 'object') {
        const nestedArrays = [
          candidate.messages,
          candidate.items,
          candidate.utterances,
          candidate.turns,
          candidate.entries,
          candidate.segments,
          candidate.transcript,
        ];
        for (const nested of nestedArrays) {
          if (!Array.isArray(nested)) continue;
          const formatted = formatTranscriptPartsFromEntries(nested, { preferFull, maxLength });
          if (formatted) return formatted;
        }
      }
    }

    const utteranceCandidates = collectStringValuesByKey(payload, /utterance|transcript/i, {
      maxItems: preferFull ? 40 : 8,
      minLength: 8,
    });
    if (utteranceCandidates.length > 0) {
      return truncateText(
        preferFull ? utteranceCandidates.join('\n') : utteranceCandidates.slice(-4).join(' | '),
        maxLength
      );
    }

    return '';
  }

  function extractTranscriptSnippet(payload) {
    return extractTranscriptText(payload, { maxLength: 450, preferFull: false });
  }

  function extractTranscriptFull(payload) {
    return extractTranscriptText(payload, { maxLength: 8000, preferFull: true });
  }

  function extractRetellTranscriptText(call, options = {}) {
    const maxLength = Number.isFinite(options.maxLength) ? Math.max(80, options.maxLength) : 8000;
    const preferFull = options.preferFull !== false;
    if (!call || typeof call !== 'object') return '';

    const transcript = normalizeString(call?.transcript || '');
    if (transcript) return truncateText(transcript, maxLength);

    const transcriptCandidates = [call?.transcript_with_tool_calls, call?.transcript_object];
    for (const candidate of transcriptCandidates) {
      if (!Array.isArray(candidate)) continue;
      const formatted = formatTranscriptPartsFromEntries(candidate, { preferFull, maxLength });
      if (formatted) return formatted;
    }

    return '';
  }

  function parseJsonLoose(text) {
    const raw = normalizeString(text);
    if (!raw) return null;

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : raw;

    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  function extractOpenAiTextContent(content) {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (!part) return '';
          if (typeof part === 'string') return part;
          return normalizeString(part.text || part.content || part.output_text || '');
        })
        .filter(Boolean)
        .join('\n');
    }

    if (content && typeof content === 'object') {
      return normalizeString(content.text || content.content || '');
    }

    return '';
  }

  function extractAnthropicTextContent(content) {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (!part) return '';
          if (typeof part === 'string') return part;
          if (Array.isArray(part.content)) return extractAnthropicTextContent(part.content);
          if (part.type === 'text') return normalizeString(part.text || '');
          return normalizeString(part.text || part.content || '');
        })
        .filter(Boolean)
        .join('\n');
    }

    if (content && typeof content === 'object') {
      if (Array.isArray(content.content)) return extractAnthropicTextContent(content.content);
      return normalizeString(content.text || content.content || '');
    }

    return '';
  }

  function getOpenAiModelCostRates(model) {
    const explicitInput = Number(env.OPENAI_COST_INPUT_PER_1M || '');
    const explicitOutput = Number(env.OPENAI_COST_OUTPUT_PER_1M || '');
    if (
      Number.isFinite(explicitInput) &&
      Number.isFinite(explicitOutput) &&
      explicitInput >= 0 &&
      explicitOutput >= 0
    ) {
      return { inputPer1mUsd: explicitInput, outputPer1mUsd: explicitOutput, source: 'env' };
    }

    const key = normalizeString(model || openAiModel).toLowerCase();
    if (key.includes('gpt-5-mini')) return { inputPer1mUsd: 0.25, outputPer1mUsd: 2.0, source: 'default-mini' };
    if (key.includes('gpt-5-nano')) return { inputPer1mUsd: 0.05, outputPer1mUsd: 0.4, source: 'default-nano' };
    if (key.includes('gpt-5')) return { inputPer1mUsd: 1.25, outputPer1mUsd: 10.0, source: 'default-gpt5' };
    if (key.includes('gpt-4.1-mini')) return { inputPer1mUsd: 0.4, outputPer1mUsd: 1.6, source: 'default-4.1-mini' };
    if (key.includes('gpt-4.1')) return { inputPer1mUsd: 2.0, outputPer1mUsd: 8.0, source: 'default-4.1' };
    if (key.includes('gpt-4o-mini')) return { inputPer1mUsd: 0.15, outputPer1mUsd: 0.6, source: 'default-4o-mini' };
    return { inputPer1mUsd: 1.0, outputPer1mUsd: 4.0, source: 'default-generic' };
  }

  function buildOpenAiCostEstimate({ promptTokens, completionTokens, totalTokens, model, method = 'usage' }) {
    if (
      !Number.isFinite(promptTokens) ||
      !Number.isFinite(completionTokens) ||
      promptTokens < 0 ||
      completionTokens < 0
    ) {
      return null;
    }

    const rates = getOpenAiModelCostRates(model);
    const usdToEur = Number(env.OPENAI_COST_USD_TO_EUR || 0.92);
    const safeUsdToEur = Number.isFinite(usdToEur) && usdToEur > 0 ? usdToEur : 0.92;

    const inputUsd = (promptTokens / 1_000_000) * rates.inputPer1mUsd;
    const outputUsd = (completionTokens / 1_000_000) * rates.outputPer1mUsd;
    const totalUsd = inputUsd + outputUsd;
    const totalEur = totalUsd * safeUsdToEur;

    return {
      model: normalizeString(model || openAiModel),
      promptTokens: Math.round(promptTokens),
      completionTokens: Math.round(completionTokens),
      totalTokens: Number.isFinite(totalTokens)
        ? Math.round(totalTokens)
        : Math.round(promptTokens + completionTokens),
      usd: Number(totalUsd.toFixed(8)),
      eur: Number(totalEur.toFixed(8)),
      rates,
      usdToEur: safeUsdToEur,
      estimated: true,
      method,
    };
  }

  function estimateTokenCountFromText(value) {
    const text = normalizeString(value || '');
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / 4));
  }

  function estimateOpenAiUsageCost(usage, model) {
    if (!usage || typeof usage !== 'object') return null;
    const hasTokenSignal = [
      usage.prompt_tokens,
      usage.input_tokens,
      usage.promptTokens,
      usage.inputTokens,
      usage.completion_tokens,
      usage.output_tokens,
      usage.completionTokens,
      usage.outputTokens,
      usage.total_tokens,
      usage.totalTokens,
    ].some((value) => Number.isFinite(Number(value)));
    if (!hasTokenSignal) return null;

    const promptTokens = Number(
      usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.inputTokens ?? 0
    );
    const completionTokens = Number(
      usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.outputTokens ?? 0
    );
    const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? promptTokens + completionTokens);
    if (
      !Number.isFinite(promptTokens) ||
      !Number.isFinite(completionTokens) ||
      promptTokens < 0 ||
      completionTokens < 0
    ) {
      return null;
    }

    return buildOpenAiCostEstimate({
      promptTokens,
      completionTokens,
      totalTokens,
      model,
      method: 'usage',
    });
  }

  function estimateOpenAiTextCost(inputText, outputText, model) {
    const promptTokens = estimateTokenCountFromText(inputText);
    const completionTokens = estimateTokenCountFromText(outputText);
    if (promptTokens <= 0 && completionTokens <= 0) return null;
    return buildOpenAiCostEstimate({
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      model,
      method: 'text-fallback',
    });
  }

  function getAnthropicModelCostRates(model) {
    const explicitInput = Number(env.ANTHROPIC_COST_INPUT_PER_1M || '');
    const explicitOutput = Number(env.ANTHROPIC_COST_OUTPUT_PER_1M || '');
    if (
      Number.isFinite(explicitInput) &&
      Number.isFinite(explicitOutput) &&
      explicitInput >= 0 &&
      explicitOutput >= 0
    ) {
      return { inputPer1mUsd: explicitInput, outputPer1mUsd: explicitOutput, source: 'env' };
    }

    const key = normalizeString(model || anthropicModel).toLowerCase();
    if (key.includes('claude-opus-4-6')) {
      return { inputPer1mUsd: 5, outputPer1mUsd: 25, source: 'default-opus-4.6' };
    }
    if (key.includes('claude-opus')) return { inputPer1mUsd: 15, outputPer1mUsd: 75, source: 'default-opus' };
    if (key.includes('claude-sonnet')) return { inputPer1mUsd: 3, outputPer1mUsd: 15, source: 'default-sonnet' };
    if (key.includes('claude-haiku')) return { inputPer1mUsd: 0.8, outputPer1mUsd: 4, source: 'default-haiku' };
    return null;
  }

  function buildAnthropicCostEstimate({ promptTokens, completionTokens, totalTokens, model, method = 'usage' }) {
    if (
      !Number.isFinite(promptTokens) ||
      !Number.isFinite(completionTokens) ||
      promptTokens < 0 ||
      completionTokens < 0
    ) {
      return null;
    }

    const rates = getAnthropicModelCostRates(model);
    if (!rates) return null;

    const usdToEur = Number(env.AI_COST_USD_TO_EUR || env.OPENAI_COST_USD_TO_EUR || 0.92);
    const safeUsdToEur = Number.isFinite(usdToEur) && usdToEur > 0 ? usdToEur : 0.92;

    const inputUsd = (promptTokens / 1_000_000) * rates.inputPer1mUsd;
    const outputUsd = (completionTokens / 1_000_000) * rates.outputPer1mUsd;
    const totalUsd = inputUsd + outputUsd;
    const totalEur = totalUsd * safeUsdToEur;

    return {
      model: normalizeString(model || anthropicModel),
      promptTokens: Math.round(promptTokens),
      completionTokens: Math.round(completionTokens),
      totalTokens: Number.isFinite(totalTokens)
        ? Math.round(totalTokens)
        : Math.round(promptTokens + completionTokens),
      usd: Number(totalUsd.toFixed(8)),
      eur: Number(totalEur.toFixed(8)),
      rates,
      usdToEur: safeUsdToEur,
      estimated: true,
      method,
    };
  }

  function estimateAnthropicUsageCost(usage, model) {
    if (!usage || typeof usage !== 'object') return null;
    const promptTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? 0);
    const completionTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? 0);
    const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? promptTokens + completionTokens);
    if (
      !Number.isFinite(promptTokens) ||
      !Number.isFinite(completionTokens) ||
      promptTokens < 0 ||
      completionTokens < 0
    ) {
      return null;
    }

    return buildAnthropicCostEstimate({
      promptTokens,
      completionTokens,
      totalTokens,
      model,
      method: 'usage',
    });
  }

  function estimateAnthropicTextCost(inputText, outputText, model) {
    const promptTokens = estimateTokenCountFromText(inputText);
    const completionTokens = estimateTokenCountFromText(outputText);
    if (promptTokens <= 0 && completionTokens <= 0) return null;
    return buildAnthropicCostEstimate({
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      model,
      method: 'text-fallback',
    });
  }

  return {
    buildAnthropicCostEstimate,
    buildOpenAiCostEstimate,
    collectStringValuesByKey,
    estimateAnthropicTextCost,
    estimateAnthropicUsageCost,
    estimateOpenAiTextCost,
    estimateOpenAiUsageCost,
    estimateTokenCountFromText,
    extractAnthropicTextContent,
    extractOpenAiTextContent,
    extractRetellTranscriptText,
    extractTranscriptFull,
    extractTranscriptSnippet,
    extractTranscriptText,
    formatTranscriptPartsFromEntries,
    getAnthropicModelCostRates,
    getByPath,
    getOpenAiModelCostRates,
    parseJsonLoose,
  };
}

module.exports = {
  createAiHelpers,
};
