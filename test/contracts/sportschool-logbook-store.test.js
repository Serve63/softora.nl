const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SPORTSCHOOL_LOGBOOK_HISTORY_TABLE,
  SPORTSCHOOL_LOGBOOK_TABLE,
  createSportschoolLogbookStore,
} = require('../../server/services/sportschool-logbook-store');

function createClientFixture(currentRow) {
  const historyInserts = [];
  const upserts = [];
  const client = {
    from(table) {
      if (table === SPORTSCHOOL_LOGBOOK_TABLE) {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: currentRow, error: null }),
                };
              },
            };
          },
          upsert: async (row, options) => {
            upserts.push({ row, options });
            return { error: null };
          },
        };
      }
      if (table === SPORTSCHOOL_LOGBOOK_HISTORY_TABLE) {
        return {
          insert: async (row) => {
            historyInserts.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
  return { client, historyInserts, upserts };
}

test('sportschool logbook store bewaart vorige snapshot in history voor overwrite', async () => {
  const previousPayload = {
    version: 2,
    days: {
      wednesday: {
        orders: [3],
        exercises: { 3: { title: 'CHEST PRESS', sets: '2', reps: '10', kg: '68' } },
      },
    },
  };
  const nextPayload = {
    version: 2,
    days: {
      wednesday: {
        orders: [3],
        exercises: { 3: { title: 'CHEST PRESS', sets: '2', reps: '10', kg: '70' } },
      },
    },
  };
  const fixture = createClientFixture({
    payload: previousPayload,
    updated_at: '2026-06-24T15:37:23.842Z',
  });
  const store = createSportschoolLogbookStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => fixture.client,
    now: () => new Date('2026-06-24T16:00:00.000Z'),
  });

  const result = await store.writeLogbookSnapshot(nextPayload, {
    source: 'sportschool-logboek',
    actor: 'serve',
  });

  assert.equal(result.source, 'supabase:sportschool');
  assert.equal(fixture.historyInserts.length, 1);
  assert.equal(fixture.historyInserts[0].logbook_id, 'serve_logbook');
  assert.deepEqual(fixture.historyInserts[0].payload, previousPayload);
  assert.deepEqual(fixture.historyInserts[0].next_payload, nextPayload);
  assert.equal(fixture.historyInserts[0].previous_updated_at, '2026-06-24T15:37:23.842Z');
  assert.equal(fixture.historyInserts[0].saved_at, '2026-06-24T16:00:00.000Z');
  assert.equal(fixture.historyInserts[0].source, 'sportschool-logboek');
  assert.equal(fixture.historyInserts[0].actor, 'serve');
  assert.equal(fixture.upserts.length, 1);
  assert.deepEqual(fixture.upserts[0].row.payload, nextPayload);
});

test('sportschool logbook store schrijft geen history wanneer snapshot gelijk blijft', async () => {
  const payload = {
    version: 2,
    days: {
      tuesday: {
        orders: [1],
        exercises: { 1: { title: 'LEG EXTENSIONS', sets: '3', reps: '8', kg: '100/104' } },
      },
    },
  };
  const fixture = createClientFixture({
    payload,
    updated_at: '2026-06-24T15:37:23.842Z',
  });
  const store = createSportschoolLogbookStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => fixture.client,
    now: () => new Date('2026-06-24T16:00:00.000Z'),
  });

  const result = await store.writeLogbookSnapshot(payload, {
    source: 'sportschool-logboek',
    actor: 'serve',
  });

  assert.equal(result.source, 'supabase:sportschool');
  assert.equal(fixture.historyInserts.length, 0);
  assert.equal(fixture.upserts.length, 1);
});
