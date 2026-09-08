// Standard Image API token rates, checked 2026-09-08. This is the image
// request's usage-based cost, not an invoice total including tax or FX.
const SOURCE = 'https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency';
const RATES = Object.freeze({ text: 5, cachedText: 1.25, image: 8, cachedImage: 2, output: 30 });
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const details = usage.input_tokens_details || {};
  const cached = details.cached_tokens_details || {};
  const input = count(usage.input_tokens), output = count(usage.output_tokens);
  const text = count(details.text_tokens), image = count(details.image_tokens);
  if ([input, output, text, image].includes(null) || text + image !== input) return null;
  const cachedTotal = count(details.cached_tokens ?? 0);
  let cachedText = count(cached.text_tokens ?? (cachedTotal === 0 ? 0 : null));
  let cachedImage = count(cached.image_tokens ?? (cachedTotal === 0 ? 0 : null));
  // A single input modality makes an aggregate cache count unambiguous.
  if (cachedTotal !== null && image === 0) { cachedText = cachedTotal; cachedImage = 0; }
  if (cachedTotal !== null && text === 0) { cachedImage = cachedTotal; cachedText = 0; }
  if ([cachedTotal, cachedText, cachedImage].includes(null) || cachedText > text || cachedImage > image || cachedText + cachedImage !== cachedTotal) return null;
  return {
    input_tokens: input, output_tokens: output,
    input_tokens_details: { text_tokens: text, image_tokens: image, cached_tokens: cachedTotal,
      cached_tokens_details: { text_tokens: cachedText, image_tokens: cachedImage } },
  };
}

function buildWebsiteImageGenerationMetadata(payload = {}) {
  const model = String(payload.model || '').trim().slice(0, 100);
  if (!model) return null;
  const usage = normalizeUsage(payload.usage);
  let cost = null;
  if (/^gpt-image-2\.5-(sunburst|flare)(-\d{4}-\d{2}-\d{2})?$/.test(model) && usage) {
    const d = usage.input_tokens_details, c = d.cached_tokens_details;
    const amountUsd = ((d.text_tokens - c.text_tokens) * RATES.text + c.text_tokens * RATES.cachedText +
      (d.image_tokens - c.image_tokens) * RATES.image + c.image_tokens * RATES.cachedImage + usage.output_tokens * RATES.output) / 1e6;
    cost = { amountUsd: Number(amountUsd.toFixed(8)), currency: 'USD', basis: 'reported-image-usage',
      excludes: 'tax-and-currency-conversion', source: SOURCE, ratesDate: '2026-09-08' };
  }
  return { model, quality: String(payload.quality || '').slice(0, 20), size: String(payload.size || '').slice(0, 30), usage, cost };
}

module.exports = { buildWebsiteImageGenerationMetadata };
