import WebSocket from 'ws';
import type { AppConfig } from '../config.js';
import { chunkUlaw, estimateUlawEnergy, sleep } from '../audio/ulaw.js';
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
            this.logger.debug('Assistant antwoord genegeerd (geen nieuwe caller activiteit)');
            return;
          }
          this.callerActivitySinceLastAssistant = false;
          this.assistantTurnsSent += 1;
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
    const energy = estimateUlawEnergy(audioBuffer);
    const now = Date.now();
    const isAssistantSpeaking = Boolean(this.activeSpeechAbort);
    let interruptedForBargeIn = false;

    if (!isAssistantSpeaking && energy >= 0.02) {
      this.callerActivitySinceLastAssistant = true;
    }

    if (isAssistantSpeaking) {
      const now = Date.now();
      const minPlaybackMsBeforeBargeIn = 300;
      const bargeInEnergyThreshold = 0.03;
      const bargeInFramesNeeded = 3;

      if (now - this.assistantPlaybackStartedAtMs >= minPlaybackMsBeforeBargeIn && energy >= bargeInEnergyThreshold) {
        this.bargeInFramesAboveThreshold += 1;
      } else {
        this.bargeInFramesAboveThreshold = 0;
      }

      if (this.bargeInFramesAboveThreshold >= bargeInFramesNeeded) {
        this.bargeInFramesAboveThreshold = 0;
        this.interrupt('inbound_energy_detected');
        interruptedForBargeIn = true;
      }
    }

    // Voorkom echo-loop: tijdens TTS-playback géén inbound audio naar OpenAI sturen,
    // behalve als er echte barge-in is gedetecteerd en playback net is onderbroken.
    if (isAssistantSpeaking && !interruptedForBargeIn) {
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
      return;
    }

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
      const prebufferFrames = 6; // ~120ms bij 20ms frames
      const maxQueueFrames = 300; // cap om geheugen te beschermen (~6s audio)
      let producerDone = false;
      let producerError: Error | null = null;
      let playbackStarted = false;

      const producerPromise = this.tts.streamUlaw(
        cleaned,
        async (chunk) => {
          if (this.isClosed || speechAbort.signal.aborted) return;
          const frames = chunkUlaw(chunk, 160);
          for (const frame of frames) {
            if (this.isClosed || speechAbort.signal.aborted) return;
            frameQueue.push(frame);
            if (frameQueue.length > maxQueueFrames) {
              frameQueue.shift();
            }
          }
        },
        speechAbort.signal
      )
        .then(() => {
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
        }

        if (!frameQueue.length) {
          if (producerDone) break;
          await sleep(10);
          continue;
        }

        const frame = frameQueue.shift();
        if (!frame) continue;
        this.sendTwilioMedia(frame);
        await sleep(20);
      }

      await producerPromise;
      if (producerError && !speechAbort.signal.aborted) {
        throw producerError;
      }
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
  }
}
