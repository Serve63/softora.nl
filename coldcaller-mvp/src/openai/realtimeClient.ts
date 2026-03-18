import WebSocket from 'ws';
import type { Logger } from '../utils/logger.js';

type HandlerSet = {
  onAssistantText: (text: string) => void;
  onCallerSpeechStart?: () => void;
  onCallerSpeechStop?: () => void;
  onCallerTranscript?: (text: string) => void;
  onError?: (error: Error) => void;
};

export type OpenAiRealtimeConfig = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  vadThreshold: number;
  vadPrefixPaddingMs: number;
  vadSilenceDurationMs: number;
};

type JsonValue = Record<string, unknown>;

export class OpenAiRealtimeTextBrain {
  private socket: WebSocket | null = null;
  private connected = false;
  private pendingTextByResponseId = new Map<string, string>();
  private completedResponseIds = new Set<string>();
  private queuedAudio: string[] = [];
  private lastCommitAndRespondAtMs = 0;
  private hasUncommittedAudio = false;
  private hasActiveResponse = false;

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
      this.hasUncommittedAudio = true;
      if (this.queuedAudio.length > 100) {
        this.queuedAudio.splice(0, this.queuedAudio.length - 100);
      }
      return;
    }
    this.hasUncommittedAudio = true;
    this.send({
      type: 'input_audio_buffer.append',
      audio: base64Ulaw8k,
    });
  }

  cancelResponse(): void {
    if (!this.hasActiveResponse) return;
    this.send({ type: 'response.cancel' });
  }

  requestResponseFromInputBuffer(reason = 'manual'): void {
    if (!this.hasUncommittedAudio) {
      this.logger.debug('OpenAI commit overgeslagen: geen nieuwe audio', { reason });
      return;
    }

    this.logger.debug('OpenAI commit + response.create', { reason });
    this.send({ type: 'input_audio_buffer.commit' });
    this.requestResponse(reason);
    this.hasUncommittedAudio = false;
  }

  requestResponse(reason = 'manual'): void {
    const now = Date.now();
    if (now - this.lastCommitAndRespondAtMs < 250) {
      return;
    }
    this.lastCommitAndRespondAtMs = now;

    this.logger.debug('OpenAI response.create', { reason });
    this.send({
      type: 'response.create',
      response: {
        modalities: ['text'],
      },
    });
  }

  close(): void {
    this.connected = false;
    this.pendingTextByResponseId.clear();
    this.completedResponseIds.clear();
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
- Geef korte, zakelijke antwoorden (max 2-3 zinnen).
- Stel per beurt maximaal 1 vraag.
- Verzin nooit wat de prospect gezegd zou hebben.
- Ga nooit door naar een volgende stap zonder expliciete reactie van de prospect.
- Bij stilte: stel maximaal 1 korte follow-up en wacht dan.
- Bij een expliciete afwijzing (zoals "geen interesse", "geen behoefte", "nee bedankt"): bedank kort en sluit netjes af zonder nieuwe afspraakvraag.
- Nooit gedichten, verhalen, recepten of random entertainmenttekst.`,
      modalities: ['text'],
      input_audio_format: 'g711_ulaw',
      temperature: 0.6,
      max_response_output_tokens: 70,
      turn_detection: {
        type: 'server_vad',
        threshold: this.cfg.vadThreshold,
        prefix_padding_ms: this.cfg.vadPrefixPaddingMs,
        silence_duration_ms: this.cfg.vadSilenceDurationMs,
        create_response: false,
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
      if (code === 'input_audio_buffer_commit_empty') {
        this.logger.debug('OpenAI commit genegeerd: nog niet genoeg audio in buffer');
        return;
      }
      if (code === 'response_cancel_not_active') {
        this.logger.debug('OpenAI cancel genegeerd: geen actieve response');
        return;
      }
      this.logger.error('OpenAI realtime event error', event);
      const message = this.extractErrorMessage(event) || 'Onbekende OpenAI realtime fout';
      this.handlers.onError?.(new Error(message));
      return;
    }

    if (type === 'response.created') {
      this.hasActiveResponse = true;
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

    if (type === 'input_audio_buffer.committed') {
      this.logger.debug('OpenAI input audio buffer committed');
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
      const finalText = String(event.text || event.delta || '').trim();
      if (!finalText) return;
      const existing = (this.pendingTextByResponseId.get(responseId) || '').trim();

      // Sommige Realtime events leveren op *.done de volledige tekst terug.
      // Voorkom dubbele zinnen wanneer delta's al zijn opgebouwd.
      if (!existing) {
        this.pendingTextByResponseId.set(responseId, finalText);
        return;
      }

      if (finalText === existing) {
        return;
      }

      if (finalText.startsWith(existing)) {
        this.pendingTextByResponseId.set(responseId, finalText);
        return;
      }

      if (existing.startsWith(finalText) || existing.endsWith(finalText)) {
        return;
      }

      this.pendingTextByResponseId.set(responseId, `${existing} ${finalText}`.trim());
      return;
    }

    if (type === 'response.done' || type === 'response.completed') {
      this.hasActiveResponse = false;
      const response = (event.response || {}) as JsonValue;
      const responseId = String(response.id || this.extractResponseId(event) || 'unknown');

      if (responseId && this.completedResponseIds.has(responseId)) {
        return;
      }

      const fromBuffer = this.pendingTextByResponseId.get(responseId) || '';
      const fromPayload = this.extractTextFromResponse(response);
      const text = (fromBuffer || fromPayload).trim();

      if (responseId) this.pendingTextByResponseId.delete(responseId);

      if (text) {
        if (responseId) this.completedResponseIds.add(responseId);
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
