function createControllerSendHarness() {
  return {
    async execute(input = {}) {
      const selected = Array.isArray(input.attachments) ? input.attachments : [];
      const attachments = selected.length && typeof input.uploadAttachments === 'function'
        ? await input.uploadAttachments(selected, { fetch: input.fetch, payload: input.payload })
        : [];
      const payload = { ...input.payload, attachments };
      input.onIdempotencyKey?.(payload.idempotencyKey);
      const serialize = typeof input.serializeSendPayload === 'function'
        ? input.serializeSendPayload : JSON.stringify;
      const response = await input.fetch('/api/mailbox/send', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: serialize(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (typeof response?.status !== 'number' || response.status !== 200) {
        throw new Error(data?.detail || data?.error || 'Mail verzenden mislukt');
      }
      const result = data?.result && typeof data.result === 'object' ? data.result : {};
      return {
        response, data, result, payload, attachments,
        idempotencyKey: payload.idempotencyKey,
        recoveredByPreflight: false,
      };
    },
  };
}

module.exports = { createControllerSendHarness };
