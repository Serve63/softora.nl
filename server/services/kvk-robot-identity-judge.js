'use strict';

// Robot v7 identity judge: one fixed-answer question to a cheap model.
// The local Robot sends a company it could not decide by its own rules
// although a named own-site candidate publishes both contacts. The model
// answers same_company / different_company / unclear and must quote the page;
// the Robot checks the quote, the site and both contacts itself before use.
const MODEL = 'gpt-6-luna';
const MAX_PAGE_TEXT = 9000;
const MAX_FIELD = 200;
const MAX_QUOTE = 200;
const DAILY_LIMIT = 1500; // per server instance; a hard ceiling on spend, not a target
const TIMEOUT_MS = 30000;
const VERDICTS = ['same_company', 'different_company', 'unclear'];
const COMPANY_FIELDS = ['bedrijfsnaam', 'kvk_nummer', 'straatnaam', 'huisnummer', 'postcode', 'plaats'];

const INSTRUCTIONS = [
  'Je beoordeelt of een website de eigen website is van precies dit Nederlandse bedrijf uit het KVK-register.',
  'Antwoord same_company alleen als de paginatekst dit bedrijf zelf aanwijsbaar noemt (naam of handelsnaam, en',
  'plaats, adres, eigenaar of KVK die bij dit bedrijf passen). Een ander bedrijf met een gelijkende naam, een gids,',
  'portaal, koepel of platform is different_company. Twijfel is unclear. Citeer letterlijk (max 200 tekens) de zin',
  'uit de paginatekst waarop je same_company baseert; geef anders een lege string.',
].join(' ');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'quote'],
  properties: {
    verdict: { type: 'string', enum: VERDICTS },
    quote: { type: 'string' },
  },
};

function clean(value, limit) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function readRequest(body) {
  const source = body && typeof body === 'object' ? body : {};
  const company = Object.fromEntries(COMPANY_FIELDS.map((field) => [field, clean(source.company?.[field], MAX_FIELD)]));
  const host = clean(source.host, MAX_FIELD).toLowerCase();
  const pageText = String(source.pageText == null ? '' : source.pageText).slice(0, MAX_PAGE_TEXT);
  if (!company.bedrijfsnaam || !/^\d{8}$/.test(company.kvk_nummer) || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || !pageText.trim()) {
    return null;
  }
  return { company, host, pageText };
}

function outputText(result) {
  return (result?.output || [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === 'output_text')
    .map((item) => item.text)
    .join('');
}

function createKvkRobotIdentityJudge({ getApiKey, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const usage = { day: '', count: 0 };

  function withinDailyLimit() {
    const day = now().toISOString().slice(0, 10);
    if (usage.day !== day) Object.assign(usage, { day, count: 0 });
    if (usage.count >= DAILY_LIMIT) return false;
    usage.count += 1;
    return true;
  }

  async function judge(body) {
    const request = readRequest(body);
    if (!request) return { status: 400, body: { ok: false, error: 'Ongeldige beoordelingsvraag.' } };
    const key = typeof getApiKey === 'function' ? getApiKey() : '';
    if (!key) return { status: 503, body: { ok: false, error: 'Beoordelingsmodel niet geconfigureerd.' } };
    if (!withinDailyLimit()) return { status: 429, body: { ok: false, error: 'Daglimiet van de beoordelaar bereikt.' } };
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: MODEL,
        store: false,
        reasoning: { effort: 'low' },
        max_output_tokens: 400,
        instructions: INSTRUCTIONS,
        input: `Bedrijf: ${JSON.stringify(request.company)}\nWebsite: ${request.host}\nPaginatekst:\n${request.pageText}`,
        text: { format: { type: 'json_schema', name: 'identity_verdict', strict: true, schema: SCHEMA } },
      }),
    });
    if (!response.ok) return { status: 502, body: { ok: false, error: 'Beoordelingsmodel gaf een fout.', providerStatus: response.status } };
    const result = await response.json();
    let answer;
    try {
      answer = JSON.parse(outputText(result));
    } catch (_error) {
      return { status: 502, body: { ok: false, error: 'Onleesbaar antwoord van het beoordelingsmodel.' } };
    }
    const verdict = VERDICTS.includes(answer?.verdict) ? answer.verdict : 'unclear';
    return {
      status: 200,
      body: { ok: true, model: MODEL, verdict, quote: clean(answer?.quote, MAX_QUOTE), usage: result?.usage || null },
    };
  }

  return { judge };
}

module.exports = { createKvkRobotIdentityJudge, MODEL, VERDICTS, readRequest };
