import readline from 'node:readline';

const SERVER_NAME = 'Softora WhatsApp Read Only';
const DEFAULT_BASE_URL = 'https://www.softora.nl';
const JsonRpcError = Object.freeze({ METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603 });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function requireReadToken() {
  const token = String(process.env.SOFTORA_WHATSAPP_READ_TOKEN || '').trim();
  if (!token) throw new Error('SOFTORA_WHATSAPP_READ_TOKEN ontbreekt; configureer de persoonlijke WhatsApp-plugin.');
  return token;
}

function baseUrl() {
  const value = String(process.env.SOFTORA_WHATSAPP_BASE_URL || DEFAULT_BASE_URL).trim();
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('SOFTORA_WHATSAPP_BASE_URL moet HTTPS gebruiken.');
  }
  parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed;
}

function optionalString(value, name, maxLength = 500) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`${name} is ongeldig.`);
  return value.trim();
}

function readInput(args = {}) {
  const limit = args.limit === undefined ? 80 : Number(args.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('limit moet een geheel getal tussen 1 en 500 zijn.');
  return {
    contact: optionalString(args.contact, 'contact', 200),
    query: optionalString(args.query, 'query', 500),
    after: optionalString(args.after, 'after', 100),
    before: optionalString(args.before, 'before', 100),
    limit,
  };
}

async function softoraGet(pathname, params = {}) {
  const url = new URL(pathname, baseUrl());
  for (const [key, value] of Object.entries(params)) {
    if (value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${requireReadToken()}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    const publicMessage = typeof body?.error === 'string' ? body.error : `WhatsApp lezen mislukte (${response.status}).`;
    throw new Error(publicMessage);
  }
  return body;
}

function toolResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

async function handleToolCall(id, params) {
  if (params?.name === 'whatsapp_status') {
    sendResult(id, toolResult(await softoraGet('/api/whatsapp/status')));
    return;
  }
  if (params?.name === 'read_whatsapp') {
    sendResult(id, toolResult(await softoraGet('/api/whatsapp/messages', readInput(params.arguments))));
    return;
  }
  sendError(id, JsonRpcError.INVALID_PARAMS, `Onbekende tool: ${params?.name || ''}`);
}

async function handleRequest(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: params?.protocolVersion || '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: '0.1.0' },
      instructions: 'Lees uitsluitend Servé zijn versleutelde WhatsApp Business-archief; sturen, wijzigen en verwijderen bestaan niet.',
    });
    return;
  }
  if (method === 'ping') return sendResult(id, {});
  if (method === 'tools/list') {
    sendResult(id, {
      tools: [
        {
          name: 'whatsapp_status',
          title: 'WhatsApp-koppelingsstatus',
          description: 'Controleer read-only of de WhatsApp Business-koppeling actief is en hoe ver ondersteunde historie is ingelezen.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        {
          name: 'read_whatsapp',
          title: 'WhatsApp lezen',
          description: 'Lees of doorzoek uitsluitend opgeslagen WhatsApp Business-berichten. Deze tool kan niets versturen, wijzigen of verwijderen.',
          inputSchema: {
            type: 'object',
            properties: {
              contact: { type: 'string', description: 'Optionele exacte contactnaam, naamdeel of telefoonnummer.' },
              query: { type: 'string', description: 'Optionele woorden die allemaal in de versleutelde berichtindex moeten voorkomen.' },
              after: { type: 'string', description: 'Optionele inclusieve begindatum als ISO 8601-datum/tijd.' },
              before: { type: 'string', description: 'Optionele inclusieve einddatum als ISO 8601-datum/tijd.' },
              limit: { type: 'integer', minimum: 1, maximum: 500, default: 80, description: 'Maximaal aantal recente resultaten.' },
            },
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
      ],
    });
    return;
  }
  if (method === 'tools/call') {
    try {
      await handleToolCall(id, params);
    } catch (error) {
      sendError(id, JsonRpcError.INTERNAL, error instanceof Error ? error.message : 'WhatsApp-tool is mislukt.');
    }
    return;
  }
  if (id !== undefined) sendError(id, JsonRpcError.METHOD_NOT_FOUND, `Methode niet gevonden: ${method}`);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  if (!line.trim()) return;
  try {
    void handleRequest(JSON.parse(line));
  } catch {
    // Ignore malformed non-request input so stdout remains valid JSON-RPC only.
  }
});
