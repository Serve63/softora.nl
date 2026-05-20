const DEFAULT_OPENAI_API_BASE_URL = 'https://api.openai.com/v1';

function normalizeString(value) {
  return String(value || '').trim();
}

function resolveOpenAiApiBaseUrl(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(
    deps.openAiApiBaseUrl || env.OPENAI_API_BASE_URL || DEFAULT_OPENAI_API_BASE_URL
  ).replace(/\/+$/, '');
}

function resolveOpenAiOrganizationId(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(
    deps.openAiOrganizationId ||
      deps.openAiOrgId ||
      env.OPENAI_ORGANIZATION_ID ||
      env.OPENAI_ORG_ID ||
      env.OPENAI_ORGANIZATION
  );
}

function resolveOpenAiProjectId(deps = {}) {
  const env = deps.env || process.env || {};
  return normalizeString(deps.openAiProjectId || env.OPENAI_PROJECT_ID || env.OPENAI_PROJECT);
}

function buildOpenAiContextHeaders(deps = {}) {
  const headers = {};
  const organizationId = resolveOpenAiOrganizationId(deps);
  const projectId = resolveOpenAiProjectId(deps);
  if (organizationId) headers['OpenAI-Organization'] = organizationId;
  if (projectId) headers['OpenAI-Project'] = projectId;
  return headers;
}

function headerHasKey(headers, key) {
  if (!headers || !key) return false;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.has(key);
  }
  if (Array.isArray(headers)) {
    return headers.some(([name]) => normalizeString(name).toLowerCase() === key.toLowerCase());
  }
  return Object.keys(headers).some((name) => name.toLowerCase() === key.toLowerCase());
}

function mergeOpenAiContextHeaders(headers = {}, deps = {}) {
  const contextHeaders = buildOpenAiContextHeaders(deps);
  if (Object.keys(contextHeaders).length === 0) return headers;

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const next = new Headers(headers);
    Object.entries(contextHeaders).forEach(([key, value]) => {
      if (value && !next.has(key)) next.set(key, value);
    });
    return next;
  }

  if (Array.isArray(headers)) {
    const next = headers.slice();
    Object.entries(contextHeaders).forEach(([key, value]) => {
      if (value && !headerHasKey(next, key)) next.push([key, value]);
    });
    return next;
  }

  const next = { ...(headers || {}) };
  Object.entries(contextHeaders).forEach(([key, value]) => {
    if (value && !headerHasKey(next, key)) next[key] = value;
  });
  return next;
}

function isOpenAiApiUrl(urlRaw, deps = {}) {
  let url;
  let apiBaseUrl;
  try {
    url = new URL(String(urlRaw || ''));
    apiBaseUrl = new URL(resolveOpenAiApiBaseUrl(deps));
  } catch {
    return false;
  }

  const basePath = apiBaseUrl.pathname.replace(/\/+$/, '') || '/';
  return (
    url.origin === apiBaseUrl.origin &&
    (basePath === '/' || url.pathname === basePath || url.pathname.startsWith(`${basePath}/`))
  );
}

function withOpenAiContextHeaders(url, options = {}, deps = {}) {
  if (!isOpenAiApiUrl(url, deps)) return options || {};
  return {
    ...(options || {}),
    headers: mergeOpenAiContextHeaders((options || {}).headers || {}, deps),
  };
}

module.exports = {
  buildOpenAiContextHeaders,
  isOpenAiApiUrl,
  mergeOpenAiContextHeaders,
  resolveOpenAiApiBaseUrl,
  resolveOpenAiOrganizationId,
  resolveOpenAiProjectId,
  withOpenAiContextHeaders,
};
