import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type RawData } from 'ws';

type TwilioPayload = Record<string, unknown>;

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3000;
const WS_PATH = '/twilio-media';

let connectionCounter = 0;

function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, meta?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  if (meta && Object.keys(meta).length > 0) {
    console.log(`[${ts}] [${level}] ${message}`, meta);
    return;
  }
  console.log(`[${ts}] [${level}] ${message}`);
}

function getPathFromRequest(req: IncomingMessage): string {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    return url.pathname;
  } catch {
    return '/';
  }
}

function safeParseJson(raw: string): { ok: true; value: TwilioPayload } | { ok: false; reason: string } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'payload_is_not_an_object' };
    }
    return { ok: true, value: parsed as TwilioPayload };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'invalid_json',
    };
  }
}

function rawDataToUtf8(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return '';
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sendText(res: ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(body);
}

const server = http.createServer((req, res) => {
  const path = getPathFromRequest(req);
  if (path === '/' || path === '/healthz') {
    sendText(res, 200, 'ok');
    return;
  }
  sendText(res, 404, 'not found');
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const path = getPathFromRequest(req);

  if (path !== WS_PATH) {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  const connectionId = ++connectionCounter;
  const remoteAddress = asString(req.headers['x-forwarded-for']) || req.socket.remoteAddress || 'unknown';
  let streamSid = '';

  log('INFO', 'twilio websocket connected', { connectionId, remoteAddress, path: WS_PATH });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      log('WARN', 'binary websocket frame ignored', { connectionId });
      return;
    }

    const raw = rawDataToUtf8(data);
    if (!raw) {
      log('WARN', 'empty websocket frame ignored', { connectionId });
      return;
    }

    const parsed = safeParseJson(raw);
    if (!parsed.ok) {
      log('WARN', 'invalid twilio message ignored', {
        connectionId,
        reason: parsed.reason,
      });
      return;
    }

    const payload = parsed.value;
    const event = asString(payload.event) || 'unknown';

    if (event === 'connected') {
      log('INFO', 'twilio event: connected', { connectionId });
      return;
    }

    if (event === 'start') {
      const start = payload.start && typeof payload.start === 'object' ? (payload.start as TwilioPayload) : {};
      streamSid = asString(start.streamSid) || asString(payload.streamSid);
      log('INFO', 'twilio event: start', {
        connectionId,
        streamSid,
        callSid: asString(start.callSid),
      });
      return;
    }

    if (event === 'media') {
      const media = payload.media && typeof payload.media === 'object' ? (payload.media as TwilioPayload) : {};
      const mediaPayload = asString(media.payload);
      log('INFO', 'twilio event: media', {
        connectionId,
        streamSid: streamSid || asString(payload.streamSid),
        chunk: asString(media.chunk),
        timestamp: asString(media.timestamp),
        payloadBytes: mediaPayload ? Buffer.byteLength(mediaPayload, 'utf8') : 0,
      });
      return;
    }

    if (event === 'stop') {
      const stop = payload.stop && typeof payload.stop === 'object' ? (payload.stop as TwilioPayload) : {};
      log('INFO', 'twilio event: stop', {
        connectionId,
        streamSid: streamSid || asString(stop.streamSid) || asString(payload.streamSid),
        callSid: asString(stop.callSid),
      });
      return;
    }

    log('INFO', 'twilio event: unhandled', { connectionId, event });
  });

  ws.on('close', (code, reason) => {
    log('INFO', 'twilio websocket close', {
      connectionId,
      streamSid,
      code,
      reason: Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || ''),
    });
  });

  ws.on('error', (error) => {
    log('ERROR', 'twilio websocket error', {
      connectionId,
      streamSid,
      error: error.message,
    });
  });
});

server.on('error', (error) => {
  log('ERROR', 'http server error', { error: error.message });
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  log('ERROR', 'unhandled promise rejection', { error: message });
});

process.on('uncaughtException', (error) => {
  log('ERROR', 'uncaught exception', { error: error.message });
});

server.listen(PORT, () => {
  log('INFO', 'twilio media bridge listening', {
    port: PORT,
    health: '/',
    healthz: '/healthz',
    websocket: WS_PATH,
  });
});
