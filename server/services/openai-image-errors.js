const SAFETY_CODES = new Set(['moderation_blocked', 'content_policy_violation', 'safety_violation', 'safety_violations', 'openai_safety_rejected', 'webpreview_safety_blocked']);

function isOpenAiSafetyBlockedError(...values) {
  const seen = new Set();
  function visit(value) {
    if (typeof value === 'string') {
      return SAFETY_CODES.has(value.toLowerCase()) || /safety[_ -]?violations?|safety system|content policy|policy violation|violated policy/i.test(value);
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    if (value.openAiSafetyBlocked === true) return true;
    if (Array.isArray(value)) return value.some(visit);
    if (['safety_violations', 'safetyViolations'].some(key => Array.isArray(value[key]) ? value[key].length > 0 : typeof value[key] === 'string' && value[key].trim() && value[key] !== '[]')) return true;
    return ['message', 'detail', 'error', 'data', 'code', 'type'].some(key => visit(value[key]));
  }
  // A generic rejection may be a quota, access or request-format error.
  // Only explicit moderation evidence classifies it as a safety block.
  return values.some(visit);
}

function buildOpenAiImageFailureDiagnostic(response, data, context = {}) {
  function identifier(value) {
    const text = String(value || '');
    return /^[a-z0-9_.:-]{1,160}$/i.test(text) ? text : null;
  }
  return {
    upstreamStatus: Number(response?.status) || null,
    upstreamCode: identifier(data?.error?.code || data?.code),
    upstreamType: identifier(data?.error?.type),
    requestId: identifier(response?.headers?.get?.('x-request-id')),
    model: identifier(context.model),
    imageSize: identifier(context.imageSize),
    referenceImageCount: Math.max(0, Number(context.referenceImageCount) || 0),
    safetyBlocked: isOpenAiSafetyBlockedError(data),
  };
}

module.exports = { isOpenAiSafetyBlockedError, buildOpenAiImageFailureDiagnostic };
