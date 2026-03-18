import WebSocket from 'ws';
import type { Logger } from '../utils/logger.js';

type HandlerSet = {
  onAssistantAudio?: (base64Ulaw8k: string) => void;
  onAssistantText?: (text: string) => void;
  onAssistantResponseStarted?: () => void;
  onAssistantResponseDone?: () => void;
  onCallerSpeechStart?: () => void;
  onCallerSpeechStop?: () => void;
  onCallerTranscript?: (text: string) => void;
  onError?: (error: Error) => void;
};

export type OpenAiRealtimeConfig = {
  apiKey: string;
  model: string;
  voice: string;
  systemPrompt: string;
  vadThreshold: number;
  vadPrefixPaddingMs: number;
  vadSilenceDurationMs: number;
};

type JsonValue = Record<string, unknown>;

export class OpenAiRealtimeAudioBrain {
  private socket: WebSocket | null = null;
  private connected = false;
  private hasActiveResponse = false;
  private queuedAudio: string[] = [];

  constructor(
    private readonly cfg: OpenAiRealtimeConfig,
    private readonly handlers: HandlerSet,
    private readonly logger: Logger
  ) {}

  async connect(): Promise<void> {
    if (this.connected && this.socket?.readyState === WebSocket.OPEN) return;

    const url = new URL('wss://api.openai.com/v1/realtime');
    url.searchParams.set('model', this.cfg.model);

    this.socket = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.socket) return reject(new Error('OpenAI socket niet beschikbaar'));

      const onOpen = () => {
        this.connected = true;
        this.logger.info('OpenAI Realtime socket verbonden');
        this.sendSessionUpdate();
        resolve();
      };

      const onError = (error: Error) => {
        this.logger.error('OpenAI Realtime socket error', error);
        this.handlers.onError?.(error);
        reject(error);
      };

      this.socket.once('open', onOpen);
      this.socket.once('error', onError);
    });

    this.socket.on('message', (raw) => this.handleIncoming(raw));
    this.socket.on('close', (code, reason) => {
      this.connected = false;
      const closeReason = reason.toString();
      const isExpectedShutdown = code === 1000 && closeReason === 'bridge_shutdown';
      const logFn = isExpectedShutdown ? this.logger.info.bind(this.logger) : this.logger.warn.bind(this.logger);
      logFn('OpenAI Realtime socket gesloten', {
        code,
        reason: closeReason,
      });
    });
    this.socket.on('error', (error) => {
      this.connected = false;
      this.handlers.onError?.(error as Error);
      this.logger.error('OpenAI Realtime socket runtime error', error);
    });
  }

  appendInputAudio(base64Ulaw8k: string): void {
    if (!base64Ulaw8k) return;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.queuedAudio.push(base64Ulaw8k);
      if (this.queuedAudio.length > 120) {
        this.queuedAudio.splice(0, this.queuedAudio.length - 120);
      }
      return;
    }

    this.send({
      type: 'input_audio_buffer.append',
      audio: base64Ulaw8k,
    });
  }

  requestResponse(reason = 'manual'): void {
    this.logger.debug('OpenAI response.create', { reason });
    this.send({
      type: 'response.create',
      response: {
        modalities: ['audio', 'text'],
      },
    });
  }

  cancelResponse(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (!this.hasActiveResponse) return;
    this.send({ type: 'response.cancel' });
  }

  close(): void {
    this.connected = false;
    this.hasActiveResponse = false;
    this.queuedAudio = [];
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1000, 'bridge_shutdown');
    }
    this.socket = null;
  }

  private sendSessionUpdate(): void {
    const session = {
      instructions: `${this.cfg.systemPrompt}

Belangrijke regels:
- Spreek ALTIJD Nederlands (nl-NL).
- Blijf strikt in de rol en bedrijfsidentiteit uit de system prompt.
- Luister eerst en reageer direct op wat de prospect net zei.
- Geef compacte maar volledige antwoorden (meestal 2-4 zinnen).
- Stel per beurt maximaal 1 vraag.
- Verzin nooit wat de prospect gezegd zou hebben.
- Bij een expliciete afwijzing (zoals "geen interesse", "geen behoefte", "nee bedankt"): bedank kort en sluit netjes af zonder nieuwe afspraakvraag.
- Nooit gedichten, verhalen, recepten of random entertainmenttekst.`,
      modalities: ['audio', 'text'],
      voice: this.cfg.voice,
      input_audio_format: 'g711_ulaw',
      output_audio_format: 'g711_ulaw',
      temperature: 0.6,
      turn_detection: {
        type: 'server_vad',
        threshold: this.cfg.vadThreshold,
        prefix_padding_ms: this.cfg.vadPrefixPaddingMs,
        silence_duration_ms: this.cfg.vadSilenceDurationMs,
        create_response: true,
        interrupt_response: true,
      },
    };

    this.send({
      type: 'session.update',
      session,
    });

    if (this.queuedAudio.length > 0) {
      const buffered = this.queuedAudio.slice();
      this.queuedAudio = [];
      for (const audio of buffered) {
        this.send({
          type: 'input_audio_buffer.append',
          audio,
        });
      }
      this.logger.debug('Buffered audio naar OpenAI geflusht', { chunks: buffered.length });
    }
  }

  private send(payload: JsonValue): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(payload));
  }

  private handleIncoming(raw: WebSocket.RawData): void {
    let event: JsonValue;
    try {
      event = JSON.parse(raw.toString('utf8')) as JsonValue;
    } catch (error) {
      this.logger.warn('OpenAI event parse fout', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const type = String(event.type || '');
    if (!type) return;

    if (type === 'error') {
      const code = this.extractErrorCode(event);
      if (code === 'response_cancel_not_active') {
        this.logger.debug('OpenAI cancel genegeerd: geen actieve response');
        return;
      }
      this.logger.error('OpenAI realtime event error', event);
      const message = this.extractErrorMessage(event) || 'Onbekende OpenAI realtime fout';
      this.handlers.onError?.(new Error(message));
      return;
    }

    if (type === 'session.updated') {
      this.logger.info('OpenAI sessie geupdate');
      return;
    }

    if (type === 'response.created') {
      this.hasActiveResponse = true;
      this.handlers.onAssistantResponseStarted?.();
      return;
    }

    if (type === 'response.done' || type === 'response.completed') {
      this.hasActiveResponse = false;
      this.handlers.onAssistantResponseDone?.();

      const response = (event.response || {}) as JsonValue;
      const text = this.extractTextFromResponse(response);
      if (text) this.handlers.onAssistantText?.(text);
      return;
    }

    if (type === 'input_audio_buffer.speech_started') {
      this.handlers.onCallerSpeechStart?.();
      return;
    }

    if (type === 'input_audio_buffer.speech_stopped') {
      this.handlers.onCallerSpeechStop?.();
      return;
    }

    if (
      type === 'conversation.item.input_audio_transcription.completed' ||
      type === 'input_audio_transcription.completed'
    ) {
      const transcript = this.extractTranscript(event);
      if (transcript) {
        this.handlers.onCallerTranscript?.(transcript);
      }
      return;
    }

    if (
      type === 'response.audio.delta' ||
      type === 'response.output_audio.delta' ||
      type === 'output_audio.delta'
    ) {
      const audio = this.extractAudioDelta(event);
      if (audio) {
        this.handlers.onAssistantAudio?.(audio);
      }
      return;
    }
  }

  private extractAudioDelta(event: JsonValue): string {
    const delta = event.delta;
    if (typeof delta === 'string' && delta) return delta;

    const audio = event.audio;
    if (typeof audio === 'string' && audio) return audio;

    return '';
  }

  private extractTextFromResponse(response: JsonValue): string {
    const output = Array.isArray(response.output) ? response.output : [];

    const textParts: string[] = [];
    for (const outputItem of output) {
      if (!outputItem || typeof outputItem !== 'object') continue;
      const content = Array.isArray((outputItem as JsonValue).content)
        ? ((outputItem as JsonValue).content as unknown[])
        : [];
      for (const contentItem of content) {
        if (!contentItem || typeof contentItem !== 'object') continue;
        const item = contentItem as JsonValue;
        const text = item.text;
        if (typeof text === 'string' && text.trim()) {
          textParts.push(text.trim());
        }
        const transcript = item.transcript;
        if (typeof transcript === 'string' && transcript.trim()) {
          textParts.push(transcript.trim());
        }
      }
    }

    if (textParts.length) return textParts.join(' ');

    const fallback = response.output_text;
    if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();

    return '';
  }

  private extractErrorMessage(event: JsonValue): string {
    const err = event.error;
    if (!err || typeof err !== 'object') return '';
    const message = (err as JsonValue).message;
    return typeof message === 'string' ? message : '';
  }

  private extractErrorCode(event: JsonValue): string {
    const err = event.error;
    if (!err || typeof err !== 'object') return '';
    const code = (err as JsonValue).code;
    return typeof code === 'string' ? code : '';
  }

  private extractTranscript(event: JsonValue): string {
    const direct = event.transcript;
    if (typeof direct === 'string' && direct.trim()) {
      return direct.trim();
    }

    const item = event.item;
    if (item && typeof item === 'object') {
      const content = Array.isArray((item as JsonValue).content)
        ? ((item as JsonValue).content as unknown[])
        : [];
      for (const contentItem of content) {
        if (!contentItem || typeof contentItem !== 'object') continue;
        const maybeTranscript = (contentItem as JsonValue).transcript;
        if (typeof maybeTranscript === 'string' && maybeTranscript.trim()) {
          return maybeTranscript.trim();
        }
      }
    }

    return '';
  }
}
