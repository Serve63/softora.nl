import WebSocket from 'ws';
import type { AppConfig } from '../config.js';
import { estimateUlawEnergy, sleep } from '../audio/ulaw.js';
import { OpenAiRealtimeAudioBrain } from '../openai/realtimeClient.js';
import type { Logger } from '../utils/logger.js';

type TwilioStartPayload = {
  streamSid?: string;
  callSid?: string;
  tracks?: string[];
  customParameters?: Record<string, string>;
};

type TwilioMediaPayload = {
  track?: string;
  payload?: string;
};

type TwilioInboundEvent = {
  event?: string;
  streamSid?: string;
  start?: TwilioStartPayload;
  media?: TwilioMediaPayload;
  stop?: Record<string, unknown>;
};

export class CallBridgeSession {
  private readonly brain: OpenAiRealtimeAudioBrain;

  private streamSid = '';
  private callSid = '';
  private streamStartedAtMs = 0;
  private firstAssistantAudioAtMs = 0;
  private isClosed = false;

  private openAiResponseActive = false;
  private assistantOutputActive = false;
  private assistantOutputActiveUntilMs = 0;
  private assistantPlaybackStartedAtMs = 0;
  private lastAssistantPlaybackEndedAtMs = 0;
  private bargeInFramesAboveThreshold = 0;

  private outputFrameCarry = Buffer.alloc(0);
  private readonly outputFrameQueue: Buffer[] = [];
  private outputPumpRunning = false;

  private readonly metrics = {
    startedAtMs: Date.now(),
    inboundMediaEvents: 0,
    inboundAudioBytes: 0,
    forwardedMediaEvents: 0,
    forwardedAudioBytes: 0,
    droppedDuringPlaybackEvents: 0,
    droppedPostPlaybackEchoEvents: 0,
    bargeInInterrupts: 0,
    assistantAudioChunks: 0,
    assistantAudioBytes: 0,
    assistantFramesSent: 0,
    outputQueueMaxDepth: 0,
    outputQueueUnderflows: 0,
    totalAssistantPlaybackMs: 0,
  };

  constructor(
    private readonly ws: WebSocket,
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {
    this.brain = new OpenAiRealtimeAudioBrain(
      {
        apiKey: this.config.openai.apiKey,
        model: this.config.openai.realtimeModel,
        voice: this.config.openai.voice,
        systemPrompt: this.config.agent.systemPrompt,
        vadThreshold: this.config.openai.vadThreshold,
        vadPrefixPaddingMs: this.config.openai.vadPrefixPaddingMs,
        vadSilenceDurationMs: this.config.openai.vadSilenceDurationMs,
      },
      {
        onAssistantAudio: (base64) => this.handleAssistantAudioChunk(base64),
        onAssistantText: (text) => {
          this.logger.info('Assistant antwoord (tekst)', {
            callSid: this.callSid || null,
            chars: text.length,
            preview: text.slice(0, 220),
          });
        },
        onAssistantResponseStarted: () => {
          this.openAiResponseActive = true;
        },
        onAssistantResponseDone: () => {
          this.openAiResponseActive = false;
        },
        onCallerSpeechStart: () => {
          this.logger.debug('Caller speech gestart (OpenAI VAD)');
        },
        onCallerSpeechStop: () => {
          this.logger.debug('Caller speech gestopt (OpenAI VAD)');
        },
        onCallerTranscript: (text) => {
          this.logger.info('Caller transcript', {
            callSid: this.callSid || null,
            chars: text.length,
            text: text.slice(0, 260),
          });
        },
        onError: (error) => {
          this.logger.error('OpenAI brain error', error);
        },
      },
      this.logger.child('openai')
    );

    this.attachSocketHandlers();

    void this.brain.connect().catch((error) => {
      this.logger.error('Kon OpenAI Realtime niet verbinden', error);
      this.shutdown('openai_connect_failed');
    });
  }

  private attachSocketHandlers(): void {
    this.ws.on('message', (raw) => this.handleTwilioMessage(raw));
    this.ws.on('close', (code, reason) => {
      this.logger.info('Twilio websocket gesloten', {
        callSid: this.callSid || null,
        streamSid: this.streamSid || null,
        code,
        reason: reason.toString(),
      });
      this.shutdown('twilio_ws_closed');
    });
    this.ws.on('error', (error) => {
      this.logger.error('Twilio websocket error', error);
      this.shutdown('twilio_ws_error');
    });
  }

  private handleTwilioMessage(raw: WebSocket.RawData): void {
    if (this.isClosed) return;

    let message: TwilioInboundEvent;
    try {
      message = JSON.parse(raw.toString('utf8')) as TwilioInboundEvent;
    } catch (error) {
      this.logger.warn('Kon Twilio event niet parsen', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const eventType = String(message.event || '').toLowerCase();

    if (eventType === 'start') {
      this.streamSid = String(message.start?.streamSid || message.streamSid || '');
      this.callSid = String(message.start?.callSid || '');
      this.streamStartedAtMs = Date.now();
      this.logger.info('Twilio stream gestart', {
        callSid: this.callSid || null,
        streamSid: this.streamSid || null,
        tracks: message.start?.tracks || [],
        customParameters: message.start?.customParameters || {},
      });
      return;
    }

    if (eventType === 'media') {
      const media = message.media || {};
      const payload = String(media.payload || '');
      const track = String(media.track || 'inbound');

      if (!payload) return;
      if (track !== 'inbound') return;

      this.handleInboundAudio(payload);
      return;
    }

    if (eventType === 'stop') {
      this.logger.info('Twilio stop event ontvangen', {
        callSid: this.callSid || null,
        streamSid: this.streamSid || null,
      });
      this.shutdown('twilio_stop_event');
      return;
    }
  }

  private handleInboundAudio(base64Payload: string): void {
    if (!base64Payload) return;

    const audioBuffer = Buffer.from(base64Payload, 'base64');
    this.metrics.inboundMediaEvents += 1;
    this.metrics.inboundAudioBytes += audioBuffer.length;

    const energy = estimateUlawEnergy(audioBuffer);
    const now = Date.now();
    const isAssistantSpeaking = this.isAssistantSpeaking(now);
    let interruptedForBargeIn = false;

    if (isAssistantSpeaking) {
      // Conservatiever barge-in om false interrupts (en daarmee stotterende playback) te vermijden.
      const minPlaybackMsBeforeBargeIn = 900;
      const bargeInEnergyThreshold = 0.075;
      const bargeInFramesNeeded = 9;

      if (now - this.assistantPlaybackStartedAtMs >= minPlaybackMsBeforeBargeIn && energy >= bargeInEnergyThreshold) {
        this.bargeInFramesAboveThreshold += 1;
      } else {
        this.bargeInFramesAboveThreshold = 0;
      }

      if (this.bargeInFramesAboveThreshold >= bargeInFramesNeeded) {
        this.bargeInFramesAboveThreshold = 0;
        this.metrics.bargeInInterrupts += 1;
        this.interrupt('inbound_energy_detected');
        interruptedForBargeIn = true;
      }
    }

    // Tijdens assistant-audio inbound niet doorsturen (echo-protectie),
    // behalve tijdens echte barge-in interrupt.
    if (isAssistantSpeaking && !interruptedForBargeIn) {
      this.metrics.droppedDuringPlaybackEvents += 1;
      return;
    }

    // Kort na assistant-audio lage-energie echo ook droppen.
    const postPlaybackEchoWindowMs = 420;
    const postPlaybackHighEnergyThreshold = 0.045;
    if (
      !isAssistantSpeaking &&
      now - this.lastAssistantPlaybackEndedAtMs < postPlaybackEchoWindowMs &&
      energy < postPlaybackHighEnergyThreshold
    ) {
      this.metrics.droppedPostPlaybackEchoEvents += 1;
      return;
    }

    this.metrics.forwardedMediaEvents += 1;
    this.metrics.forwardedAudioBytes += audioBuffer.length;
    this.brain.appendInputAudio(base64Payload);
  }

  private isAssistantSpeaking(now: number): boolean {
    // Alleen als er daadwerkelijk audio-output is (of net was) behandelen we dit als "assistant spreekt".
    // Een actieve OpenAI response zonder audio mag inbound caller-audio niet blokkeren.
    if (this.assistantOutputActive) return true;
    if (this.outputFrameQueue.length > 0) return true;
    return now < this.assistantOutputActiveUntilMs;
  }

  private handleAssistantAudioChunk(base64Ulaw8k: string): void {
    if (this.isClosed || !this.streamSid) return;
    if (!base64Ulaw8k) return;

    const chunk = Buffer.from(base64Ulaw8k, 'base64');
    if (!chunk.length) return;

    if (!this.firstAssistantAudioAtMs) {
      this.firstAssistantAudioAtMs = Date.now();
    }

    this.metrics.assistantAudioChunks += 1;
    this.metrics.assistantAudioBytes += chunk.length;

    const combined = this.outputFrameCarry.length ? Buffer.concat([this.outputFrameCarry, chunk]) : chunk;
    let offset = 0;
    while (offset + 160 <= combined.length) {
      this.outputFrameQueue.push(combined.subarray(offset, offset + 160));
      offset += 160;
    }
    this.outputFrameCarry = Buffer.from(combined.subarray(offset));
    if (this.outputFrameQueue.length > this.metrics.outputQueueMaxDepth) {
      this.metrics.outputQueueMaxDepth = this.outputFrameQueue.length;
    }

    this.assistantOutputActive = true;
    this.assistantOutputActiveUntilMs = Date.now() + 600;
    if (!this.assistantPlaybackStartedAtMs) {
      this.assistantPlaybackStartedAtMs = Date.now();
    }

    void this.startOutputPump();
  }

  private async startOutputPump(): Promise<void> {
    if (this.outputPumpRunning) return;
    this.outputPumpRunning = true;

    const pumpStartedAtMs = Date.now();
    const prebufferFrames = 6; // ~120ms
    let playbackStarted = false;
    let nextFrameAtMs = 0;
    let queueStarved = false;

    try {
      while (!this.isClosed) {
        if (!playbackStarted) {
          if (this.openAiResponseActive && this.outputFrameQueue.length < prebufferFrames) {
            await sleep(6);
            continue;
          }
          playbackStarted = this.outputFrameQueue.length > 0 || !this.openAiResponseActive;
          if (!playbackStarted) {
            await sleep(6);
            continue;
          }
          nextFrameAtMs = Date.now();
        }

        if (!this.outputFrameQueue.length) {
          if (!this.openAiResponseActive) {
            if (this.outputFrameCarry.length > 0) {
              const padded = Buffer.alloc(160, 0xff);
              this.outputFrameCarry.copy(padded, 0, 0, this.outputFrameCarry.length);
              this.outputFrameQueue.push(padded);
              this.outputFrameCarry = Buffer.alloc(0);
              continue;
            }
            break;
          }

          if (!queueStarved) {
            this.metrics.outputQueueUnderflows += 1;
            queueStarved = true;
          }
          await sleep(8);
          continue;
        }
        queueStarved = false;

        const frame = this.outputFrameQueue.shift();
        if (!frame) continue;
        const now = Date.now();
        if (nextFrameAtMs > now) {
          await sleep(nextFrameAtMs - now);
        } else if (now - nextFrameAtMs > 120) {
          // Klok opnieuw syncen bij event-loop jitter, voorkomt bursts.
          nextFrameAtMs = now;
        }
        this.sendTwilioMedia(frame);
        this.metrics.assistantFramesSent += 1;
        nextFrameAtMs += 20;
      }
    } finally {
      this.metrics.totalAssistantPlaybackMs += Date.now() - pumpStartedAtMs;
      this.lastAssistantPlaybackEndedAtMs = Date.now();
      this.assistantPlaybackStartedAtMs = 0;
      this.assistantOutputActive = false;
      this.assistantOutputActiveUntilMs = Date.now() + 220;
      this.outputPumpRunning = false;

      if (!this.isClosed && this.outputFrameQueue.length > 0) {
        void this.startOutputPump();
      }
    }
  }

  private interrupt(reason: string, cancelOpenAiResponse = true): void {
    if (cancelOpenAiResponse) {
      this.brain.cancelResponse();
    }

    this.openAiResponseActive = false;
    this.assistantOutputActive = false;
    this.assistantOutputActiveUntilMs = 0;
    this.outputFrameQueue.length = 0;
    this.outputFrameCarry = Buffer.alloc(0);
    this.assistantPlaybackStartedAtMs = 0;
    this.lastAssistantPlaybackEndedAtMs = Date.now();
    this.bargeInFramesAboveThreshold = 0;

    if (this.streamSid) {
      this.sendTwilioEvent({
        event: 'clear',
        streamSid: this.streamSid,
      });
    }

    this.logger.debug('Playback interrupt uitgevoerd', {
      callSid: this.callSid || null,
      streamSid: this.streamSid || null,
      reason,
    });
  }

  private sendTwilioMedia(frame: Buffer): void {
    if (!this.streamSid || !frame.length) return;

    this.sendTwilioEvent({
      event: 'media',
      streamSid: this.streamSid,
      media: {
        payload: frame.toString('base64'),
      },
    });
  }

  private sendTwilioEvent(payload: Record<string, unknown>): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  private shutdown(reason: string): void {
    if (this.isClosed) return;
    this.isClosed = true;

    this.interrupt(`shutdown:${reason}`, false);
    this.brain.close();

    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, reason);
    }

    this.logger.info('Bridge sessie afgesloten', {
      reason,
      callSid: this.callSid || null,
      streamSid: this.streamSid || null,
    });

    const durationMs = Date.now() - this.metrics.startedAtMs;
    const firstAssistantResponseLatencyMs =
      this.streamStartedAtMs && this.firstAssistantAudioAtMs
        ? Math.max(0, this.firstAssistantAudioAtMs - this.streamStartedAtMs)
        : null;
    this.logger.info('Bridge sessie metrics', {
      callSid: this.callSid || null,
      streamSid: this.streamSid || null,
      durationMs,
      firstAssistantResponseLatencyMs,
      inboundMediaEvents: this.metrics.inboundMediaEvents,
      inboundAudioBytes: this.metrics.inboundAudioBytes,
      forwardedMediaEvents: this.metrics.forwardedMediaEvents,
      forwardedAudioBytes: this.metrics.forwardedAudioBytes,
      droppedDuringPlaybackEvents: this.metrics.droppedDuringPlaybackEvents,
      droppedPostPlaybackEchoEvents: this.metrics.droppedPostPlaybackEchoEvents,
      bargeInInterrupts: this.metrics.bargeInInterrupts,
      assistantAudioChunks: this.metrics.assistantAudioChunks,
      assistantAudioBytes: this.metrics.assistantAudioBytes,
      assistantFramesSent: this.metrics.assistantFramesSent,
      outputQueueMaxDepth: this.metrics.outputQueueMaxDepth,
      outputQueueUnderflows: this.metrics.outputQueueUnderflows,
      totalAssistantPlaybackMs: this.metrics.totalAssistantPlaybackMs,
    });
  }
}
