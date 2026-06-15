const OPENAI_PRICING_SOURCE_URL = 'https://platform.openai.com/docs/pricing/';
const OPENAI_USAGE_API_SOURCE = 'OpenAI Organization Usage API';
const OPENAI_WEB_SEARCH_USD_PER_CALL = 0.01;
const DEFAULT_GPT_IMAGE_2_LOW_1024X1536_USD = 0.005;
const GPT_IMAGE_2_1024X1536_USD_BY_QUALITY = {
  low: 0.005,
  medium: 0.041,
  high: 0.165,
};
const GPT_IMAGE_2_1024X1024_USD_BY_QUALITY = {
  low: 0.006,
  medium: 0.053,
  high: 0.211,
};

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeOpenAiImageQuality(valueRaw, deps = {}) {
  const env = deps.env || process.env || {};
  const raw = normalizeString(
    valueRaw ||
      deps.openAiImageQuality ||
      env.WEBSITE_PREVIEW_IMAGE_QUALITY ||
      env.OPENAI_IMAGE_QUALITY ||
      'low'
  ).toLowerCase();
  return ['low', 'medium', 'high'].includes(raw) ? raw : 'low';
}

function getOpenAiTextModelRates(modelRaw) {
  const key = normalizeString(modelRaw).toLowerCase();
  const match = [
    ['gpt-5.5-pro', 30, 0, 180], ['gpt-5.5', 5, 0.5, 30],
    ['gpt-5.4-mini', 0.75, 0.075, 4.5], ['gpt-5.4-nano', 0.2, 0.02, 1.25],
    ['gpt-5.4-pro', 30, 0, 180], ['gpt-5.4', 2.5, 0.25, 15],
    ['gpt-5.2-pro', 21, 0, 168], ['gpt-5.2', 1.75, 0.175, 14],
    ['gpt-5.1', 1.25, 0.125, 10], ['gpt-5-pro', 15, 0, 120],
    ['gpt-5-mini', 0.25, 0.025, 2], ['gpt-5-nano', 0.05, 0.005, 0.4],
    ['gpt-5', 1.25, 0.125, 10], ['gpt-4.1-mini', 0.4, 0.1, 1.6],
    ['gpt-4.1-nano', 0.1, 0.025, 0.4], ['gpt-4.1', 2, 0.5, 8],
    ['gpt-4o-mini', 0.15, 0.075, 0.6], ['gpt-4o', 2.5, 1.25, 10],
  ].find(([name]) => key.includes(name));
  const [model, input, cachedInput, output] = match || ['default', 1, 0, 4];
  return { model, input, cachedInput, output, source: OPENAI_PRICING_SOURCE_URL };
}

function getOpenAiImageCostUsdPerImage(modelRaw, sizeRaw, deps = {}) {
  const env = deps.env || process.env || {};
  const explicit = Number(deps.openAiImageCostUsdPerImage || env.OPENAI_IMAGE_COST_USD_PER_IMAGE);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const model = normalizeString(modelRaw).toLowerCase();
  const size = normalizeString(sizeRaw).toLowerCase();
  const quality = normalizeOpenAiImageQuality(deps.quality || deps.imageQuality, deps);
  const isPortraitOrLandscape = size === '1024x1536' || size === '1536x1024';
  const isSquare = size === '1024x1024';

  if (model.includes('gpt-image-2') || model === 'chatgpt-image-latest') {
    if (isPortraitOrLandscape) return GPT_IMAGE_2_1024X1536_USD_BY_QUALITY[quality];
    if (isSquare) return GPT_IMAGE_2_1024X1024_USD_BY_QUALITY[quality];
    return GPT_IMAGE_2_1024X1536_USD_BY_QUALITY[quality];
  }
  if (model.includes('gpt-image-1.5')) return isSquare ? 0.224 : 0.176;
  if (model.includes('gpt-image-1-mini')) return isSquare ? 0.056 : 0.044;
  if (model.includes('gpt-image-1')) return isSquare ? 0.167 : 0.25;
  if (model.includes('dall-e-3')) return isPortraitOrLandscape ? 0.12 : 0.08;
  if (model.includes('dall-e-2')) return 0.02;
  return DEFAULT_GPT_IMAGE_2_LOW_1024X1536_USD;
}

function getOpenAiWebSearchUsdPerCall(deps = {}) {
  const env = deps.env || process.env || {};
  const explicit = Number(deps.openAiWebSearchUsdPerCall || env.OPENAI_WEB_SEARCH_USD_PER_CALL);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  return OPENAI_WEB_SEARCH_USD_PER_CALL;
}

module.exports = {
  DEFAULT_GPT_IMAGE_2_LOW_1024X1536_USD,
  GPT_IMAGE_2_1024X1536_USD_BY_QUALITY,
  GPT_IMAGE_2_1024X1024_USD_BY_QUALITY,
  OPENAI_PRICING_SOURCE_URL,
  OPENAI_USAGE_API_SOURCE,
  OPENAI_WEB_SEARCH_USD_PER_CALL,
  getOpenAiImageCostUsdPerImage,
  getOpenAiTextModelRates,
  getOpenAiWebSearchUsdPerCall,
};
