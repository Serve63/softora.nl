function parsePcmRateFromMime(mimeType) {
  const raw = String(mimeType || '').toLowerCase();
  const match = raw.match(/rate=(\d{3,6})/);
  if (!match) return 24000;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 24000;
}

function buildGeminiSetupPayload({ model = '', voiceName = '', systemPrompt = '', seedInitialHistory = false } = {}) {
  const normalizedModel = String(model || '').trim();
  const normalizedVoiceName = String(voiceName || '').trim();
  const normalizedSystemPrompt = String(systemPrompt || '').replace(/\r/g, '').trim();

  return {
    setup: {
      model: normalizedModel,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: normalizedVoiceName,
            },
          },
        },
      },
      systemInstruction: normalizedSystemPrompt
        ? {
            parts: [{ text: normalizedSystemPrompt }],
          }
        : undefined,
      historyConfig: seedInitialHistory
        ? {
            initialHistoryInClientContent: true,
          }
        : undefined,
    },
  };
}

function buildGeminiInitialClientContentPayload(text) {
  const normalizedText = String(text || '').replace(/\r/g, '').trim();
  if (!normalizedText) return null;
  return {
    clientContent: {
      turns: [{ role: 'user', parts: [{ text: normalizedText }] }],
      turnComplete: true,
    },
  };
}

function buildGeminiInitialRealtimeInputPayload(text) {
  const normalizedText = String(text || '').replace(/\r/g, '').trim();
  if (!normalizedText) return null;
  return {
    realtimeInput: {
      text: normalizedText,
    },
  };
}

function extractInlineAudioParts(payload) {
  const out = [];
  const root = payload && typeof payload === 'object' ? payload : {};
  const serverContent = root.serverContent || root.server_content || {};
  const modelTurn = serverContent.modelTurn || serverContent.model_turn || {};
  const parts = Array.isArray(modelTurn.parts) ? modelTurn.parts : [];
  parts.forEach((part) => {
    if (!part || typeof part !== 'object') return;
    const inline = part.inlineData || part.inline_data;
    if (inline && typeof inline === 'object') {
      const data = String(inline.data || '');
      const mimeType = String(inline.mimeType || inline.mime_type || '');
      if (data) out.push({ data, mimeType });
    }
  });
  return out;
}

module.exports = {
  buildGeminiInitialClientContentPayload,
  buildGeminiInitialRealtimeInputPayload,
  buildGeminiSetupPayload,
  extractInlineAudioParts,
  parsePcmRateFromMime,
};
