import WebSocket from 'ws';
import type { Logger } from '../utils/logger.js';

type HandlerSet = {
  onAssistantText: (text: string) => void;
  onCallerSpeechStart?: () => void;
  onCallerSpeechStop?: () => void;
  onError?: (error: Error) => void;
};

export type OpenAiRealtimeConfig = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  vadThreshold: number;
};

type JsonValue = Record<string, unknown>;

export class OpenAiRealtimeTextBrain {
  private socket: WebSocket | null = null;
  private connected = false;
  private pendingTextByResponseId = new Map<string, string>();
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
      this.logger.warn('OpenAI Realtime socket gesloten', {
        code,
        reason: reason.toString(),
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
      if (this.queuedAudio.length > 100) {
        this.queuedAudio.splice(0, this.queuedAudio.length - 100);
      }
      return;
    }
    this.send({
      type: 'input_audio_buffer.append',
      audio: base64Ulaw8k,
    });
  }

  cancelResponse(): void {
    this.send({ type: 'response.cancel' });
  }

  close(): void {
    this.connected = false;
    this.pendingTextByResponseId.clear();
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1000, 'bridge_shutdown');
    }
    this.socket = null;
  }

  private sendSessionUpdate(): void {
    const session = {
      instructions: this.cfg.systemPrompt,
      output_modalities: ['text'],
      // Compat voor verschillende Realtime payload-shapes.
      input_audio_format: 'g711_ulaw',
      turn_detection: {
        type: 'server_vad',
        threshold: this.cfg.vadThreshold,
        create_response: true,
        interrupt_response: true,
      },
      audio: {
        input: {
          format: { type: 'audio/pcmu' },
          turn_detection: {
            type: 'server_vad',
            threshold: this.cfg.vadThreshold,
            create_response: true,
            interrupt_response: true,
          },
        },
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
      this.logger.error('OpenAI realtime event error', event);
      const message = this.extractErrorMessage(event) || 'Onbekende OpenAI realtime fout';
      this.handlers.onError?.(new Error(message));
      return;
    }

    if (type === 'session.updated') {
      this.logger.info('OpenAI sessie geupdate');
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

    if (type === 'response.output_text.delta' || type === 'response.text.delta') {
      const responseId = this.extractResponseId(event) || 'unknown';
      const delta = String(event.delta || '');
      if (!delta) return;
      const existing = this.pendingTextByResponseId.get(responseId) || '';
      this.pendingTextByResponseId.set(responseId, existing + delta);
      return;
    }

    if (type === 'response.output_text.done' || type === 'response.text.done') {
      const responseId = this.extractResponseId(event) || 'unknown';
      const finalText = String(event.text || event.delta || '');
      if (!finalText) return;
      const existing = this.pendingTextByResponseId.get(responseId) || '';
      this.pendingTextByResponseId.set(responseId, `${existing}${finalText}`);
      return;
    }

    if (type === 'response.done' || type === 'response.completed') {
      const response = (event.response || {}) as JsonValue;
      const responseId = String(response.id || this.extractResponseId(event) || 'unknown');
      const fromBuffer = this.pendingTextByResponseId.get(responseId) || '';
      const fromPayload = this.extractTextFromResponse(response);
      const text = (fromBuffer || fromPayload).trim();

      if (responseId) this.pendingTextByResponseId.delete(responseId);

      if (text) {
        this.handlers.onAssistantText(text);
      }
      return;
    }
  }

  private extractResponseId(event: JsonValue): string {
    const direct = event.response_id;
    if (typeof direct === 'string' && direct) return direct;

    const response = event.response;
    if (response && typeof response === 'object' && typeof (response as JsonValue).id === 'string') {
      return String((response as JsonValue).id);
    }

    const itemId = event.item_id;
    if (typeof itemId === 'string' && itemId) return itemId;

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
}
