function normalizeModel(modelRaw) {
  return String(modelRaw || '').trim().toLowerCase();
}

function isGptImageGenerationModel(modelRaw) {
  const model = normalizeModel(modelRaw);
  return /^gpt-image-/.test(model) || model === 'chatgpt-image-latest';
}

function isSupportedOpenAiImageModel(modelRaw) {
  const model = normalizeModel(modelRaw);
  return (
    /^gpt-image-(?:1(?:\.5)?|1-mini|2|2\.5-(?:sunburst|flare)(?:-2026-09-08)?)$/.test(model) ||
    model === 'chatgpt-image-latest' ||
    /^dall-e-[23]$/.test(model)
  );
}

function requiresLegacyOpenAiImageResponseFormat(modelRaw) {
  return /^dall-e-[23]$/.test(normalizeModel(modelRaw));
}

function supportsOpenAiReferenceImageEdits(modelRaw) {
  return isGptImageGenerationModel(modelRaw);
}

function supportsOpenAiInputFidelity(modelRaw) {
  return /^gpt-image-1(?:\.5|-mini)?$/.test(normalizeModel(modelRaw)) || normalizeModel(modelRaw) === 'chatgpt-image-latest';
}

function normalizeOpenAiImageGenerationQuality(valueRaw, modelRaw) {
  const quality = normalizeModel(valueRaw);
  const options = ['low', 'medium', 'high', 'auto'];
  if (/^gpt-image-2\.5-(?:sunburst|flare)(?:-2026-09-08)?$/.test(normalizeModel(modelRaw))) {
    options.push('xhigh', 'max');
  }
  return options.includes(quality) ? quality : 'low';
}

module.exports = {
  normalizeOpenAiImageGenerationQuality,
  isSupportedOpenAiImageModel,
  requiresLegacyOpenAiImageResponseFormat,
  supportsOpenAiInputFidelity,
  supportsOpenAiReferenceImageEdits,
};
