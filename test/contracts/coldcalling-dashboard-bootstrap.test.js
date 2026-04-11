const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createColdcallingDashboardBootstrapService,
} = require('../../server/services/coldcalling-dashboard-bootstrap');

test('coldcalling dashboard bootstrap service computes stats and html replacements from persisted sources', async () => {
  const service = createColdcallingDashboardBootstrapService({
    getUiStateValues: async (scope) => {
      if (scope === 'coldcalling_preferences') {
        return {
          values: {
            softora_business_mode: 'websites',
          },
        };
      }
      if (scope === 'coldcalling') {
        return {
          values: {
            softora_coldcalling_lead_rows_json: JSON.stringify([
              { company: 'Alpha', phone: '0612345678', region: 'Breda' },
              { company: 'Beta', phone: '0687654321', region: 'Tilburg' },
            ]),
            softora_stats_reset_baseline_started: JSON.stringify({
              started: 1,
              answered: 0,
              interested: 1,
            }),
          },
        };
      }
      return null;
    },
    getRecentCallUpdates: () => [
      {
        callId: 'call-1',
        phone: '0612345678',
        status: 'completed',
        summary: 'Afspraak ingepland',
        durationSeconds: 85,
        recordingUrl: 'https://cdn.example/call-1.mp3',
        updatedAt: '2026-04-11T08:00:00.000Z',
      },
      {
        callId: 'call-2',
        phone: '0687654321',
        status: 'completed',
        transcriptSnippet: 'Stuur informatie, interesse aanwezig',
        durationSeconds: 46,
        recordingUrl: 'https://cdn.example/call-2.mp3',
        updatedAt: '2026-04-11T08:10:00.000Z',
      },
      {
        callId: 'call-3',
        phone: '0611111111',
        status: 'completed',
        summary: 'Irrelevante call buiten de huidige bellijst',
        durationSeconds: 90,
        recordingUrl: 'https://cdn.example/call-3.mp3',
        updatedAt: '2026-04-11T08:20:00.000Z',
      },
    ],
    getRecentAiCallInsights: () => [
      {
        callId: 'call-1',
        phone: '0612345678',
        appointmentBooked: true,
        summary: 'Prospect wil afspraak plannen',
      },
    ],
    agendaReadCoordinator: {
      async listInterestedLeads() {
        return {
          ok: true,
          leads: [
            {
              callId: 'call-2',
              phone: '0687654321',
              summary: 'Geinteresseerd in een vervolggesprek',
            },
          ],
        };
      },
    },
  });

  const payload = await service.buildBootstrapPayload();
  const replacements = service.buildDashboardHtmlReplacements(payload);

  assert.equal(payload.ok, true);
  assert.equal(payload.businessMode, 'websites');
  assert.equal(payload.uiStateScope, 'coldcalling');
  assert.deepEqual(payload.statsSummary, {
    started: 2,
    answered: 2,
    interested: 2,
    conversionPct: 100,
  });
  assert.deepEqual(payload.statsResetBaseline, {
    started: 1,
    answered: 0,
    interested: 1,
  });
  assert.deepEqual(payload.statsDisplay, {
    started: 1,
    answered: 2,
    interested: 1,
    conversionPct: 100,
  });
  assert.equal(replacements.SOFTORA_COLDCALLING_STAT_CALLED, '1');
  assert.equal(replacements.SOFTORA_COLDCALLING_STAT_BOOKED, '2');
  assert.equal(replacements.SOFTORA_COLDCALLING_STAT_INTERESTED, '1');
  assert.equal(replacements.SOFTORA_COLDCALLING_STAT_CONVERSION, '100%');
});
