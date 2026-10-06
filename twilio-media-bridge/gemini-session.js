const GEMINI_38_MODEL = 'models/gemini-3.8-live';

function resolveGeminiSessionModel(stack, configuredModel) {
  const normalized = String(stack || '').trim().toLowerCase();
  if (['gemini_flash_3_8_live', 'gemini_3_8_live', 'gemini-3.8-live'].includes(normalized)) {
    return GEMINI_38_MODEL;
  }
  return configuredModel;
}

function createGeminiSessionSetupSender({ configuredModel, buildPayload, onSetup = () => {} }) {
  let sent = false;
  return ({ socket, streamSid, stack }) => {
    // Twilio sends its stack in start.customParameters, after the socket upgrade.
    if (sent || !streamSid || !socket || socket.readyState !== 1) return false;
    const model = resolveGeminiSessionModel(stack, configuredModel);
    socket.send(JSON.stringify(buildPayload(model)));
    sent = true;
    onSetup(model);
    return true;
  };
}

module.exports = { GEMINI_38_MODEL, createGeminiSessionSetupSender, resolveGeminiSessionModel };
