function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  const numeric = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function computeInt16Rms(pcm16) {
  if (!(pcm16 instanceof Int16Array) || pcm16.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < pcm16.length; i += 1) {
    const sample = pcm16[i] / 32768;
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / pcm16.length) * 32768;
}

function createSpeechTurnState(options = {}) {
  const rmsThreshold = clampInteger(options.rmsThreshold, 900, 50, 12000);
  const startFrames = clampInteger(options.startFrames, 3, 1, 20);
  const endSilenceMs = clampInteger(options.endSilenceMs, 700, 100, 5000);

  let speechActive = false;
  let consecutiveSpeechFrames = 0;
  let lastSpeechAtMs = 0;

  function processPcmFrame(pcm16, nowMs = Date.now()) {
    const rms = computeInt16Rms(pcm16);
    const hasSpeech = rms >= rmsThreshold;
    let speechStarted = false;
    let speechEnded = false;

    if (hasSpeech) {
      consecutiveSpeechFrames += 1;
      lastSpeechAtMs = nowMs;
    } else if (!speechActive) {
      consecutiveSpeechFrames = 0;
    }

    if (!speechActive && hasSpeech && consecutiveSpeechFrames >= startFrames) {
      speechActive = true;
      speechStarted = true;
    }

    if (speechActive && !hasSpeech && lastSpeechAtMs > 0 && nowMs - lastSpeechAtMs >= endSilenceMs) {
      speechActive = false;
      speechEnded = true;
      consecutiveSpeechFrames = 0;
    }

    return {
      rms,
      hasSpeech,
      speechActive,
      speechStarted,
      speechEnded,
    };
  }

  function reset() {
    speechActive = false;
    consecutiveSpeechFrames = 0;
    lastSpeechAtMs = 0;
  }

  return {
    processPcmFrame,
    reset,
  };
}

module.exports = {
  computeInt16Rms,
  createSpeechTurnState,
};
