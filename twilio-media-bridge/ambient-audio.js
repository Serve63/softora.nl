const fs = require('node:fs');
const path = require('node:path');

const { computeInt16Rms } = require('./audio-turn-state');

const OUTPUT_FRAME_SAMPLES = 160;
const OUTPUT_FRAME_BYTES = OUTPUT_FRAME_SAMPLES * 2;
const OUTPUT_FRAME_DURATION_MS = 20;

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  const numeric = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function resolveAmbientAssetPath(filePath = '') {
  const normalized = String(filePath || '').trim();
  if (normalized) {
    if (path.isAbsolute(normalized)) return normalized;

    const projectRoot = path.dirname(__dirname);
    const prefix = `twilio-media-bridge${path.sep}`;
    const trimmedPrefixPath = normalized.startsWith(prefix)
      ? normalized.slice(prefix.length)
      : normalized;
    const candidates = [
      path.resolve(normalized),
      path.resolve(__dirname, normalized),
      path.resolve(projectRoot, normalized),
    ];

    if (trimmedPrefixPath !== normalized) {
      candidates.push(path.resolve(__dirname, trimmedPrefixPath));
      candidates.push(path.resolve(projectRoot, trimmedPrefixPath));
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }

    return candidates[0];
  }
  return path.join(__dirname, 'assets', 'office-8k.raw');
}

function loadAmbientLoopBuffer(options = {}) {
  const enabled = options.enabled !== false;
  const resolvedPath = resolveAmbientAssetPath(options.filePath);

  if (!enabled) {
    return {
      enabled: false,
      configured: false,
      path: resolvedPath,
      buffer: null,
      bytes: 0,
      durationMs: 0,
      frameCount: 0,
      reason: 'disabled',
    };
  }

  if (!fs.existsSync(resolvedPath)) {
    return {
      enabled: false,
      configured: true,
      path: resolvedPath,
      buffer: null,
      bytes: 0,
      durationMs: 0,
      frameCount: 0,
      reason: 'missing-file',
    };
  }

  let buffer = fs.readFileSync(resolvedPath);
  if (!buffer.length) {
    return {
      enabled: false,
      configured: true,
      path: resolvedPath,
      buffer: null,
      bytes: 0,
      durationMs: 0,
      frameCount: 0,
      reason: 'empty-file',
    };
  }

  if (buffer.length & 1) {
    buffer = buffer.subarray(0, buffer.length - 1);
  }

  const totalSamples = Math.floor(buffer.length / 2);
  return {
    enabled: buffer.length >= OUTPUT_FRAME_BYTES,
    configured: true,
    path: resolvedPath,
    buffer: buffer.length >= OUTPUT_FRAME_BYTES ? buffer : null,
    bytes: buffer.length,
    durationMs: Math.round((totalSamples / 8000) * 1000),
    frameCount: Math.floor(buffer.length / OUTPUT_FRAME_BYTES),
    reason: buffer.length >= OUTPUT_FRAME_BYTES ? 'loaded' : 'too-short',
  };
}

function splitPcmBufferIntoFrames(buffer, frameBytes = OUTPUT_FRAME_BYTES) {
  if (!Buffer.isBuffer(buffer) || buffer.length <= 0) return [];
  const evenLength = buffer.length & ~1;
  const trimmed = evenLength === buffer.length ? buffer : buffer.subarray(0, evenLength);
  if (!trimmed.length) return [];

  const frames = [];
  for (let offset = 0; offset < trimmed.length; offset += frameBytes) {
    const end = Math.min(trimmed.length, offset + frameBytes);
    const frame = Buffer.alloc(frameBytes);
    trimmed.copy(frame, 0, offset, end);
    frames.push(frame);
  }
  return frames;
}

function normalizeAmbientPosition(position, ambientLength) {
  if (!ambientLength) return 0;
  const evenLength = ambientLength & ~1;
  if (!evenLength) return 0;
  const normalized = Math.max(0, Number.isFinite(position) ? Math.floor(position) : 0) & ~1;
  return normalized % evenLength;
}

function mixPcmFrame(voiceFrame, state = {}, options = {}) {
  const frameBytes = clampNumber(options.frameBytes, OUTPUT_FRAME_BYTES, 2, 8192) & ~1;
  const ambientNoiseLevel = clampNumber(options.ambientNoiseLevel, 0.1, 0, 1);
  const ambientDuckLevel = clampNumber(options.ambientDuckLevel, 0.05, 0, 1);
  const ambientBuffer = Buffer.isBuffer(options.ambientBuffer) ? options.ambientBuffer : null;
  const ambientLength = ambientBuffer ? ambientBuffer.length & ~1 : 0;
  const out = Buffer.alloc(frameBytes);
  const gain = state.geminiIsSpeaking ? ambientDuckLevel : ambientNoiseLevel;
  const startPosition = normalizeAmbientPosition(state.ambientPosition, ambientLength);

  for (let offset = 0; offset < frameBytes; offset += 2) {
    const ambient =
      ambientLength > 0
        ? ambientBuffer.readInt16LE((startPosition + offset) % ambientLength)
        : 0;
    const voice =
      Buffer.isBuffer(voiceFrame) && offset + 1 < voiceFrame.length
        ? voiceFrame.readInt16LE(offset)
        : 0;
    const mixed = voice + Math.round(ambient * gain);
    const softClipped = Math.tanh(mixed / 32768) * 32767;
    out.writeInt16LE(Math.round(softClipped), offset);
  }

  if (ambientLength > 0) {
    state.ambientPosition = normalizeAmbientPosition(startPosition + frameBytes, ambientLength);
  } else {
    state.ambientPosition = 0;
  }

  return out;
}

function shouldForwardToGeminiPcmFrame(pcm16, rmsThreshold = 400) {
  return computeInt16Rms(pcm16) >= clampNumber(rmsThreshold, 400, 1, 12000);
}

module.exports = {
  OUTPUT_FRAME_BYTES,
  OUTPUT_FRAME_DURATION_MS,
  OUTPUT_FRAME_SAMPLES,
  loadAmbientLoopBuffer,
  mixPcmFrame,
  resolveAmbientAssetPath,
  shouldForwardToGeminiPcmFrame,
  splitPcmBufferIntoFrames,
};
