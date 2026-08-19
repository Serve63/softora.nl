'use strict';

const DATAFORSEO_ENDPOINT = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';

function text(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function safeLimit(value, fallback = 10, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.round(parsed)));
}

function extractTaskItems(body) {
  const task = body?.tasks?.[0];
  const result = task?.result?.[0];
  if (!Array.isArray(result?.items)) return [];
  return result.items.map((item) => ({ ...item, retrieved_at: result.datetime || null }));
}

function isFatalProviderStatus(httpStatus, providerStatusCode) {
  const status = Number(httpStatus);
  const code = Number(providerStatusCode);
  return status === 401 || status === 402 || Math.floor(code / 100) === 401 || Math.floor(code / 100) === 402;
}

function createDataForSeoProvider({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const login = text(env.LEAD_RADAR_DATAFORSEO_LOGIN || env.DATAFORSEO_LOGIN, 500);
  const password = text(env.LEAD_RADAR_DATAFORSEO_PASSWORD || env.DATAFORSEO_PASSWORD, 500);

  async function search({ query, maxResults = 10 } = {}) {
    if (!login || !password) {
      const error = new Error('Lead Radar SERP-provider is niet geconfigureerd.');
      error.code = 'LEAD_RADAR_PROVIDER_UNAVAILABLE';
      throw error;
    }
    if (typeof fetchImpl !== 'function') throw new Error('Fetch is niet beschikbaar.');
    const response = await fetchImpl(DATAFORSEO_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        language_code: 'nl',
        location_name: 'Netherlands',
        keyword: text(query, 700),
        depth: safeLimit(maxResults),
        device: 'desktop',
      }]),
    });
    const body = await response.json().catch(() => null);
    const task = body?.tasks?.[0];
    if (!response.ok || body?.status_code !== 20000 || task?.status_code !== 20000) {
      const message = text(task?.status_message || body?.status_message || `SERP-provider HTTP ${response.status}`, 500);
      const error = new Error(message || 'SERP-provider gaf een fout.');
      error.code = 'LEAD_RADAR_PROVIDER_ERROR';
      error.providerStatusCode = task?.status_code || body?.status_code || response.status;
      error.httpStatus = Number(response.status) || null;
      error.fatal = isFatalProviderStatus(response.status, error.providerStatusCode);
      throw error;
    }
    return extractTaskItems(body)
      .filter((item) => item && item.type === 'organic' && item.url)
      .slice(0, safeLimit(maxResults))
      .map((item) => ({
        url: text(item.url, 2_000),
        title: text(item.title, 500),
        snippet: text(item.description || item.snippet, 5_000),
        date: item.date || item.date_text || item.dateText || null,
        timestamp: item.timestamp || item.posted_at || item.postedAt || null,
        published_at: item.published_at || item.publishedAt || item.publication_date || item.publicationDate || null,
        retrieved_at: item.retrieved_at || null,
        rank: Number.isFinite(Number(item.rank_absolute)) ? Math.max(1, Math.min(10_000, Math.round(Number(item.rank_absolute)))) : null,
      }));
  }

  return {
    name: 'dataforseo',
    configured: Boolean(login && password),
    endpoint: DATAFORSEO_ENDPOINT,
    search,
    getStatus() {
      return {
        configured: Boolean(login && password),
        provider: 'dataforseo',
        endpoint: login && password ? DATAFORSEO_ENDPOINT : null,
        message: login && password ? 'SERP-provider is geconfigureerd.' : 'Configureer LEAD_RADAR_DATAFORSEO_LOGIN en LEAD_RADAR_DATAFORSEO_PASSWORD.',
      };
    },
  };
}

module.exports = { createDataForSeoProvider, extractTaskItems, isFatalProviderStatus };
