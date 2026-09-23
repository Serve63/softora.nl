'use strict';
// GPT-6 Luna Standard, USD micro-units per token. Round up per request.
// Long-context rates apply to the entire request above 272K input tokens.
function readUsage(result) {
  const raw = result?.usage, inputTokens = raw?.input_tokens, outputTokens = raw?.output_tokens;
  const cachedInputTokens = raw?.input_tokens_details?.cached_tokens ?? 0;
  // Missing cache-write detail is billed conservatively at the full write premium.
  const cacheWriteTokens = raw?.input_tokens_details?.cache_write_tokens ?? (inputTokens - cachedInputTokens);
  const complete = [inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens].every((v) => Number.isSafeInteger(v) && v >= 0)
    && inputTokens > 0 && cachedInputTokens + cacheWriteTokens <= inputTokens && (!result.model || result.model.startsWith('gpt-6-luna'))
    && (!result.service_tier || result.service_tier === 'default');
  const long = inputTokens > 272000;
  return { model: 'gpt-6-luna', complete,
    inputTokens: Number.isSafeInteger(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isSafeInteger(outputTokens) ? outputTokens : 0,
    cachedInputTokens: Number.isSafeInteger(cachedInputTokens) ? cachedInputTokens : 0,
    cacheWriteTokens: Number.isSafeInteger(cacheWriteTokens) ? cacheWriteTokens : 0,
    billingMicroUsd: complete ? Math.ceil(((inputTokens - cachedInputTokens - cacheWriteTokens) * (long ? 40 : 20)
      + cachedInputTokens * (long ? 4 : 2) + cacheWriteTokens * (long ? 50 : 25)
      + outputTokens * (long ? 150 : 100)) / 200) : null };
}
function mergeUsage(first, second) {
  return { model: first.model, complete: first.complete && second.complete,
    inputTokens: first.inputTokens + second.inputTokens, outputTokens: first.outputTokens + second.outputTokens,
    cachedInputTokens: first.cachedInputTokens + second.cachedInputTokens,
    cacheWriteTokens: first.cacheWriteTokens + second.cacheWriteTokens,
    billingMicroUsd: first.complete && second.complete ? first.billingMicroUsd + second.billingMicroUsd : null };
}
module.exports = { readUsage, mergeUsage };
