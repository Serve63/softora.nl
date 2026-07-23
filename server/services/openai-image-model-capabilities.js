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
    /^gpt-image-(?:1(?:\.5)?|1-mini|2)$/.test(model) ||
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
  return isGptImageGenerationModel(modelRaw) && normalizeModel(modelRaw) !== 'gpt-image-2';
}

module.exports = {
  isSupportedOpenAiImageModel,
  requiresLegacyOpenAiImageResponseFormat,
  supportsOpenAiInputFidelity,
  supportsOpenAiReferenceImageEdits,
};
