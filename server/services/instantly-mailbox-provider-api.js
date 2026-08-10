function normalizeText(value) {
  return String(value || '').trim();
}

function extractInstantlyItems(data) {
  if (Array.isArray(data)) return data;
  for (const candidate of [data?.items, data?.data, data?.emails, data?.results]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function extractInstantlyCursor(data) {
  return normalizeText(
    data?.next_starting_after ||
    data?.next_cursor ||
    data?.pagination?.next_starting_after ||
    data?.pagination?.next_cursor
  );
}

function createInstantlyApiRequest({
  assertConfigured,
  apiBaseUrl,
  apiKey,
  fetchJsonWithTimeout,
  createError,
}) {
  return async function apiRequest(path, { method = 'GET', query = {}, body, signal } = {}) {
    assertConfigured();
    const url = new URL(`${apiBaseUrl}/${normalizeText(path).replace(/^\/+/, '')}`);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
    const options = {
      method,
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
    };
    if (signal) options.signal = signal;
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const { response, data } = await fetchJsonWithTimeout(url.toString(), options, 20_000);
    if (!response?.ok) {
      const status = Number(response?.status) || 502;
      const detail = normalizeText(data?.message || data?.error || data?.detail);
      throw createError(
        detail || `Instantly gaf HTTP ${status}.`,
        status === 429 ? 'INSTANTLY_RATE_LIMITED' : 'INSTANTLY_API_FAILED',
        status === 429 ? 429 : 502,
        { providerStatus: status }
      );
    }
    return data;
  };
}

module.exports = {
  createInstantlyApiRequest,
  extractInstantlyCursor,
  extractInstantlyItems,
};
