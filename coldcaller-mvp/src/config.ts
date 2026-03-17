import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const defaultAgentPrompt =
  'Jij bent Ruben Nijhuis van Softora.nl. Je enige rol is enthousiaste en overtuigende coldcaller en appointment setter. Je doel is om op natuurlijke wijze interesse te wekken en uiteindelijk een afspraak op kantoor in te plannen. Je spreekt energiek, warm en overtuigend in vloeiend Nederlands (nl-NL), met een neutraal Nederlands accent, correcte uitspraak en klemtoon, natuurlijke intonatie, duidelijke variatie in nadruk en tempo, en zonder Duits, Engels, monotone of robotische voorleesstijl.';

const envSchema = z.object({
  PORT: z.string().default('8787'),
  PUBLIC_BASE_URL: z.string().url(),
  PUBLIC_WSS_URL: z.string().url().optional(),
  LOG_LEVEL: z.string().optional(),

  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_PHONE_NUMBER: z.string().min(1),
  TWILIO_VOICE_WEBHOOK_PATH: z.string().default('/twilio/voice'),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_REALTIME_MODEL: z.string().default('gpt-audio-1.5'),
  OPENAI_REALTIME_VAD_THRESHOLD: z.string().default('0.45'),

  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_VOICE_ID: z.string().min(1),
  ELEVENLABS_MODEL_ID: z.string().default('eleven_turbo_v2_5'),
  ELEVENLABS_OUTPUT_FORMAT: z.string().default('ulaw_8000'),
  ELEVENLABS_OPTIMIZE_LATENCY: z.string().default('3'),

  AGENT_SYSTEM_PROMPT: z.string().optional(),
});

function toWsUrl(publicBaseUrl: string): string {
  const parsed = new URL(publicBaseUrl);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = '/twilio-media';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function parseNumber(name: string, raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} moet een getal zijn`);
  }
  return parsed;
}

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const env = envSchema.parse(process.env);
  const voiceWebhookPath = env.TWILIO_VOICE_WEBHOOK_PATH.startsWith('/')
    ? env.TWILIO_VOICE_WEBHOOK_PATH
    : `/${env.TWILIO_VOICE_WEBHOOK_PATH}`;

  const publicWssUrl = env.PUBLIC_WSS_URL || toWsUrl(env.PUBLIC_BASE_URL);

  return {
    server: {
      port: Math.max(1, parseNumber('PORT', env.PORT)),
      publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/$/, ''),
      publicWssUrl,
      logLevel: env.LOG_LEVEL || 'info',
    },
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      phoneNumber: env.TWILIO_PHONE_NUMBER,
      voiceWebhookPath,
    },
    openai: {
      apiKey: env.OPENAI_API_KEY,
      realtimeModel: env.OPENAI_REALTIME_MODEL,
      vadThreshold: Math.max(0, Math.min(1, parseNumber('OPENAI_REALTIME_VAD_THRESHOLD', env.OPENAI_REALTIME_VAD_THRESHOLD))),
    },
    elevenlabs: {
      apiKey: env.ELEVENLABS_API_KEY,
      voiceId: env.ELEVENLABS_VOICE_ID,
      modelId: env.ELEVENLABS_MODEL_ID,
      outputFormat: env.ELEVENLABS_OUTPUT_FORMAT,
      optimizeLatency: Math.max(0, Math.min(4, Math.round(parseNumber('ELEVENLABS_OPTIMIZE_LATENCY', env.ELEVENLABS_OPTIMIZE_LATENCY)))),
    },
    agent: {
      systemPrompt: env.AGENT_SYSTEM_PROMPT || defaultAgentPrompt,
    },
  };
}
