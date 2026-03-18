import { pcm16le16kToUlaw8k } from '../audio/ulaw.js';
import type { Logger } from '../utils/logger.js';

export type ElevenLabsTtsConfig = {
  apiKey: string;
  voiceId: string;
  modelId: string;
  outputFormat: string;
  optimizeLatency: number;
  stability: number;
  similarityBoost: number;
  useSpeakerBoost: boolean;
};

type StreamMode = 'ulaw_8k' | 'pcm16_16k';

export class ElevenLabsTtsClient {
  private loggedFormatOverride = false;
  private loggedV3LatencyParamSkip = false;

  constructor(
    private readonly cfg: ElevenLabsTtsConfig,
    private readonly logger: Logger
  ) {}

  async streamUlaw(
    text: string,
    onChunk: (chunk: Buffer) => Promise<void> | void,
    signal?: AbortSignal
  ): Promise<void> {
    const cleaned = text.trim();
    if (!cleaned) return;

    const preferredFormat = this.resolvePreferredFormat(this.cfg.outputFormat);

    try {
      const preferred = await this.openTtsStream(cleaned, preferredFormat, signal);
      const preferredMode: StreamMode = /ulaw/i.test(preferredFormat) ? 'ulaw_8k' : 'pcm16_16k';
      await this.pumpResponse(preferred.response, preferredMode, onChunk, signal);
      return;
    } catch (error) {
      if (signal?.aborted) throw error;

      if (preferredFormat === 'pcm_16000') {
        throw error;
      }

      this.logger.warn('ElevenLabs preferred output_format faalde, fallback naar pcm_16000', {
        preferredFormat,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback zonder extra tooling: pcm_16000 -> interne transcode -> u-law 8k.
    const fallback = await this.openTtsStream(cleaned, 'pcm_16000', signal);
    await this.pumpResponse(fallback.response, 'pcm16_16k', onChunk, signal);
  }

  private async openTtsStream(
    text: string,
    outputFormat: string,
    signal?: AbortSignal
  ): Promise<{ response: Response }> {
    const url = new URL(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.cfg.voiceId)}/stream`
    );
    url.searchParams.set('output_format', outputFormat);
    const isV3Model = String(this.cfg.modelId || '').toLowerCase().includes('eleven_v3');
    if (!isV3Model) {
      url.searchParams.set('optimize_streaming_latency', String(this.cfg.optimizeLatency));
    } else if (!this.loggedV3LatencyParamSkip) {
      this.logger.info('ElevenLabs v3: optimize_streaming_latency overgeslagen (niet ondersteund)');
      this.loggedV3LatencyParamSkip = true;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/octet-stream',
        'xi-api-key': this.cfg.apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: this.cfg.modelId,
        voice_settings: {
          stability: this.cfg.stability,
          similarity_boost: this.cfg.similarityBoost,
          use_speaker_boost: this.cfg.useSpeakerBoost,
        },
      }),
      signal,
    });

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      const err = new Error(
        `ElevenLabs TTS fout (${response.status}) voor format ${outputFormat}: ${details.slice(0, 500)}`
      );
      this.logger.warn('ElevenLabs TTS request faalde', {
        status: response.status,
        outputFormat,
        details: details.slice(0, 500),
      });
      throw err;
    }

    if (!response.body) {
      throw new Error('ElevenLabs gaf geen audio stream body terug');
    }

    return { response };
  }

  private async pumpResponse(
    response: Response,
    mode: StreamMode,
    onChunk: (chunk: Buffer) => Promise<void> | void,
    signal?: AbortSignal
  ): Promise<void> {
    if (!response.body) {
      throw new Error('Lege ElevenLabs stream body');
    }

    const reader = response.body.getReader();
    let carry = Buffer.alloc(0);

    while (true) {
      if (signal?.aborted) {
        throw new Error('ElevenLabs stream geannuleerd');
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      const chunk = Buffer.from(value);

      if (mode === 'ulaw_8k') {
        await onChunk(chunk);
        continue;
      }

      const combined = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const usableByteLength = combined.length - (combined.length % 4); // 2 samples van 16-bit
      if (usableByteLength <= 0) {
        carry = combined;
        continue;
      }

      const toConvert = combined.subarray(0, usableByteLength);
      carry = combined.subarray(usableByteLength);

      const ulaw = pcm16le16kToUlaw8k(toConvert);
      if (ulaw.length > 0) {
        await onChunk(ulaw);
      }
    }

    if (mode === 'pcm16_16k' && carry.length >= 4) {
      const usableByteLength = carry.length - (carry.length % 4);
      if (usableByteLength > 0) {
        const ulaw = pcm16le16kToUlaw8k(carry.subarray(0, usableByteLength));
        if (ulaw.length > 0) {
          await onChunk(ulaw);
        }
      }
    }
  }

  private resolvePreferredFormat(configuredFormat: string): string {
    const format = String(configuredFormat || '').trim();
    const model = String(this.cfg.modelId || '').toLowerCase();
    const isV3Model = model.includes('eleven_v3');
    const isUlaw = /ulaw/i.test(format);

    if (isV3Model && isUlaw) {
      if (!this.loggedFormatOverride) {
        this.logger.info('Output format override: eleven_v3 gebruikt pcm_16000 voor stabiele stream');
        this.loggedFormatOverride = true;
      }
      return 'pcm_16000';
    }

    return format;
  }
}
