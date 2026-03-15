import type { IncomingMessage, ServerResponse } from 'node:http';

type RequestLike = IncomingMessage & { method?: string };
type ResponseLike = ServerResponse<IncomingMessage>;

const ALLOWED_CALLER_DIGITS = '31629917185';
const ALLOWED_CALLER_NATIONAL = '0629917185';
const ALLOWED_CALLER_E164 = '+31629917185';
const ALLOWED_MIN_ANSWER_DELAY_MS = 4000;
const ALLOWED_MAX_ANSWER_DELAY_MS = 6000;
const BLOCKED_RING_DELAY_MS = 10000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomIntBetween(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalizePhone(value: string): string {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return `31${digits.slice(1)}`;
  return digits;
}

function getUrl(req: RequestLike): URL {
  return new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
}

function parseFormFromBody(body: string): string {
  const form = new URLSearchParams(body);
  return String(form.get('From') || '').trim();
}

async function readRawBody(req: RequestLike): Promise<string> {
  return await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => {
      resolve('');
    });
  });
}

async function extractCallerNumber(req: RequestLike): Promise<string> {
  const url = getUrl(req);
  const fromFromQuery = String(url.searchParams.get('From') || '').trim();
  if (fromFromQuery) return fromFromQuery;

  const method = String(req.method || 'GET').toUpperCase();
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (method === 'POST' && contentType.includes('application/x-www-form-urlencoded')) {
    const rawBody = await readRawBody(req);
    if (!rawBody) return '';
    return parseFormFromBody(rawBody);
  }

  return '';
}

function isAllowedCaller(rawCaller: string): boolean {
  const normalized = normalizePhone(rawCaller);
  return (
    normalized === ALLOWED_CALLER_DIGITS ||
    normalized === normalizePhone(ALLOWED_CALLER_NATIONAL) ||
    normalized === normalizePhone(ALLOWED_CALLER_E164)
  );
}

function sendXml(res: ResponseLike, xml: string): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/xml');
  res.end(xml);
}

export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
  const caller = await extractCallerNumber(req);

  if (!isAllowedCaller(caller)) {
    await wait(BLOCKED_RING_DELAY_MS);
    sendXml(
      res,
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Reject reason="rejected" />
</Response>`
    );
    return;
  }

  await wait(randomIntBetween(ALLOWED_MIN_ANSWER_DELAY_MS, ALLOWED_MAX_ANSWER_DELAY_MS));

  sendXml(
    res,
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://twilio-media-bridge-pjzd.onrender.com/twilio-media" />
  </Connect>
</Response>`
  );
}
