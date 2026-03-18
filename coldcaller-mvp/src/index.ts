import http from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import twilio from 'twilio';
import { loadConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import { registerTwilioRoutes } from './twilio/routes.js';
import { CallBridgeSession } from './bridge/callBridgeSession.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger('coldcaller-mvp', config.server.logLevel);

  const app = express();
  app.disable('x-powered-by');

  // Twilio webhooks sturen standaard x-www-form-urlencoded.
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: '1mb' }));

  const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

  registerTwilioRoutes({
    app,
    config,
    twilioClient,
    logger: logger.child('http'),
  });

  app.get('/', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'coldcaller-mvp',
      message: 'Twilio + OpenAI Realtime + ElevenLabs bridge draait.',
      health: '/healthz',
      voiceWebhook: config.twilio.voiceWebhookPath,
      mediaWebsocket: '/twilio-media',
    });
  });

  const server = http.createServer(app);
  const wsServer = new WebSocketServer({ noServer: true });

  wsServer.on('connection', (socket, request) => {
    const remote = request.socket.remoteAddress || 'unknown';
    const sessionLogger = logger.child(`bridge:${remote}`);
    sessionLogger.info('Nieuwe Twilio media websocket connectie');
    new CallBridgeSession(socket, config, sessionLogger);
  });

  server.on('upgrade', (request, socket, head) => {
    const host = request.headers.host || 'localhost';
    const requestUrl = new URL(request.url || '/', `http://${host}`);

    if (requestUrl.pathname !== '/twilio-media') {
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (websocket) => {
      wsServer.emit('connection', websocket, request);
    });
  });

  server.listen(config.server.port, () => {
    logger.info('Coldcaller MVP server gestart', {
      port: config.server.port,
      publicBaseUrl: config.server.publicBaseUrl,
      publicWssUrl: config.server.publicWssUrl,
      voiceWebhookPath: config.twilio.voiceWebhookPath,
      realtimeModel: config.openai.realtimeModel,
      realtimeVoice: config.openai.voice,
      agentPromptSource: config.agent.promptSource,
      agentPromptChars: config.agent.systemPrompt.length,
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
