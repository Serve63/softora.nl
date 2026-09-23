const test = require('node:test');
const assert = require('node:assert/strict');
const { createPremiumSamenvattenService, validateFile } = require('../../server/services/premium-samenvatten');

const owner = { authenticated: true, userId: 'staff-1' };
const other = { authenticated: true, userId: 'staff-2' };
const id = 'ee81d53e-407c-47a2-9f8b-8951c1c23154';
const transcriptId = '0ddc8d30-0fc7-4106-9a4c-04b27a904531';

function fakeDb() {
  const rows = new Map();
  const removed = [];
  const bucket = {
    createSignedUploadUrl: async () => ({ data: { signedUrl: 'https://storage.example/upload?token=short', token: 'short' } }),
    info: async (path) => ({ data: { size: rows.get(path.split('/')[1])?.file_size, contentType: 'audio/mpeg' } }),
    createSignedUrl: async () => ({ data: { signedUrl: 'https://storage.example/read?token=short' } }),
    remove: async (paths) => { removed.push(...paths); return { data: [] }; },
  };
  function from() {
    let operation = 'select';
    let payload;
    let filters = [];
    let head = false;
    let max = Infinity;
    const query = {
      select(_fields, options) { if (options?.head) head = true; return this; },
      insert(value) { operation = 'insert'; payload = value; return this; },
      update(value) { operation = 'update'; payload = value; return this; },
      delete() { operation = 'delete'; return this; },
      eq(key, value) { filters.push((row) => row[key] === value); return this; },
      gte(key, value) { filters.push((row) => row[key] >= value); return this; },
      gt(key, value) { filters.push((row) => row[key] > value); return this; },
      lt(key, value) { filters.push((row) => row[key] < value); return this; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return this; },
      order() { return this; },
      limit(value) { max = value; return this; },
      maybeSingle() { return Promise.resolve(run(true)); },
      then(resolve, reject) { return Promise.resolve(run(false)).then(resolve, reject); },
    };
    function run(single) {
      if (operation === 'insert') {
        rows.set(payload.id, { summary_status: 'pending', updated_at: '2026-09-23T15:00:00Z', ...payload });
        return { data: null, error: null };
      }
      const matched = [...rows.values()].filter((row) => filters.every((filter) => filter(row))).slice(0, max);
      if (operation === 'update') {
        for (const row of matched) Object.assign(row, payload);
        return { data: single ? (matched[0] ? { id: matched[0].id } : null) : null, error: null };
      }
      if (operation === 'delete') {
        for (const row of matched) rows.delete(row.id);
        return { data: null, error: null };
      }
      return head ? { count: matched.length, data: null, error: null }
        : { data: single ? matched[0] || null : matched, error: null };
    }
    return query;
  }
  return { rows, removed, from, storage: { from: () => bucket } };
}

test('Samenvatten rejects invalid or oversized audio before creating a job', () => {
  assert.throws(() => validateFile({ name: '../recording.mp3', size: 20, type: 'audio/mpeg' }));
  assert.throws(() => validateFile({ name: 'recording.mp3', size: 101 * 1024 * 1024, type: 'audio/mpeg' }));
  assert.throws(() => validateFile({ name: 'recording.pdf', size: 20, type: 'application/pdf' }));
});

test('Samenvatten refuses paid processing until explicitly enabled', async () => {
  const service = createPremiumSamenvattenService({ env: { ASSEMBLYAI_API_KEY: 'test-key' } });
  assert.equal(service.enabled(), false);
  await assert.rejects(service.plan(owner, { name: 'call.mp3', size: 20, type: 'audio/mpeg' }), { status: 503 });
});

test('Samenvatten binds a private upload and transcript to its owner and submits Universal-3.5 Pro once', async () => {
  const db = fakeDb();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => url.includes('llm-gateway') ? {
        request_id: 'gateway-test',
        choices: [{ message: { content: JSON.stringify({
          summary: [{ title: 'Planning', text: 'Volgende week starten.' }],
          actionItems: [{ text: 'Bel de klant.', quote: 'Ik bel morgen.' }],
        }) } }],
      } : options?.method === 'POST' ? { id: transcriptId } : {
        status: 'completed', text: 'Dit is het volledige gesprek. Ik bel morgen.',
        speech_model_used: 'universal-3-5-pro', language_code: 'nl',
      },
    };
  };
  const service = createPremiumSamenvattenService({
    env: { ASSEMBLYAI_SUMMARIZE_ENABLED: '1', ASSEMBLYAI_API_KEY: 'test-key' },
    getSupabaseClient: () => db,
    fetchImpl,
    randomUUID: () => id,
    now: () => new Date('2026-09-23T15:00:00Z'),
  });
  const plan = await service.plan(owner, { name: 'gesprek.mp3', size: 1024, type: 'audio/mpeg' });
  assert.equal(plan.id, id);
  assert.equal(db.rows.get(id).owner_id, owner.userId);
  await assert.rejects(service.start(other, id), { status: 404 });
  assert.equal(calls.length, 0);
  assert.deepEqual(await service.start(owner, id), { id, status: 'processing' });
  assert.equal((await service.recent(owner)).job.id, id);
  assert.equal((await service.recent(other)).job, null);
  await assert.rejects(service.start(owner, id), { status: 409 });
  assert.equal(calls.length, 1);
  const submitted = JSON.parse(calls[0].options.body);
  assert.deepEqual(submitted.speech_models, ['universal-3-5-pro']);
  assert.equal(submitted.language_code, 'nl');
  assert.equal(submitted.audio_end_at, 7200000);
  assert.equal(submitted.speech_understanding, undefined);
  await assert.rejects(service.status(other, id), { status: 404 });
  const result = await service.status(owner, id);
  assert.equal(result.transcript, 'Dit is het volledige gesprek. Ik bel morgen.');
  assert.equal(result.summary[0].title, 'Planning');
  assert.equal(result.actionItems[0].text, 'Bel de klant.');
  assert.equal(result.actionItems[0].quote, 'Ik bel morgen.');
  const gateway = JSON.parse(calls[2].options.body);
  assert.equal(gateway.model, 'gpt-5.1');
  assert.equal(gateway.transcript_id, transcriptId);
  assert.match(gateway.messages[1].content, /\{\{ transcript \}\}/);
  assert.deepEqual(db.removed, [`jobs/${id}/audio.mp3`]);
});
