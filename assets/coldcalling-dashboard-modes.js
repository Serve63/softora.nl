(function (global) {
  function normalizeBusinessMode(mode) {
    const raw = String(mode || '').trim().toLowerCase();
    if (raw === 'voice_software' || raw === 'voice software' || raw === 'voicesoftware') {
      return 'voice_software';
    }
    if (
      raw === 'business_software' ||
      raw === 'business software' ||
      raw === 'businesssoftware' ||
      raw === 'bedrijfssoftware' ||
      raw === 'bedrijfs_software' ||
      raw === 'bedrijfs software'
    ) {
      return 'business_software';
    }
    return 'websites';
  }

  function normalizeColdcallingStack(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (
      raw === 'gemini_flash_3_1_live' ||
      raw === 'gemini flash 3.1 live' ||
      raw === 'gemini_3_1_live' ||
      raw === 'gemini'
    ) {
      return 'gemini_flash_3_1_live';
    }
    if (
      raw === 'openai_realtime_1_5' ||
      raw === 'openai realtime 1.5' ||
      raw === 'openai_realtime' ||
      raw === 'openai'
    ) {
      return 'openai_realtime_1_5';
    }
    if (
      raw === 'hume_evi_3' ||
      raw === 'hume evi 3' ||
      raw === 'hume_evi' ||
      raw === 'hume'
    ) {
      return 'hume_evi_3';
    }
    return 'retell_ai';
  }

  function getColdcallingStackLabel(value) {
    const normalized = normalizeColdcallingStack(value);
    if (normalized === 'gemini_flash_3_1_live') return 'Gemini 3.1 Live';
    if (normalized === 'openai_realtime_1_5') return 'OpenAI Realtime 1.5';
    if (normalized === 'hume_evi_3') return 'Hume Evi 3';
    return 'Retell AI';
  }

  const modes = Object.freeze({
    normalizeBusinessMode,
    normalizeColdcallingStack,
    getColdcallingStackLabel,
  });

  global.SoftoraColdcallingDashboardModes = modes;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = modes;
  }
})(typeof window !== 'undefined' ? window : globalThis);
