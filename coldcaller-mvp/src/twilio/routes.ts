import type { Express, Request, Response } from 'express';
import twilio from 'twilio';
import type { Logger } from '../utils/logger.js';
import type { AppConfig } from '../config.js';

export type TwilioRoutesDeps = {
  app: Express;
  config: AppConfig;
  twilioClient: ReturnType<typeof twilio>;
  logger: Logger;
};

function buildVoiceWebhookUrl(cfg: AppConfig): string {
  return `${cfg.server.publicBaseUrl}${cfg.twilio.voiceWebhookPath}`;
}

function buildVoiceTwiml(cfg: AppConfig): string {
  const response = new twilio.twiml.VoiceResponse();
  const connect = response.connect();
  connect.stream({
    url: cfg.server.publicWssUrl,
  });
  return response.toString();
}

async function startOutboundCall(req: Request, res: Response, deps: TwilioRoutesDeps) {
  const to = String(req.body?.to || '').trim();
  const from = String(req.body?.from || deps.config.twilio.phoneNumber).trim();

  if (!to) {
    return res.status(400).json({
      ok: false,
      error: 'Body mist veld "to" met doelnummer in E.164 formaat.',
    });
  }

  try {
    const call = await deps.twilioClient.calls.create({
      to,
      from,
      url: buildVoiceWebhookUrl(deps.config),
      method: 'POST',
    });

    deps.logger.info('Outbound call gestart', {
      callSid: call.sid,
      to,
      from,
      status: call.status,
    });

    return res.status(201).json({
      ok: true,
      callSid: call.sid,
      status: call.status,
      to,
      from,
      webhookUrl: buildVoiceWebhookUrl(deps.config),
    });
  } catch (error) {
    deps.logger.error('Outbound call starten mislukt', error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Onbekende fout bij call start',
    });
  }
}

export function registerTwilioRoutes(deps: TwilioRoutesDeps): void {
  const { app, config, logger } = deps;

  app.post(config.twilio.voiceWebhookPath, (_req, res) => {
    const twiml = buildVoiceTwiml(config);
    res.type('text/xml').status(200).send(twiml);
  });

  // Handig tijdens lokaal testen in browser (GET) en voor failsafe op method mismatch.
  app.get(config.twilio.voiceWebhookPath, (_req, res) => {
    const twiml = buildVoiceTwiml(config);
    res.type('text/xml').status(200).send(twiml);
  });

  app.post('/api/calls/start', (req, res) => startOutboundCall(req, res, deps));

  app.get('/healthz', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'coldcaller-mvp',
      timestamp: new Date().toISOString(),
      voiceWebhookPath: config.twilio.voiceWebhookPath,
      mediaWsPath: '/twilio-media',
    });
  });

  logger.info('Twilio routes geregistreerd', {
    voiceWebhookPath: config.twilio.voiceWebhookPath,
    outboundStartPath: '/api/calls/start',
  });
}
