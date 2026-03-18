import WebSocket from 'ws';
import type { AppConfig } from '../config.js';
import { estimateUlawEnergy, sleep } from '../audio/ulaw.js';
import { ElevenLabsTtsClient } from '../elevenlabs/ttsClient.js';
import { OpenAiRealtimeTextBrain } from '../openai/realtimeClient.js';
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
  private readonly brain: OpenAiRealtimeTextBrain;
  private readonly tts: ElevenLabsTtsClient;

  private streamSid = '';
  private callSid = '';
  private isClosed = false;
  private activeSpeechAbort: AbortController | null = null;
  private assistantPlaybackStartedAtMs = 0;
  private lastAssistantPlaybackEndedAtMs = 0;
  private lastAssistantTurnStartedAtMs = 0;
  private bargeInFramesAboveThreshold = 0;
  private assistantTurnsSent = 0;
  private callerActivitySinceLastAssistant = false;
  private readonly metrics = {
    startedAtMs: Date.now(),
    inboundMediaEvents: 0,
    inboundAudioBytes: 0,
    forwardedMediaEvents: 0,
    forwardedAudioBytes: 0,
    droppedDuringPlaybackEvents: 0,
    droppedPostPlaybackEchoEvents: 0,
    bargeInInterrupts: 0,
    assistantTurnsSuppressed: 0,
    assistantTurnsPlayed: 0,
    ttsFramesSent: 0,
    ttsBytesSent: 0,
    ttsQueueMaxDepth: 0,
    ttsQueueUnderflows: 0,
    totalTtsPlaybackMs: 0,
  };

  constructor(
    private readonly ws: WebSocket,
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {
    this.tts = new ElevenLabsTtsClient(this.config.elevenlabs, this.logger.child('tts'));
    this.brain = new OpenAiRealtimeTextBrain(
      {
        apiKey: this.config.openai.apiKey,
        model: this.config.openai.realtimeModel,
        systemPrompt: this.config.agent.systemPrompt,
        vadThreshold: this.config.openai.vadThreshold,
      },
      {
        onAssistantText: (text) => {
          if (!this.shouldPlayAssistantText()) {
            this.metrics.assistantTurnsSuppressed += 1;
            this.logger.debug('Assistant antwoord genegeerd (geen nieuwe caller activiteit)');
            return;
          }
          this.callerActivitySinceLastAssistant = false;
          this.assistantTurnsSent += 1;
          this.metrics.assistantTurnsPlayed += 1;
          this.lastAssistantTurnStartedAtMs = Date.now();
          void this.speakAssistantText(text);
        },
        onCallerSpeechStart: () => {
          this.logger.debug('Caller speech gestart (OpenAI VAD)');
          if (!this.activeSpeechAbort) {
            this.callerActivitySinceLastAssistant = true;
          }
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
          this.callerActivitySinceLastAssistant = true;
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
    const isAssistantSpeaking = Boolean(this.activeSpeechAbort);
    let interruptedForBargeIn = false;

    if (!isAssistantSpeaking && energy >= 0.02) {
      this.callerActivitySinceLastAssistant = true;
    }

    if (isAssistantSpeaking) {
      const now = Date.now();
      const minPlaybackMsBeforeBargeIn = 900;
      const bargeInEnergyThreshold = 0.06;
      const bargeInFramesNeeded = 8;

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

    // Voorkom echo-loop: tijdens TTS-playback géén inbound audio naar OpenAI sturen,
    // behalve als er echte barge-in is gedetecteerd en playback net is onderbroken.
    if (isAssistantSpeaking && !interruptedForBargeIn) {
      this.metrics.droppedDuringPlaybackEvents += 1;
      return;
    }

    // Direct na het einde van TTS negeren we lage-energie echo-restjes.
    const postPlaybackEchoWindowMs = 550;
    const postPlaybackHighEnergyThreshold = 0.05;
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

  private shouldPlayAssistantText(): boolean {
    if (this.assistantTurnsSent === 0) {
      return true;
    }
    if (!this.callerActivitySinceLastAssistant) {
      return false;
    }

    const minGapBetweenAssistantTurnsMs = 1200;
    if (Date.now() - this.lastAssistantTurnStartedAtMs < minGapBetweenAssistantTurnsMs) {
      return false;
    }

    return true;
  }

  private async speakAssistantText(text: string): Promise<void> {
    const cleaned = text.trim();
    if (!cleaned || this.isClosed) return;

    // Nieuw antwoord start -> oude playback stoppen.
    this.interrupt('new_assistant_reply', false);

    const speechAbort = new AbortController();
    this.activeSpeechAbort = speechAbort;
    this.assistantPlaybackStartedAtMs = Date.now();
    this.bargeInFramesAboveThreshold = 0;

    this.logger.info('Assistant antwoord (tekst)', {
      callSid: this.callSid || null,
      chars: cleaned.length,
      preview: cleaned.slice(0, 220),
    });

    try {
      const frameQueue: Buffer[] = [];
      const prebufferFrames = 14; // ~280ms bij 20ms frames
      const maxQueueFrames = 2400; // ~48s audio cap, voorkomt onnodig frame-droppen
      let producerDone = false;
      let producerError: Error | null = null;
      let playbackStarted = false;
      let nextFrameAtMs = 0;
      let queueStarved = false;
      const ttsTurnStartedAtMs = Date.now();
      let frameCarry = Buffer.alloc(0);

      const enqueueFrame = (frame: Buffer) => {
        if (this.isClosed || speechAbort.signal.aborted) return;
        if (frameQueue.length < maxQueueFrames) {
          frameQueue.push(frame);
          if (frameQueue.length > this.metrics.ttsQueueMaxDepth) {
            this.metrics.ttsQueueMaxDepth = frameQueue.length;
          }
        }
      };

      const producerPromise = this.tts.streamUlaw(
        cleaned,
        async (chunk) => {
          if (this.isClosed || speechAbort.signal.aborted) return;
          const combined = frameCarry.length ? Buffer.concat([frameCarry, chunk]) : chunk;
          let offset = 0;
          while (offset + 160 <= combined.length) {
            enqueueFrame(combined.subarray(offset, offset + 160));
            offset += 160;
          }
          frameCarry = Buffer.from(combined.subarray(offset));
        },
        speechAbort.signal
      )
        .then(() => {
          if (!this.isClosed && !speechAbort.signal.aborted && frameCarry.length > 0) {
            // Laatste frame opvullen zodat pacing 20ms stabiel blijft.
            const padded = Buffer.alloc(160, 0xff);
            frameCarry.copy(padded, 0, 0, frameCarry.length);
            enqueueFrame(padded);
            frameCarry = Buffer.alloc(0);
          }
          producerDone = true;
        })
        .catch((error) => {
          producerDone = true;
          producerError = error as Error;
        });

      while (!this.isClosed && !speechAbort.signal.aborted) {
        if (!playbackStarted) {
          if (!producerDone && frameQueue.length < prebufferFrames) {
            await sleep(10);
            continue;
          }
          playbackStarted = frameQueue.length > 0 || producerDone;
          nextFrameAtMs = Date.now();
        }

        if (!frameQueue.length) {
          if (producerDone) break;
          if (!queueStarved) {
            this.metrics.ttsQueueUnderflows += 1;
            queueStarved = true;
          }
          await sleep(10);
          continue;
        }
        queueStarved = false;

        const frame = frameQueue.shift();
        if (!frame) continue;

        const now = Date.now();
        if (nextFrameAtMs > now) {
          await sleep(nextFrameAtMs - now);
        } else if (now - nextFrameAtMs > 120) {
          // Her-synchroniseer klok na event-loop/jitter spikes, voorkom burst playback.
          nextFrameAtMs = now;
        }

        this.sendTwilioMedia(frame);
        this.metrics.ttsFramesSent += 1;
        this.metrics.ttsBytesSent += frame.length;
        nextFrameAtMs += 20;
      }

      await producerPromise;
      if (producerError && !speechAbort.signal.aborted) {
        throw producerError;
      }
      this.metrics.totalTtsPlaybackMs += Date.now() - ttsTurnStartedAtMs;
    } catch (error) {
      if (speechAbort.signal.aborted) {
        this.logger.debug('TTS playback geannuleerd (interrupt)');
        return;
      }
      this.logger.error('TTS playback fout', error);
    } finally {
      if (this.activeSpeechAbort === speechAbort) {
        this.activeSpeechAbort = null;
      }
      this.lastAssistantPlaybackEndedAtMs = Date.now();
    }
  }

  private interrupt(reason: string, cancelOpenAiResponse = true): void {
    if (this.activeSpeechAbort) {
      this.activeSpeechAbort.abort();
      this.activeSpeechAbort = null;
    }
    this.bargeInFramesAboveThreshold = 0;

    if (cancelOpenAiResponse) {
      this.brain.cancelResponse();
    }

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

  private sendTwilioMedia(chunk: Buffer): void {
    if (!this.streamSid || !chunk.length) return;

    this.sendTwilioEvent({
      event: 'media',
      streamSid: this.streamSid,
      media: {
        payload: chunk.toString('base64'),
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
    this.logger.info('Bridge sessie metrics', {
      callSid: this.callSid || null,
      streamSid: this.streamSid || null,
      durationMs,
      inboundMediaEvents: this.metrics.inboundMediaEvents,
      inboundAudioBytes: this.metrics.inboundAudioBytes,
      forwardedMediaEvents: this.metrics.forwardedMediaEvents,
      forwardedAudioBytes: this.metrics.forwardedAudioBytes,
      droppedDuringPlaybackEvents: this.metrics.droppedDuringPlaybackEvents,
      droppedPostPlaybackEchoEvents: this.metrics.droppedPostPlaybackEchoEvents,
      bargeInInterrupts: this.metrics.bargeInInterrupts,
      assistantTurnsPlayed: this.metrics.assistantTurnsPlayed,
      assistantTurnsSuppressed: this.metrics.assistantTurnsSuppressed,
      ttsFramesSent: this.metrics.ttsFramesSent,
      ttsBytesSent: this.metrics.ttsBytesSent,
      ttsQueueMaxDepth: this.metrics.ttsQueueMaxDepth,
      ttsQueueUnderflows: this.metrics.ttsQueueUnderflows,
      totalTtsPlaybackMs: this.metrics.totalTtsPlaybackMs,
    });
  }
}
