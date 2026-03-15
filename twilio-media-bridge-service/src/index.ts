import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

type JsonObject = Record<string, unknown>;
type LogLevel = 'INFO' | 'WARN' | 'ERROR';

type BridgeSession = {
  connectionId: number;
  twilioWs: WebSocket;
  streamSid: string;
  callSid: string;
  elevenWs: WebSocket | null;
  elevenConnecting: boolean;
  elevenConnectAttempts: number;
  elevenUnavailable: boolean;
  hasReceivedAgentAudio: boolean;
  lastAgentAudioAtMs: number;
  agentSpeaking: boolean;
  ambienceActive: boolean;
  ambienceFrameIndex: number;
  agentSilenceTimer: NodeJS.Timeout | null;
  twilioOutboundPlayoutTimer: NodeJS.Timeout | null;
  twilioOutboundPlayoutNextAtMs: number;
  twilioOutboundAudioQueue: string[];
  twilioOutboundQueueHighWater: number;
  twilioAgentWarmupActive: boolean;
  twilioAgentWarmupUntilMs: number;
  twilioMediaReceived: number;
  twilioMediaOutboundIgnored: number;
  twilioToElevenAudioSent: number;
  elevenToTwilioAudioSent: number;
  ambienceToTwilioAudioSent: number;
  droppedTwilioToElevenAudio: number;
  droppedElevenToTwilioAudio: number;
  droppedElevenToTwilioLatencyAudio: number;
  droppedAmbienceToTwilioAudio: number;
  droppedAmbienceSuppressionAudio: number;
  droppedEchoGuardAudio: number;
  mediaStatsLastLoggedAtMs: number;
  bufferedUserAudioChunks: string[];
  suppressedInboundAudioPrebuffer: string[];
  inboundNoiseFloorRms: number;
  consecutiveLikelySpeechFrames: number;
  callerSpeechPassthroughUntilMs: number;
  echoGuardBypassUntilMs: number;
  lastCallerSpeechForwardedAtMs: number;
  stopping: boolean;
};

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3000;
const WS_PATH = '/twilio-media';
const MAX_BUFFERED_TWILIO_AUDIO_CHUNKS = 80;
const MAX_PREFLUSH_TWILIO_AUDIO_CHUNKS = 20;
const TWILIO_MEDIA_CHUNK_MS = 20;
const TWILIO_ULAW_8K_CHUNK_BYTES = 160;
const AGENT_SILENCE_TO_AMBIENCE_MS = Math.max(
  200,
  Math.floor(parseNumberEnv(process.env.AGENT_SILENCE_TO_AMBIENCE_MS, 1400, 200))
);
const INITIAL_AMBIENCE_DELAY_MS = 3500;
const AMBIENCE_AFTER_CALLER_SPEECH_COOLDOWN_MS = Math.max(
  0,
  Math.floor(parseNumberEnv(process.env.AMBIENCE_AFTER_CALLER_SPEECH_COOLDOWN_MS, 1200, 0))
);
const AGENT_ECHO_GUARD_MS = parseNumberEnv(process.env.AGENT_ECHO_GUARD_MS, 320, 0);
const AGENT_ECHO_GUARD_SPEECH_BYPASS_ENABLED = parseBooleanEnv(process.env.AGENT_ECHO_GUARD_SPEECH_BYPASS_ENABLED, true);
const AGENT_ECHO_GUARD_SPEECH_BYPASS_RMS_THRESHOLD = parseNumberEnv(
  process.env.AGENT_ECHO_GUARD_SPEECH_BYPASS_RMS_THRESHOLD,
  1300,
  100
);
const AGENT_ECHO_GUARD_SPEECH_BYPASS_PEAK_THRESHOLD = parseNumberEnv(
  process.env.AGENT_ECHO_GUARD_SPEECH_BYPASS_PEAK_THRESHOLD,
  4600,
  500
);
const AGENT_ECHO_GUARD_BYPASS_WINDOW_MS = Math.max(
  0,
  Math.floor(parseNumberEnv(process.env.AGENT_ECHO_GUARD_BYPASS_WINDOW_MS, 900, 0))
);
const MEDIA_STATS_LOG_INTERVAL_MS = 3000;
const TWILIO_OUTBOUND_AGENT_QUEUE_MAX_CHUNKS = Math.max(
  10,
  Math.floor(parseNumberEnv(process.env.TWILIO_OUTBOUND_AGENT_QUEUE_MAX_CHUNKS, 180, 10))
);
const TWILIO_OUTBOUND_AGENT_MAX_LAG_CHUNKS = Math.max(
  4,
  Math.floor(parseNumberEnv(process.env.TWILIO_OUTBOUND_AGENT_MAX_LAG_CHUNKS, 40, 4))
);
const TWILIO_OUTBOUND_AGENT_JITTER_TARGET_CHUNKS = Math.max(
  1,
  Math.floor(parseNumberEnv(process.env.TWILIO_OUTBOUND_AGENT_JITTER_TARGET_CHUNKS, 1, 1))
);
const TWILIO_OUTBOUND_AGENT_JITTER_MAX_WAIT_MS = Math.max(
  0,
  Math.floor(parseNumberEnv(process.env.TWILIO_OUTBOUND_AGENT_JITTER_MAX_WAIT_MS, 0, 0))
);
const TWILIO_OUTBOUND_MAX_FRAMES_PER_TICK = Math.max(
  1,
  Math.floor(parseNumberEnv(process.env.TWILIO_OUTBOUND_MAX_FRAMES_PER_TICK, 1, 1))
);
const MAX_ELEVEN_WS_BUFFERED_BYTES = 128 * 1024;
const MAX_TWILIO_WS_BUFFERED_BYTES = 128 * 1024;
const ELEVENLABS_AGENT_ID = normalizeString(process.env.ELEVENLABS_AGENT_ID);
const ELEVENLABS_API_KEY = normalizeString(process.env.ELEVENLABS_API_KEY);
const ELEVENLABS_API_BASE_URL = normalizeString(process.env.ELEVENLABS_API_BASE_URL || 'https://api.elevenlabs.io');
const AMBIENCE_ENABLED = parseBooleanEnv(process.env.AMBIENCE_ENABLED, false);
const AMBIENCE_FILE_PATH = normalizeString(process.env.AMBIENCE_FILE_PATH);
const AMBIENCE_ALWAYS_ON = parseBooleanEnv(process.env.AMBIENCE_ALWAYS_ON, true);
const AMBIENCE_BASE_GAIN = clampNumber(parseNumberEnv(process.env.AMBIENCE_BASE_GAIN, 0.22, 0), 0, 2);
const AMBIENCE_UNDER_AGENT_GAIN = clampNumber(
  parseNumberEnv(process.env.AMBIENCE_UNDER_AGENT_GAIN, 1, 0),
  0,
  2
);
const AMBIENCE_INBOUND_SUPPRESSION_ENABLED = parseBooleanEnv(process.env.AMBIENCE_INBOUND_SUPPRESSION_ENABLED, true);
const AMBIENCE_INBOUND_SPEECH_ABSOLUTE_RMS_THRESHOLD = parseNumberEnv(
  process.env.AMBIENCE_INBOUND_SPEECH_ABSOLUTE_RMS_THRESHOLD,
  1150,
  100
);
const AMBIENCE_INBOUND_SPEECH_PEAK_THRESHOLD = parseNumberEnv(
  process.env.AMBIENCE_INBOUND_SPEECH_PEAK_THRESHOLD,
  4200,
  500
);
const AMBIENCE_INBOUND_SPEECH_NOISE_MULTIPLIER = parseNumberEnv(
  process.env.AMBIENCE_INBOUND_SPEECH_NOISE_MULTIPLIER,
  2.2,
  1
);
const AMBIENCE_INBOUND_SPEECH_MIN_CONSECUTIVE_FRAMES = Math.max(
  1,
  Math.floor(parseNumberEnv(process.env.AMBIENCE_INBOUND_SPEECH_MIN_CONSECUTIVE_FRAMES, 2, 1))
);
const AMBIENCE_INBOUND_SUPPRESSION_PREROLL_MAX_CHUNKS = Math.max(
  0,
  Math.floor(parseNumberEnv(process.env.AMBIENCE_INBOUND_SUPPRESSION_PREROLL_MAX_CHUNKS, 12, 0))
);
const AMBIENCE_INBOUND_SPEECH_PASSTHROUGH_MS = Math.max(
  0,
  Math.floor(parseNumberEnv(process.env.AMBIENCE_INBOUND_SPEECH_PASSTHROUGH_MS, 1400, 0))
);
const AMBIENCE_NOISE_FLOOR_RMS_INITIAL = parseNumberEnv(process.env.AMBIENCE_NOISE_FLOOR_RMS_INITIAL, 250, 10);

let connectionCounter = 0;
let ambienceMuLawAudio: Buffer | null = null;
let ambienceMuLawFrames: Buffer[] = [];
let ambienceMuLawFramesBase64: string[] = [];
let ambienceDisabledReason = '';
const ULAW_DECODE_TABLE = buildMuLawDecodeTable();
const ULAW_ENCODE_TABLE = buildMuLawEncodeTable();

function log(level: LogLevel, message: string, meta?: JsonObject): void {
  const ts = new Date().toISOString();
  if (meta && Object.keys(meta).length > 0) {
    console.log(`[${ts}] [${level}] ${message}`, meta);
    return;
  }
  console.log(`[${ts}] [${level}] ${message}`);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseBooleanEnv(value: unknown, fallback: boolean): boolean {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumberEnv(value: unknown, fallback: number, minValue = Number.NEGATIVE_INFINITY): number {
  const normalized = normalizeString(value);
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < minValue) return fallback;
  return parsed;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function decodeMuLawSample(sample: number): number {
  const muLaw = (~sample) & 0xff;
  const sign = muLaw & 0x80;
  const exponent = (muLaw >> 4) & 0x07;
  const mantissa = muLaw & 0x0f;
  let linear = ((mantissa << 3) + 0x84) << exponent;
  linear -= 0x84;
  return sign ? -linear : linear;
}

function encodeMuLawSample(sample: number): number {
  const MU_LAW_BIAS = 0x84;
  const MU_LAW_CLIP = 32635;
  let pcm = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = pcm < 0 ? 0x80 : 0x00;
  if (pcm < 0) pcm = -pcm;
  if (pcm > MU_LAW_CLIP) pcm = MU_LAW_CLIP;
  pcm += MU_LAW_BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; expMask >>= 1) {
    exponent -= 1;
  }
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

function buildMuLawDecodeTable(): Int16Array {
  const table = new Int16Array(256);
  for (let i = 0; i < table.length; i += 1) {
    table[i] = decodeMuLawSample(i);
  }
  return table;
}

function buildMuLawEncodeTable(): Uint8Array {
  const table = new Uint8Array(65_536);
  for (let i = 0; i < table.length; i += 1) {
    table[i] = encodeMuLawSample(i - 32_768);
  }
  return table;
}

function encodeMuLawSampleFast(sample: number): number {
  const clamped = Math.max(-32_768, Math.min(32_767, Math.round(sample)));
  return ULAW_ENCODE_TABLE[clamped + 32_768];
}

function applyGainToMuLawBuffer(source: Buffer, gain: number): Buffer {
  if (!source.length) return Buffer.alloc(0);
  const safeGain = clampNumber(gain, 0, 2);
  if (safeGain === 1) return Buffer.from(source);

  const output = Buffer.allocUnsafe(source.length);
  for (let i = 0; i < source.length; i += 1) {
    const pcm = ULAW_DECODE_TABLE[source[i]];
    output[i] = encodeMuLawSampleFast(pcm * safeGain);
  }
  return output;
}

function mixMuLawWithAmbience(primaryBase64: string, ambienceFrame: Buffer, ambienceGain: number): string {
  if (!primaryBase64 || !ambienceFrame.length) return primaryBase64;
  const safeGain = clampNumber(ambienceGain, 0, 2);
  if (safeGain <= 0) return primaryBase64;

  const primary = Buffer.from(primaryBase64, 'base64');
  if (!primary.length) return primaryBase64;

  const output = Buffer.allocUnsafe(primary.length);
  const mixLength = Math.min(primary.length, ambienceFrame.length);
  for (let i = 0; i < mixLength; i += 1) {
    const basePcm = ULAW_DECODE_TABLE[primary[i]];
    const ambiencePcm = ULAW_DECODE_TABLE[ambienceFrame[i]];
    output[i] = encodeMuLawSampleFast(basePcm + ambiencePcm * safeGain);
  }
  for (let i = mixLength; i < primary.length; i += 1) {
    output[i] = primary[i];
  }
  return output.toString('base64');
}

function analyzeMuLawAudioLevels(audioBase64: string): { rms: number; peak: number } | null {
  if (!audioBase64) return null;

  const audio = Buffer.from(audioBase64, 'base64');
  if (!audio.length) return null;

  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < audio.length; i += 1) {
    const sample = ULAW_DECODE_TABLE[audio[i]];
    const abs = sample < 0 ? -sample : sample;
    sumSquares += sample * sample;
    if (abs > peak) peak = abs;
  }

  return {
    rms: Math.sqrt(sumSquares / audio.length),
    peak,
  };
}

function levelsPassAbsoluteSpeechThreshold(
  levels: { rms: number; peak: number } | null,
  rmsThreshold: number,
  peakThreshold: number
): boolean {
  if (!levels) return false;
  return levels.rms >= rmsThreshold && levels.peak >= peakThreshold;
}

function isLikelyCallerSpeechFrame(session: BridgeSession, audioBase64: string): boolean {
  const levels = analyzeMuLawAudioLevels(audioBase64);
  if (!levels) {
    session.consecutiveLikelySpeechFrames = 0;
    return true;
  }

  const dynamicRmsThreshold = Math.max(
    AMBIENCE_INBOUND_SPEECH_ABSOLUTE_RMS_THRESHOLD,
    session.inboundNoiseFloorRms * AMBIENCE_INBOUND_SPEECH_NOISE_MULTIPLIER
  );
  const isSpeechFrame = levelsPassAbsoluteSpeechThreshold(
    levels,
    dynamicRmsThreshold,
    AMBIENCE_INBOUND_SPEECH_PEAK_THRESHOLD
  );

  if (isSpeechFrame) {
    session.consecutiveLikelySpeechFrames += 1;
    return session.consecutiveLikelySpeechFrames >= AMBIENCE_INBOUND_SPEECH_MIN_CONSECUTIVE_FRAMES;
  }

  session.consecutiveLikelySpeechFrames = 0;
  session.inboundNoiseFloorRms = clampNumber(
    session.inboundNoiseFloorRms * 0.9 + levels.rms * 0.1,
    50,
    10_000
  );
  return false;
}

function resolveAmbiencePath(filePath: string): string {
  if (!filePath) return '';
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function setNoDelay(socket: unknown): void {
  try {
    const candidate = socket as { setNoDelay?: (noDelay?: boolean) => void } | null;
    if (candidate && typeof candidate.setNoDelay === 'function') {
      candidate.setNoDelay(true);
    }
  } catch {
    // Ignore socket tuning failures; not critical for call flow.
  }
}

function getLoopingChunk(source: Buffer, offset: number, size: number): { chunk: Buffer; nextOffset: number } {
  if (source.length === 0) {
    return { chunk: Buffer.alloc(0), nextOffset: 0 };
  }

  const chunk = Buffer.alloc(size);
  let writeOffset = 0;
  let readOffset = offset % source.length;
  while (writeOffset < size) {
    const remainingSource = source.length - readOffset;
    const remainingChunk = size - writeOffset;
    const copySize = Math.min(remainingSource, remainingChunk);
    source.copy(chunk, writeOffset, readOffset, readOffset + copySize);
    writeOffset += copySize;
    readOffset = (readOffset + copySize) % source.length;
  }

  return { chunk, nextOffset: readOffset };
}

function buildLoopingMuLawFramesBase64(source: Buffer, frameBytes: number): string[] {
  if (!source.length || frameBytes <= 0) return [];
  const frameCount = Math.max(1, Math.ceil(source.length / frameBytes));
  const frames: string[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    const offset = (i * frameBytes) % source.length;
    const { chunk } = getLoopingChunk(source, offset, frameBytes);
    frames.push(chunk.toString('base64'));
  }
  return frames;
}

function buildLoopingMuLawFrames(source: Buffer, frameBytes: number): Buffer[] {
  if (!source.length || frameBytes <= 0) return [];
  const frameCount = Math.max(1, Math.ceil(source.length / frameBytes));
  const frames: Buffer[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    const offset = (i * frameBytes) % source.length;
    const { chunk } = getLoopingChunk(source, offset, frameBytes);
    frames.push(chunk);
  }
  return frames;
}

function loadAmbienceMuLawAudioBuffer(): void {
  ambienceMuLawAudio = null;
  ambienceMuLawFrames = [];
  ambienceMuLawFramesBase64 = [];
  ambienceDisabledReason = '';

  if (!AMBIENCE_ENABLED) {
    ambienceDisabledReason = 'AMBIENCE_ENABLED=false';
    log('INFO', 'ambience disabled', { reason: ambienceDisabledReason });
    return;
  }

  if (!AMBIENCE_FILE_PATH) {
    ambienceDisabledReason = 'AMBIENCE_FILE_PATH ontbreekt';
    log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
    return;
  }

  const resolvedPath = resolveAmbiencePath(AMBIENCE_FILE_PATH);
  if (!existsSync(resolvedPath)) {
    ambienceDisabledReason = `ambience file niet gevonden: ${resolvedPath}`;
    log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
    return;
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  if (extension === '.mulaw' || extension === '.ulaw' || extension === '.g711u') {
    try {
      const directBuffer = readFileSync(resolvedPath);
      if (!directBuffer.length) {
        ambienceDisabledReason = 'ambience file is leeg';
        log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
        return;
      }
      const normalizedAmbienceBuffer = applyGainToMuLawBuffer(directBuffer, AMBIENCE_BASE_GAIN);
      ambienceMuLawAudio = normalizedAmbienceBuffer;
      ambienceMuLawFrames = buildLoopingMuLawFrames(normalizedAmbienceBuffer, TWILIO_ULAW_8K_CHUNK_BYTES);
      ambienceMuLawFramesBase64 = ambienceMuLawFrames.map((frame) => frame.toString('base64'));
      if (!ambienceMuLawFrames.length || !ambienceMuLawFramesBase64.length) {
        ambienceDisabledReason = 'raw ambience kon niet naar frames worden opgebouwd';
        ambienceMuLawAudio = null;
        ambienceMuLawFrames = [];
        log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
        return;
      }
      log('INFO', 'ambience loaded (raw mulaw)', {
        bytes: normalizedAmbienceBuffer.length,
        frames: ambienceMuLawFramesBase64.length,
        filePath: resolvedPath,
        appliedGain: AMBIENCE_BASE_GAIN,
      });
      return;
    } catch (error) {
      ambienceDisabledReason = `raw ambience read mislukt: ${
        error instanceof Error ? error.message : String(error)
      }`;
      log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
      return;
    }
  }

  const converted = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      resolvedPath,
      '-ac',
      '1',
      '-ar',
      '8000',
      '-f',
      'mulaw',
      'pipe:1',
    ],
    {
      encoding: 'buffer',
      maxBuffer: 50 * 1024 * 1024,
    }
  );

  if (converted.error) {
    ambienceDisabledReason = `ffmpeg start mislukt: ${converted.error.message}`;
    log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
    return;
  }

  if (converted.status !== 0) {
    const stderrText = Buffer.isBuffer(converted.stderr) ? converted.stderr.toString('utf8').slice(0, 400) : '';
    ambienceDisabledReason = `ffmpeg convert failed (exit ${converted.status}): ${stderrText || 'unknown error'}`;
    log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
    return;
  }

  const output = Buffer.isBuffer(converted.stdout) ? converted.stdout : Buffer.alloc(0);
  if (!output.length) {
    ambienceDisabledReason = 'ffmpeg gaf geen audio output';
    log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
    return;
  }

  const normalizedAmbienceBuffer = applyGainToMuLawBuffer(output, AMBIENCE_BASE_GAIN);
  ambienceMuLawAudio = normalizedAmbienceBuffer;
  ambienceMuLawFrames = buildLoopingMuLawFrames(normalizedAmbienceBuffer, TWILIO_ULAW_8K_CHUNK_BYTES);
  ambienceMuLawFramesBase64 = ambienceMuLawFrames.map((frame) => frame.toString('base64'));
  if (!ambienceMuLawFrames.length || !ambienceMuLawFramesBase64.length) {
    ambienceDisabledReason = 'converted ambience kon niet naar frames worden opgebouwd';
    ambienceMuLawAudio = null;
    ambienceMuLawFrames = [];
    log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
    return;
  }
  log('INFO', 'ambience loaded (converted to mulaw/8000/mono)', {
    bytes: normalizedAmbienceBuffer.length,
    frames: ambienceMuLawFramesBase64.length,
    sourceFilePath: resolvedPath,
    appliedGain: AMBIENCE_BASE_GAIN,
  });
}

function clearAgentSilenceTimer(session: BridgeSession): void {
  if (!session.agentSilenceTimer) return;
  clearTimeout(session.agentSilenceTimer);
  session.agentSilenceTimer = null;
}

function clearTwilioOutboundPlayoutTimer(session: BridgeSession): void {
  if (!session.twilioOutboundPlayoutTimer) return;
  clearTimeout(session.twilioOutboundPlayoutTimer);
  session.twilioOutboundPlayoutTimer = null;
}

function pullNextAmbienceFrame(
  session: BridgeSession
): { frameBytes: Buffer; frameBase64: string } | null {
  if (!session.ambienceActive) return null;
  if (
    !ambienceMuLawAudio ||
    ambienceMuLawAudio.length === 0 ||
    ambienceMuLawFrames.length === 0 ||
    ambienceMuLawFramesBase64.length === 0
  ) {
    stopAmbience(session, 'ambience_unavailable');
    return null;
  }
  if (session.ambienceFrameIndex < 0 || session.ambienceFrameIndex >= ambienceMuLawFrames.length) {
    session.ambienceFrameIndex = 0;
  }
  const frameBytes = ambienceMuLawFrames[session.ambienceFrameIndex] || Buffer.alloc(0);
  const frameBase64 = ambienceMuLawFramesBase64[session.ambienceFrameIndex] || '';
  session.ambienceFrameIndex = (session.ambienceFrameIndex + 1) % ambienceMuLawFrames.length;
  if (!frameBytes.length || !frameBase64) return null;
  return { frameBytes, frameBase64 };
}

function getNextTwilioOutboundFrame(
  session: BridgeSession,
  nowMs: number
): { payloadBase64: string; source: 'agent' | 'ambience' } | null {
  if (session.twilioOutboundAudioQueue.length > 0) {
    if (session.twilioAgentWarmupActive) {
      const warmupSatisfied =
        session.twilioOutboundAudioQueue.length >= TWILIO_OUTBOUND_AGENT_JITTER_TARGET_CHUNKS ||
        nowMs >= session.twilioAgentWarmupUntilMs;
      if (!warmupSatisfied) {
        return null;
      }
      session.twilioAgentWarmupActive = false;
      session.twilioAgentWarmupUntilMs = 0;
    }
    const agentPayloadBase64 = session.twilioOutboundAudioQueue.shift() || '';
    if (!agentPayloadBase64) return null;
    if (AMBIENCE_ALWAYS_ON && session.ambienceActive) {
      const ambienceFrame = pullNextAmbienceFrame(session);
      if (ambienceFrame) {
        const mixedPayloadBase64 = mixMuLawWithAmbience(
          agentPayloadBase64,
          ambienceFrame.frameBytes,
          AMBIENCE_UNDER_AGENT_GAIN
        );
        return {
          payloadBase64: mixedPayloadBase64 || agentPayloadBase64,
          source: 'agent',
        };
      }
    }
    return { payloadBase64: agentPayloadBase64, source: 'agent' };
  }

  if (session.twilioAgentWarmupActive) {
    session.twilioAgentWarmupActive = false;
    session.twilioAgentWarmupUntilMs = 0;
  }

  const ambienceFrame = pullNextAmbienceFrame(session);
  if (!ambienceFrame) return null;
  return { payloadBase64: ambienceFrame.frameBase64, source: 'ambience' };
}

function scheduleTwilioOutboundPlayoutTick(session: BridgeSession, delayMs: number): void {
  if (session.stopping) return;
  clearTwilioOutboundPlayoutTimer(session);
  session.twilioOutboundPlayoutTimer = setTimeout(() => {
    session.twilioOutboundPlayoutTimer = null;
    runTwilioOutboundPlayoutTick(session);
  }, Math.max(0, delayMs));
}

function runTwilioOutboundPlayoutTick(session: BridgeSession): void {
  if (session.stopping) return;
  if (!session.streamSid || session.twilioWs.readyState !== WebSocket.OPEN) return;

  const nowMs = Date.now();
  if (session.twilioOutboundPlayoutNextAtMs <= 0) {
    session.twilioOutboundPlayoutNextAtMs = nowMs;
  }
  if (session.twilioOutboundPlayoutNextAtMs < nowMs - TWILIO_MEDIA_CHUNK_MS * 6) {
    session.twilioOutboundPlayoutNextAtMs = nowMs;
  }

  let framesToProcess = 1;
  if (
    TWILIO_OUTBOUND_MAX_FRAMES_PER_TICK > 1 &&
    session.twilioOutboundAudioQueue.length > TWILIO_OUTBOUND_AGENT_JITTER_TARGET_CHUNKS
  ) {
    const behindFrames = Math.floor((nowMs - session.twilioOutboundPlayoutNextAtMs) / TWILIO_MEDIA_CHUNK_MS);
    if (behindFrames > 0) {
      framesToProcess = Math.min(TWILIO_OUTBOUND_MAX_FRAMES_PER_TICK, 1 + behindFrames);
    }
  }

  let framesAdvanced = 0;
  for (let i = 0; i < framesToProcess; i += 1) {
    const frame = getNextTwilioOutboundFrame(session, nowMs);
    if (!frame) break;
    framesAdvanced += 1;
    if (session.twilioWs.bufferedAmount > MAX_TWILIO_WS_BUFFERED_BYTES) {
      if (frame.source === 'agent') {
        session.droppedElevenToTwilioAudio += 1;
      } else {
        session.droppedAmbienceToTwilioAudio += 1;
      }
      flushMediaStatsIfDue(session);
      continue;
    }
    const ok = sendTwilioMediaToSocket(session, frame.payloadBase64);
    if (!ok) {
      if (frame.source === 'ambience') {
        stopAmbience(session, 'twilio_send_failed');
      } else {
        session.droppedElevenToTwilioAudio += 1;
        flushMediaStatsIfDue(session);
      }
      continue;
    }
    if (frame.source === 'agent') {
      session.elevenToTwilioAudioSent += 1;
      flushMediaStatsIfDue(session);
    } else {
      session.ambienceToTwilioAudioSent += 1;
      flushMediaStatsIfDue(session);
    }
  }

  const shouldContinuePlayout = session.ambienceActive || session.twilioOutboundAudioQueue.length > 0;
  if (!shouldContinuePlayout) {
    session.twilioOutboundPlayoutNextAtMs = Date.now();
    return;
  }

  session.twilioOutboundPlayoutNextAtMs += TWILIO_MEDIA_CHUNK_MS * Math.max(1, framesAdvanced);
  if (session.twilioOutboundPlayoutNextAtMs < Date.now() - TWILIO_MEDIA_CHUNK_MS * 2) {
    session.twilioOutboundPlayoutNextAtMs = Date.now() + TWILIO_MEDIA_CHUNK_MS;
  }
  const nextDelayMs = Math.max(0, session.twilioOutboundPlayoutNextAtMs - Date.now());
  scheduleTwilioOutboundPlayoutTick(session, nextDelayMs);
}

function ensureTwilioOutboundPlayoutRunning(session: BridgeSession): void {
  if (session.stopping || session.twilioWs.readyState !== WebSocket.OPEN || !session.streamSid) return;
  if (session.twilioOutboundPlayoutTimer) return;
  if (session.twilioOutboundPlayoutNextAtMs <= 0) {
    session.twilioOutboundPlayoutNextAtMs = Date.now();
  }
  scheduleTwilioOutboundPlayoutTick(session, 0);
}

function stopAmbience(session: BridgeSession, reason: string): void {
  if (!session.ambienceActive) return;
  session.ambienceActive = false;
  log('INFO', 'ambience stopped', {
    connectionId: session.connectionId,
    streamSid: session.streamSid,
    callSid: session.callSid,
    reason,
  });
}

function startAmbience(session: BridgeSession, reason: string): void {
  if (session.stopping || session.ambienceActive) return;
  if (
    !AMBIENCE_ENABLED ||
    !ambienceMuLawAudio ||
    ambienceMuLawAudio.length === 0 ||
    ambienceMuLawFrames.length === 0 ||
    ambienceMuLawFramesBase64.length === 0
  ) {
    return;
  }
  if (!session.streamSid || session.twilioWs.readyState !== WebSocket.OPEN) {
    return;
  }

  session.ambienceActive = true;
  if (session.ambienceFrameIndex < 0 || session.ambienceFrameIndex >= ambienceMuLawFrames.length) {
    session.ambienceFrameIndex = 0;
  }

  log('INFO', 'ambience started', {
    connectionId: session.connectionId,
    streamSid: session.streamSid,
    callSid: session.callSid,
    reason,
  });
  ensureTwilioOutboundPlayoutRunning(session);
}

function scheduleAmbienceStartOnSilence(
  session: BridgeSession,
  reason: string,
  delayMs = AGENT_SILENCE_TO_AMBIENCE_MS
): void {
  if (AMBIENCE_ALWAYS_ON) {
    startAmbience(session, reason);
    return;
  }
  clearAgentSilenceTimer(session);
  if (session.stopping) return;
  session.agentSilenceTimer = setTimeout(() => {
    session.agentSilenceTimer = null;
    if (AMBIENCE_AFTER_CALLER_SPEECH_COOLDOWN_MS > 0 && session.lastCallerSpeechForwardedAtMs > 0) {
      const elapsedSinceCallerSpeechMs = Date.now() - session.lastCallerSpeechForwardedAtMs;
      if (elapsedSinceCallerSpeechMs < AMBIENCE_AFTER_CALLER_SPEECH_COOLDOWN_MS) {
        const remainingMs = AMBIENCE_AFTER_CALLER_SPEECH_COOLDOWN_MS - elapsedSinceCallerSpeechMs;
        scheduleAmbienceStartOnSilence(session, reason, Math.max(TWILIO_MEDIA_CHUNK_MS, remainingMs));
        return;
      }
    }
    session.agentSpeaking = false;
    startAmbience(session, reason);
  }, delayMs);
}

function cleanupSessionState(session: BridgeSession, reason: string): void {
  clearAgentSilenceTimer(session);
  stopAmbience(session, reason);
  clearTwilioOutboundPlayoutTimer(session);
  session.twilioOutboundAudioQueue.length = 0;
  session.twilioAgentWarmupActive = false;
  session.twilioAgentWarmupUntilMs = 0;
  session.lastCallerSpeechForwardedAtMs = 0;
}

function resetMediaStatsCounters(session: BridgeSession): void {
  session.twilioMediaReceived = 0;
  session.twilioMediaOutboundIgnored = 0;
  session.twilioToElevenAudioSent = 0;
  session.elevenToTwilioAudioSent = 0;
  session.ambienceToTwilioAudioSent = 0;
  session.droppedTwilioToElevenAudio = 0;
  session.droppedElevenToTwilioAudio = 0;
  session.droppedElevenToTwilioLatencyAudio = 0;
  session.droppedAmbienceToTwilioAudio = 0;
  session.droppedAmbienceSuppressionAudio = 0;
  session.droppedEchoGuardAudio = 0;
  session.twilioOutboundQueueHighWater = session.twilioOutboundAudioQueue.length;
}

function flushMediaStatsIfDue(session: BridgeSession, force = false): void {
  const now = Date.now();
  if (!force && now - session.mediaStatsLastLoggedAtMs < MEDIA_STATS_LOG_INTERVAL_MS) {
    return;
  }

  const hasAnyStat =
    session.twilioMediaReceived > 0 ||
    session.twilioMediaOutboundIgnored > 0 ||
    session.twilioToElevenAudioSent > 0 ||
    session.elevenToTwilioAudioSent > 0 ||
    session.ambienceToTwilioAudioSent > 0 ||
    session.droppedTwilioToElevenAudio > 0 ||
    session.droppedElevenToTwilioAudio > 0 ||
    session.droppedElevenToTwilioLatencyAudio > 0 ||
    session.droppedAmbienceToTwilioAudio > 0 ||
    session.droppedAmbienceSuppressionAudio > 0 ||
    session.droppedEchoGuardAudio > 0;

  if (hasAnyStat) {
    log('INFO', 'media flow stats', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      mediaReceived: session.twilioMediaReceived,
      outboundIgnored: session.twilioMediaOutboundIgnored,
      twilioToElevenSent: session.twilioToElevenAudioSent,
      elevenToTwilioSent: session.elevenToTwilioAudioSent,
      ambienceToTwilioSent: session.ambienceToTwilioAudioSent,
      droppedTwilioToEleven: session.droppedTwilioToElevenAudio,
      droppedElevenToTwilio: session.droppedElevenToTwilioAudio,
      droppedElevenToTwilioLatency: session.droppedElevenToTwilioLatencyAudio,
      droppedAmbienceToTwilio: session.droppedAmbienceToTwilioAudio,
      droppedAmbienceSuppression: session.droppedAmbienceSuppressionAudio,
      droppedEchoGuardAudio: session.droppedEchoGuardAudio,
      twilioOutboundQueueDepth: session.twilioOutboundAudioQueue.length,
      twilioOutboundQueueHighWater: session.twilioOutboundQueueHighWater,
      intervalMs: now - session.mediaStatsLastLoggedAtMs,
    });
    resetMediaStatsCounters(session);
  }

  session.mediaStatsLastLoggedAtMs = now;
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonObject;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function shouldForwardTwilioMediaToElevenLabs(track: string): boolean {
  const normalized = normalizeString(track).toLowerCase();
  if (!normalized) return true;
  if (normalized === 'inbound' || normalized === 'inbound_track') return true;
  if (normalized === 'outbound' || normalized === 'outbound_track') return false;
  return true;
}

function errorDetails(error: unknown): JsonObject {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack || '',
    };
  }
  return {
    errorMessage: String(error),
  };
}

function sanitizeUrlForLogs(rawUrl: string): string {
  const normalized = normalizeString(rawUrl);
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    if (url.username) url.username = 'REDACTED';
    if (url.password) url.password = 'REDACTED';
    for (const key of Array.from(url.searchParams.keys())) {
      url.searchParams.set(key, 'REDACTED');
    }
    return url.toString();
  } catch {
    return normalized;
  }
}

function getPathFromRequest(req: IncomingMessage): string {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    return url.pathname;
  } catch {
    return '/';
  }
}

function safeParseJson(raw: string): { ok: true; value: JsonObject } | { ok: false; reason: string } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const objectValue = asObject(parsed);
    if (!objectValue) return { ok: false, reason: 'payload_is_not_an_object' };
    return { ok: true, value: objectValue };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'invalid_json' };
  }
}

function rawDataToUtf8(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return '';
}

function sendText(res: ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(body);
}

function buildElevenLabsApiUrl(path: string): string {
  const normalizedBase = ELEVENLABS_API_BASE_URL.replace(/\/+$/, '');
  const baseWithVersion = normalizedBase.endsWith('/v1') ? normalizedBase : `${normalizedBase}/v1`;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseWithVersion}${normalizedPath}`;
}

function buildElevenLabsSignedUrlRequestUrl(): URL {
  const endpoint = new URL(buildElevenLabsApiUrl('/convai/conversation/get-signed-url'));
  if (ELEVENLABS_AGENT_ID) {
    endpoint.searchParams.set('agent_id', ELEVENLABS_AGENT_ID);
  }
  return endpoint;
}

async function fetchElevenLabsSignedUrl(): Promise<string> {
  if (!ELEVENLABS_AGENT_ID) {
    throw new Error('ELEVENLABS_AGENT_ID ontbreekt.');
  }
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY ontbreekt.');
  }

  const endpoint = buildElevenLabsSignedUrlRequestUrl();

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
    },
  });

  const bodyText = await response.text();
  if (!response.ok) {
    const truncated = bodyText.slice(0, 500);
    throw new Error(`signed-url request failed (${response.status}): ${truncated}`);
  }

  const parsed = safeParseJson(bodyText);
  if (!parsed.ok) {
    throw new Error(`signed-url response invalid JSON: ${'reason' in parsed ? parsed.reason : 'invalid_json'}`);
  }

  const signedUrl = asString(parsed.value.signed_url);
  if (!signedUrl) {
    throw new Error('signed-url response mist signed_url.');
  }

  return signedUrl;
}

function safeSendWsJson(ws: WebSocket, payload: JsonObject): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function safeSendWsText(ws: WebSocket, payload: string): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  ws.send(payload);
  return true;
}

function sendTwilioMediaToSocket(session: BridgeSession, payloadBase64: string): boolean {
  if (!session.streamSid || !payloadBase64) return false;
  const message = `{"event":"media","streamSid":"${session.streamSid}","media":{"payload":"${payloadBase64}"}}`;
  return safeSendWsText(session.twilioWs, message);
}

function closeElevenLabsForSession(session: BridgeSession, reason: string): void {
  const elevenWs = session.elevenWs;
  if (!elevenWs) return;
  if (elevenWs.readyState === WebSocket.OPEN || elevenWs.readyState === WebSocket.CONNECTING) {
    try {
      elevenWs.close(1000, reason);
    } catch (error) {
      log('WARN', 'failed closing elevenlabs websocket', {
        connectionId: session.connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function sendAudioToTwilio(session: BridgeSession, audioBase64: string): void {
  if (!audioBase64) return;
  if (!session.streamSid) {
    log('WARN', 'dropping elevenlabs audio because streamSid is missing', {
      connectionId: session.connectionId,
    });
    return;
  }

  const queueWasEmpty = session.twilioOutboundAudioQueue.length === 0;
  session.twilioOutboundAudioQueue.push(audioBase64);
  if (session.twilioOutboundAudioQueue.length > session.twilioOutboundQueueHighWater) {
    session.twilioOutboundQueueHighWater = session.twilioOutboundAudioQueue.length;
  }

  if (session.twilioOutboundAudioQueue.length > TWILIO_OUTBOUND_AGENT_MAX_LAG_CHUNKS) {
    const droppedForLag = session.twilioOutboundAudioQueue.length - TWILIO_OUTBOUND_AGENT_MAX_LAG_CHUNKS;
    session.twilioOutboundAudioQueue.splice(0, droppedForLag);
    session.droppedElevenToTwilioAudio += droppedForLag;
    session.droppedElevenToTwilioLatencyAudio += droppedForLag;
    flushMediaStatsIfDue(session);
  }

  if (session.twilioOutboundAudioQueue.length > TWILIO_OUTBOUND_AGENT_QUEUE_MAX_CHUNKS) {
    const dropped = session.twilioOutboundAudioQueue.length - TWILIO_OUTBOUND_AGENT_QUEUE_MAX_CHUNKS;
    session.twilioOutboundAudioQueue.splice(0, dropped);
    session.droppedElevenToTwilioAudio += dropped;
    flushMediaStatsIfDue(session);
  }

  if (queueWasEmpty && TWILIO_OUTBOUND_AGENT_JITTER_TARGET_CHUNKS > 1) {
    session.twilioAgentWarmupActive = true;
    session.twilioAgentWarmupUntilMs = Date.now() + TWILIO_OUTBOUND_AGENT_JITTER_MAX_WAIT_MS;
  }
  ensureTwilioOutboundPlayoutRunning(session);
}

function clearQueuedAgentAudioForTwilio(session: BridgeSession, reason: string): void {
  if (!session.twilioOutboundAudioQueue.length) return;
  const dropped = session.twilioOutboundAudioQueue.length;
  session.twilioOutboundAudioQueue.length = 0;
  session.twilioAgentWarmupActive = false;
  session.twilioAgentWarmupUntilMs = 0;
  session.droppedElevenToTwilioAudio += dropped;
  log('INFO', 'queued agent audio cleared before twilio playout', {
    connectionId: session.connectionId,
    streamSid: session.streamSid,
    droppedChunks: dropped,
    reason,
  });
}

function sendClearToTwilio(session: BridgeSession, reason: string, clearQueuedAgentAudio = false): void {
  if (!session.streamSid) return;

  if (clearQueuedAgentAudio) {
    clearQueuedAgentAudioForTwilio(session, reason);
  }

  const ok = safeSendWsJson(session.twilioWs, {
    event: 'clear',
    streamSid: session.streamSid,
  });

  if (!ok) return;
  log('INFO', 'clear sent to twilio', {
    connectionId: session.connectionId,
    streamSid: session.streamSid,
    reason,
  });
}

function flushBufferedAudioToElevenLabs(session: BridgeSession): void {
  const elevenWs = session.elevenWs;
  if (!elevenWs || elevenWs.readyState !== WebSocket.OPEN) return;

  if (session.bufferedUserAudioChunks.length > MAX_PREFLUSH_TWILIO_AUDIO_CHUNKS) {
    const dropped = session.bufferedUserAudioChunks.length - MAX_PREFLUSH_TWILIO_AUDIO_CHUNKS;
    session.bufferedUserAudioChunks.splice(0, dropped);
    session.droppedTwilioToElevenAudio += dropped;
    log('WARN', 'dropping stale buffered twilio audio before flush', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      droppedChunks: dropped,
      keptChunks: session.bufferedUserAudioChunks.length,
    });
  }

  let flushed = 0;
  while (session.bufferedUserAudioChunks.length > 0) {
    if (elevenWs.bufferedAmount > MAX_ELEVEN_WS_BUFFERED_BYTES) {
      break;
    }
    const chunk = session.bufferedUserAudioChunks.shift();
    if (!chunk) continue;
    const ok = safeSendWsJson(elevenWs, { user_audio_chunk: chunk });
    if (!ok) {
      session.bufferedUserAudioChunks.unshift(chunk);
      break;
    }
    flushed += 1;
  }

  if (flushed > 0) {
    log('INFO', 'flushed buffered twilio audio to elevenlabs', {
      connectionId: session.connectionId,
      chunks: flushed,
    });
  }
}

function forwardTwilioAudioChunkToElevenLabs(session: BridgeSession, audioBase64: string): void {
  if (!audioBase64) return;
  session.lastCallerSpeechForwardedAtMs = Date.now();
  const elevenWs = session.elevenWs;
  if (elevenWs && elevenWs.readyState === WebSocket.OPEN) {
    if (elevenWs.bufferedAmount > MAX_ELEVEN_WS_BUFFERED_BYTES) {
      session.droppedTwilioToElevenAudio += 1;
      flushMediaStatsIfDue(session);
      return;
    }
    const ok = safeSendWsJson(elevenWs, { user_audio_chunk: audioBase64 });
    if (ok) {
      session.twilioToElevenAudioSent += 1;
      flushMediaStatsIfDue(session);
    } else {
      log('WARN', 'audio forward failed twilio -> elevenlabs (socket not open)', {
        connectionId: session.connectionId,
        streamSid: session.streamSid,
      });
    }
    return;
  }

  session.bufferedUserAudioChunks.push(audioBase64);
  if (session.bufferedUserAudioChunks.length % 25 === 0 || session.bufferedUserAudioChunks.length === 1) {
    log('INFO', 'audio buffered twilio -> elevenlabs (awaiting elevenlabs websocket)', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      bufferedChunks: session.bufferedUserAudioChunks.length,
    });
  }
  if (session.bufferedUserAudioChunks.length > MAX_BUFFERED_TWILIO_AUDIO_CHUNKS) {
    session.bufferedUserAudioChunks.shift();
    session.droppedTwilioToElevenAudio += 1;
    log('WARN', 'twilio audio buffer full, dropping oldest chunk', {
      connectionId: session.connectionId,
      maxBufferedChunks: MAX_BUFFERED_TWILIO_AUDIO_CHUNKS,
    });
  }
}

function sendTwilioAudioToElevenLabs(session: BridgeSession, audioBase64: string): void {
  if (!audioBase64) return;
  if (session.elevenUnavailable) {
    log('WARN', 'audio dropped: elevenlabs marked unavailable for this call', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      payloadBytes: Buffer.byteLength(audioBase64, 'utf8'),
    });
    return;
  }

  let analyzedLevels: { rms: number; peak: number } | null | undefined;
  const getAnalyzedLevels = (): { rms: number; peak: number } | null => {
    if (analyzedLevels === undefined) {
      analyzedLevels = analyzeMuLawAudioLevels(audioBase64);
    }
    return analyzedLevels;
  };

  if (session.hasReceivedAgentAudio) {
    const now = Date.now();
    if (now < session.echoGuardBypassUntilMs) {
      // Temporary bypass window after confirmed caller speech to prevent clipped turn-taking.
    } else {
      const elapsedSinceAgentAudioMs = now - session.lastAgentAudioAtMs;
      if (elapsedSinceAgentAudioMs >= 0 && elapsedSinceAgentAudioMs < AGENT_ECHO_GUARD_MS) {
        const canBypassEchoGuard =
          AGENT_ECHO_GUARD_SPEECH_BYPASS_ENABLED &&
          levelsPassAbsoluteSpeechThreshold(
            getAnalyzedLevels(),
            AGENT_ECHO_GUARD_SPEECH_BYPASS_RMS_THRESHOLD,
            AGENT_ECHO_GUARD_SPEECH_BYPASS_PEAK_THRESHOLD
          );
        if (!canBypassEchoGuard) {
          session.droppedEchoGuardAudio += 1;
          flushMediaStatsIfDue(session);
          return;
        }
        if (AGENT_ECHO_GUARD_BYPASS_WINDOW_MS > 0) {
          session.echoGuardBypassUntilMs = now + AGENT_ECHO_GUARD_BYPASS_WINDOW_MS;
        }
      }
    }
  }

  if (AMBIENCE_INBOUND_SUPPRESSION_ENABLED && session.ambienceActive) {
    const now = Date.now();
    const inSpeechPassthroughWindow = now < session.callerSpeechPassthroughUntilMs;
    if (!inSpeechPassthroughWindow) {
      const likelyCallerSpeech = isLikelyCallerSpeechFrame(session, audioBase64);
      if (!likelyCallerSpeech) {
        if (AMBIENCE_INBOUND_SUPPRESSION_PREROLL_MAX_CHUNKS > 0) {
          session.suppressedInboundAudioPrebuffer.push(audioBase64);
          if (session.suppressedInboundAudioPrebuffer.length > AMBIENCE_INBOUND_SUPPRESSION_PREROLL_MAX_CHUNKS) {
            session.suppressedInboundAudioPrebuffer.shift();
          }
        }
        session.droppedAmbienceSuppressionAudio += 1;
        flushMediaStatsIfDue(session);
        return;
      }
      session.callerSpeechPassthroughUntilMs = now + AMBIENCE_INBOUND_SPEECH_PASSTHROUGH_MS;
      if (!AMBIENCE_ALWAYS_ON) {
        stopAmbience(session, 'caller_speech_detected');
      }
      sendClearToTwilio(session, 'caller_speech_detected', true);
      if (session.suppressedInboundAudioPrebuffer.length > 0) {
        const prebufferedChunks = session.suppressedInboundAudioPrebuffer.splice(0);
        for (const chunk of prebufferedChunks) {
          forwardTwilioAudioChunkToElevenLabs(session, chunk);
        }
      }
    }
  } else {
    session.consecutiveLikelySpeechFrames = 0;
    session.suppressedInboundAudioPrebuffer.length = 0;
    session.callerSpeechPassthroughUntilMs = 0;
  }

  forwardTwilioAudioChunkToElevenLabs(session, audioBase64);
}

function handleElevenLabsMessage(session: BridgeSession, raw: string): void {
  const parsed = safeParseJson(raw);
  if (!parsed.ok) {
    log('WARN', 'invalid elevenlabs message ignored', {
      connectionId: session.connectionId,
      reason: 'reason' in parsed ? parsed.reason : 'invalid_json',
    });
    return;
  }

  const payload = parsed.value;
  const type = asString(payload.type) || 'unknown';

  if (type === 'conversation_initiation_metadata') {
    const metadata = asObject(payload.conversation_initiation_metadata_event) || {};
    const userInputAudioFormat = asString(metadata.user_input_audio_format);
    const agentOutputAudioFormat = asString(metadata.agent_output_audio_format);
    log('INFO', 'elevenlabs event: conversation_initiation_metadata', {
      connectionId: session.connectionId,
      conversationId: asString(metadata.conversation_id),
      userInputAudioFormat,
      agentOutputAudioFormat,
    });
    const normalizedInput = userInputAudioFormat.toLowerCase();
    const normalizedOutput = agentOutputAudioFormat.toLowerCase();
    const inputLooksTelephony = /ulaw|mulaw|g711/.test(normalizedInput);
    const outputLooksTelephony = /ulaw|mulaw|g711/.test(normalizedOutput);
    if ((userInputAudioFormat && !inputLooksTelephony) || (agentOutputAudioFormat && !outputLooksTelephony)) {
      log('WARN', 'elevenlabs audio format may not be telephony-compatible', {
        connectionId: session.connectionId,
        userInputAudioFormat,
        agentOutputAudioFormat,
      });
    }
    return;
  }

  if (type === 'ping') {
    const ping = asObject(payload.ping_event) || {};
    const eventId = ping.event_id;
    const pingMs = typeof ping.ping_ms === 'number' && Number.isFinite(ping.ping_ms) ? ping.ping_ms : 0;
    const sendPong = () => {
      const elevenWs = session.elevenWs;
      if (!elevenWs) return;
      safeSendWsJson(elevenWs, { type: 'pong', event_id: eventId });
    };
    if (pingMs > 0 && pingMs < 30_000) {
      setTimeout(sendPong, pingMs);
    } else {
      sendPong();
    }
    return;
  }

  if (type === 'audio') {
    const audioEvent = asObject(payload.audio_event) || {};
    const audioBase64 = asString(audioEvent.audio_base_64);
    if (!audioBase64) return;

    session.hasReceivedAgentAudio = true;
    session.lastAgentAudioAtMs = Date.now();
    session.echoGuardBypassUntilMs = 0;

    if (!session.agentSpeaking) {
      if (session.ambienceActive && !AMBIENCE_ALWAYS_ON) {
        sendClearToTwilio(session, 'agent_audio_resumed', true);
      }
      if (!AMBIENCE_ALWAYS_ON) {
        stopAmbience(session, 'agent_audio_resumed');
      }
      log('INFO', 'agent audio resumed', {
        connectionId: session.connectionId,
        streamSid: session.streamSid,
        callSid: session.callSid,
      });
    }
    session.agentSpeaking = true;
    scheduleAmbienceStartOnSilence(session, 'agent_silence');
    sendAudioToTwilio(session, audioBase64);
    return;
  }

  if (type === 'interruption') {
    const interruption = asObject(payload.interruption_event) || {};
    log('INFO', 'elevenlabs event: interruption', {
      connectionId: session.connectionId,
      reason: asString(interruption.reason),
    });
    sendClearToTwilio(session, 'elevenlabs_interruption', true);
    session.agentSpeaking = false;
    scheduleAmbienceStartOnSilence(session, 'elevenlabs_interruption');
    return;
  }

  if (type === 'user_transcript') {
    const transcript = asObject(payload.user_transcription_event) || {};
    log('INFO', 'elevenlabs event: user_transcript', {
      connectionId: session.connectionId,
      text: asString(transcript.user_transcript).slice(0, 180),
    });
    return;
  }

  if (type === 'agent_response') {
    const response = asObject(payload.agent_response_event) || {};
    log('INFO', 'elevenlabs event: agent_response', {
      connectionId: session.connectionId,
      text: asString(response.agent_response).slice(0, 180),
    });
    return;
  }

  log('INFO', 'elevenlabs event: unhandled', {
    connectionId: session.connectionId,
    type,
  });
}

async function connectElevenLabsForSession(session: BridgeSession): Promise<void> {
  if (session.elevenUnavailable) return;
  if (session.elevenConnecting) return;
  if (session.elevenWs && (session.elevenWs.readyState === WebSocket.CONNECTING || session.elevenWs.readyState === WebSocket.OPEN)) {
    return;
  }
  if (session.stopping) return;
  if (!ELEVENLABS_AGENT_ID || !ELEVENLABS_API_KEY) {
    session.elevenUnavailable = true;
    log('ERROR', 'elevenlabs connect skipped: required env vars missing', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
      hasElevenLabsApiKey: Boolean(ELEVENLABS_API_KEY),
      hasElevenLabsAgentId: Boolean(ELEVENLABS_AGENT_ID),
    });
    return;
  }

  session.elevenConnectAttempts += 1;
  session.elevenConnecting = true;
  log('INFO', 'elevenlabs connect start', {
    connectionId: session.connectionId,
    streamSid: session.streamSid,
    callSid: session.callSid,
    attempt: session.elevenConnectAttempts,
    hasElevenLabsApiKey: Boolean(ELEVENLABS_API_KEY),
    hasElevenLabsAgentId: Boolean(ELEVENLABS_AGENT_ID),
    elevenLabsSignedUrlEndpoint: sanitizeUrlForLogs(buildElevenLabsSignedUrlRequestUrl().toString()),
  });

  let signedUrl = '';
  try {
    signedUrl = await fetchElevenLabsSignedUrl();
    log('INFO', 'elevenlabs websocket url resolved', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
      elevenLabsWebSocketUrl: sanitizeUrlForLogs(signedUrl),
    });
  } catch (error) {
    session.elevenConnecting = false;
    session.elevenUnavailable = true;
    log('ERROR', 'elevenlabs connect failed before websocket open', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
      ...errorDetails(error),
    });
    return;
  }

  if (session.stopping || session.twilioWs.readyState !== WebSocket.OPEN) {
    session.elevenConnecting = false;
    return;
  }

  const elevenWs = new WebSocket(signedUrl, { perMessageDeflate: false });
  session.elevenWs = elevenWs;

  elevenWs.on('open', () => {
    setNoDelay((elevenWs as unknown as { _socket?: unknown })._socket);
    session.elevenConnecting = false;
    log('INFO', 'elevenlabs websocket open', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
    });
    flushBufferedAudioToElevenLabs(session);
    if (!session.hasReceivedAgentAudio) {
      if (AMBIENCE_ALWAYS_ON) {
        startAmbience(session, 'waiting_for_agent_audio');
      } else {
        scheduleAmbienceStartOnSilence(session, 'waiting_for_agent_audio', INITIAL_AMBIENCE_DELAY_MS);
      }
    }
  });

  elevenWs.on('message', (data, isBinary) => {
    if (isBinary) {
      log('WARN', 'binary elevenlabs frame ignored', { connectionId: session.connectionId });
      return;
    }

    const raw = rawDataToUtf8(data);
    if (!raw) {
      log('WARN', 'empty elevenlabs frame ignored', { connectionId: session.connectionId });
      return;
    }

    handleElevenLabsMessage(session, raw);
  });

  elevenWs.on('close', (code, reason) => {
    session.elevenConnecting = false;
    session.elevenWs = null;
    session.agentSpeaking = false;
    log('WARN', 'elevenlabs websocket close', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      code,
      reason: Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || ''),
    });
    if (!session.stopping) {
      startAmbience(session, 'elevenlabs_ws_closed');
    }
  });

  elevenWs.on('error', (error) => {
    log('ERROR', 'elevenlabs websocket error', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
      ...errorDetails(error),
    });
  });
}

loadAmbienceMuLawAudioBuffer();

const server = http.createServer((req, res) => {
  const path = getPathFromRequest(req);
  if (path === '/' || path === '/healthz') {
    sendText(res, 200, 'ok');
    return;
  }
  sendText(res, 404, 'not found');
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

server.on('upgrade', (req, socket, head) => {
  setNoDelay(socket);
  const path = getPathFromRequest(req);

  if (path !== WS_PATH) {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  setNoDelay(req.socket);
  setNoDelay((ws as unknown as { _socket?: unknown })._socket);
  const connectionId = ++connectionCounter;
  const remoteAddress = asString(req.headers['x-forwarded-for']) || req.socket.remoteAddress || 'unknown';
  const session: BridgeSession = {
    connectionId,
    twilioWs: ws,
    streamSid: '',
    callSid: '',
    elevenWs: null,
    elevenConnecting: false,
    elevenConnectAttempts: 0,
    elevenUnavailable: false,
    hasReceivedAgentAudio: false,
    lastAgentAudioAtMs: 0,
    agentSpeaking: false,
    ambienceActive: false,
    ambienceFrameIndex: 0,
    agentSilenceTimer: null,
    twilioOutboundPlayoutTimer: null,
    twilioOutboundPlayoutNextAtMs: 0,
    twilioOutboundAudioQueue: [],
    twilioOutboundQueueHighWater: 0,
    twilioAgentWarmupActive: false,
    twilioAgentWarmupUntilMs: 0,
    twilioMediaReceived: 0,
    twilioMediaOutboundIgnored: 0,
    twilioToElevenAudioSent: 0,
    elevenToTwilioAudioSent: 0,
    ambienceToTwilioAudioSent: 0,
    droppedTwilioToElevenAudio: 0,
    droppedElevenToTwilioAudio: 0,
    droppedElevenToTwilioLatencyAudio: 0,
    droppedAmbienceToTwilioAudio: 0,
    droppedAmbienceSuppressionAudio: 0,
    droppedEchoGuardAudio: 0,
    mediaStatsLastLoggedAtMs: Date.now(),
    bufferedUserAudioChunks: [],
    suppressedInboundAudioPrebuffer: [],
    inboundNoiseFloorRms: AMBIENCE_NOISE_FLOOR_RMS_INITIAL,
    consecutiveLikelySpeechFrames: 0,
    callerSpeechPassthroughUntilMs: 0,
    echoGuardBypassUntilMs: 0,
    lastCallerSpeechForwardedAtMs: 0,
    stopping: false,
  };

  log('INFO', 'twilio websocket connected', {
    connectionId: session.connectionId,
    remoteAddress,
    path: WS_PATH,
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      log('WARN', 'binary twilio frame ignored', { connectionId: session.connectionId });
      return;
    }

    const raw = rawDataToUtf8(data);
    if (!raw) {
      log('WARN', 'empty twilio frame ignored', { connectionId: session.connectionId });
      return;
    }

    const parsed = safeParseJson(raw);
    if (!parsed.ok) {
      log('WARN', 'invalid twilio message ignored', {
        connectionId: session.connectionId,
        reason: 'reason' in parsed ? parsed.reason : 'invalid_json',
      });
      return;
    }

    const payload = parsed.value;
    const event = asString(payload.event) || 'unknown';
    const payloadStreamSid = asString(payload.streamSid);
    if (!session.streamSid && payloadStreamSid) session.streamSid = payloadStreamSid;

    if (event === 'connected') {
      log('INFO', 'twilio event: connected', { connectionId: session.connectionId });
      if (!session.elevenWs && !session.elevenConnecting) {
        void connectElevenLabsForSession(session);
      }
      return;
    }

    if (event === 'start') {
      const start = asObject(payload.start) || {};
      session.streamSid = asString(start.streamSid) || session.streamSid;
      session.callSid = asString(start.callSid) || session.callSid;
      const mediaFormat = asObject(start.mediaFormat) || {};
      const mediaEncoding = asString(mediaFormat.encoding).toLowerCase();
      const mediaSampleRate = asString(mediaFormat.sampleRate);
      const mediaChannels = asString(mediaFormat.channels);

      log('INFO', 'twilio event: start', {
        connectionId: session.connectionId,
        streamSid: session.streamSid,
        callSid: session.callSid,
        mediaEncoding: mediaEncoding || '(unknown)',
        mediaSampleRate: mediaSampleRate || '(unknown)',
        mediaChannels: mediaChannels || '(unknown)',
      });
      if (
        (mediaEncoding && !/mulaw|ulaw|g711/.test(mediaEncoding)) ||
        (mediaSampleRate && mediaSampleRate !== '8000')
      ) {
        log('WARN', 'twilio media format may not be telephony-compatible', {
          connectionId: session.connectionId,
          streamSid: session.streamSid,
          mediaEncoding: mediaEncoding || '(unknown)',
          mediaSampleRate: mediaSampleRate || '(unknown)',
          mediaChannels: mediaChannels || '(unknown)',
        });
      }
      log('INFO', 'elevenlabs call-start config', {
        connectionId: session.connectionId,
        streamSid: session.streamSid,
        callSid: session.callSid,
        hasElevenLabsApiKey: Boolean(ELEVENLABS_API_KEY),
        hasElevenLabsAgentId: Boolean(ELEVENLABS_AGENT_ID),
        elevenLabsSignedUrlEndpoint: sanitizeUrlForLogs(buildElevenLabsSignedUrlRequestUrl().toString()),
        elevenLabsWebSocketUrl: 'dynamic signed URL (resolved during connect)',
      });
      if (AMBIENCE_ENABLED && !ambienceMuLawAudio) {
        log('WARN', 'ambience disabled for call', {
          connectionId: session.connectionId,
          streamSid: session.streamSid,
          callSid: session.callSid,
          reason: ambienceDisabledReason || 'ambience audio not available',
        });
      }
      if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
        session.elevenUnavailable = true;
        log('ERROR', 'call has missing ElevenLabs configuration; realtime bridge will not start', {
          connectionId: session.connectionId,
          streamSid: session.streamSid,
          callSid: session.callSid,
          hasElevenLabsApiKey: Boolean(ELEVENLABS_API_KEY),
          hasElevenLabsAgentId: Boolean(ELEVENLABS_AGENT_ID),
        });
      }

      if (AMBIENCE_ALWAYS_ON) {
        startAmbience(session, 'call_start');
      }

      void connectElevenLabsForSession(session);
      return;
    }

    if (event === 'media') {
      const media = asObject(payload.media) || {};
      const mediaPayload = asString(media.payload);
      const mediaTrack = asString(media.track);
      session.twilioMediaReceived += 1;

      if (shouldForwardTwilioMediaToElevenLabs(mediaTrack)) {
        sendTwilioAudioToElevenLabs(session, mediaPayload);
      } else {
        session.twilioMediaOutboundIgnored += 1;
        flushMediaStatsIfDue(session);
      }
      if (!session.elevenWs && !session.elevenConnecting) {
        void connectElevenLabsForSession(session);
      }
      return;
    }

    if (event === 'stop') {
      const stop = asObject(payload.stop) || {};
      session.streamSid = session.streamSid || asString(stop.streamSid);
      session.callSid = session.callSid || asString(stop.callSid);
      session.stopping = true;

      log('INFO', 'twilio event: stop', {
        connectionId: session.connectionId,
        streamSid: session.streamSid,
        callSid: session.callSid,
      });

      cleanupSessionState(session, 'twilio_stop');
      flushMediaStatsIfDue(session, true);
      closeElevenLabsForSession(session, 'twilio_stop');
      return;
    }

    log('INFO', 'twilio event: unhandled', { connectionId: session.connectionId, event });
  });

  ws.on('close', (code, reason) => {
    session.stopping = true;
    cleanupSessionState(session, 'twilio_close');
    flushMediaStatsIfDue(session, true);
    closeElevenLabsForSession(session, 'twilio_close');
    log('INFO', 'twilio websocket close', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
      code,
      reason: Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || ''),
    });
  });

  ws.on('error', (error) => {
    log('ERROR', 'twilio websocket error', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
      ...errorDetails(error),
    });
  });
});

server.on('error', (error) => {
  log('ERROR', 'http server error', { error: error.message });
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  log('ERROR', 'unhandled promise rejection', { error: message });
});

process.on('uncaughtException', (error) => {
  log('ERROR', 'uncaught exception', { error: error.message });
});

server.listen(PORT, () => {
  log('INFO', 'ambience startup config', {
    AMBIENCE_ENABLED,
    AMBIENCE_FILE_PATH: AMBIENCE_FILE_PATH || '(empty)',
    AMBIENCE_ALWAYS_ON,
    AMBIENCE_BASE_GAIN,
    AMBIENCE_UNDER_AGENT_GAIN,
    AMBIENCE_INBOUND_SUPPRESSION_ENABLED,
    AMBIENCE_INBOUND_SPEECH_ABSOLUTE_RMS_THRESHOLD,
    AMBIENCE_INBOUND_SPEECH_PEAK_THRESHOLD,
    AMBIENCE_INBOUND_SPEECH_NOISE_MULTIPLIER,
    AMBIENCE_INBOUND_SPEECH_MIN_CONSECUTIVE_FRAMES,
    AMBIENCE_INBOUND_SUPPRESSION_PREROLL_MAX_CHUNKS,
    AMBIENCE_INBOUND_SPEECH_PASSTHROUGH_MS,
    AGENT_SILENCE_TO_AMBIENCE_MS,
    AMBIENCE_AFTER_CALLER_SPEECH_COOLDOWN_MS,
    AMBIENCE_NOISE_FLOOR_RMS_INITIAL,
    AGENT_ECHO_GUARD_MS,
    AGENT_ECHO_GUARD_SPEECH_BYPASS_ENABLED,
    AGENT_ECHO_GUARD_SPEECH_BYPASS_RMS_THRESHOLD,
    AGENT_ECHO_GUARD_SPEECH_BYPASS_PEAK_THRESHOLD,
    AGENT_ECHO_GUARD_BYPASS_WINDOW_MS,
    TWILIO_OUTBOUND_AGENT_QUEUE_MAX_CHUNKS,
    TWILIO_OUTBOUND_AGENT_MAX_LAG_CHUNKS,
    TWILIO_OUTBOUND_AGENT_JITTER_TARGET_CHUNKS,
    TWILIO_OUTBOUND_AGENT_JITTER_MAX_WAIT_MS,
    TWILIO_OUTBOUND_MAX_FRAMES_PER_TICK,
    ffmpeg: 'used for non-mulaw ambience conversion',
  });

  if (!ELEVENLABS_AGENT_ID || !ELEVENLABS_API_KEY) {
    log('WARN', 'missing ElevenLabs env vars; audio bridge to ElevenLabs will fail', {
      hasElevenLabsAgentId: Boolean(ELEVENLABS_AGENT_ID),
      hasElevenLabsApiKey: Boolean(ELEVENLABS_API_KEY),
    });
  }

  log('INFO', 'twilio media bridge listening', {
    port: PORT,
    health: '/',
    healthz: '/healthz',
    websocket: WS_PATH,
  });
});
