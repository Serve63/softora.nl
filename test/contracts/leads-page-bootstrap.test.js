const test = require('node:test');
const assert = require('node:assert/strict');

const { createLeadsPageBootstrapService } = require('../../server/services/leads-page-bootstrap');

test('leads page bootstrap merges confirmation tasks, interested leads and lead database identity', async () => {
  const service = createLeadsPageBootstrapService({
    agendaReadCoordinator: {
      async listConfirmationTasks() {
        return {
          ok: true,
          tasks: [
            {
              id: 12,
              company: 'Softora BV',
              contact: 'Servé Creusen',
              phone: '0612345678',
              date: '2026-04-09',
              time: '14:00',
              source: 'Agenda taak',
              summary: 'Afspraak ingepland',
              leadOwnerFullName: 'Servé Creusen',
            },
          ],
        };
      },
      async listInterestedLeads() {
        return {
          ok: true,
          leads: [
            {
              id: 0,
              callId: 'call-12',
              company: 'Softora B.V.',
              contact: 'Servé Creusen',
              phone: '+31 6 12345678',
              date: '2026-04-10',
              time: '10:00',
              source: 'Coldcalling interesse',
              summary: 'Warme lead met interesse',
              leadChipClass: 'confirmed',
            },
          ],
        };
      },
    },
    getUiStateValues: async (scope) => {
      if (scope !== 'coldcalling') return null;
      return {
        values: {
          softora_coldcalling_lead_rows_json: JSON.stringify([
            {
              company: 'Softora.nl',
              contactPerson: 'Servé Creusen',
              phone: '06 12345678',
              branche: 'Tech',
              province: 'Noord-Brabant',
              address: 'Lindelaan 67',
              website: 'softora.nl',
            },
          ]),
        },
      };
    },
  });

  const payload = await service.buildLeadsBootstrapPayload();

  assert.equal(payload.ok, true);
  assert.equal(Array.isArray(payload.leads), true);
  assert.equal(payload.leads.length, 1);
  assert.equal(payload.leads[0].company, 'Softora.nl');
  assert.equal(payload.leads[0].branche, 'Tech');
  assert.equal(payload.leads[0].website, 'softora.nl');
  assert.equal(payload.leads[0].id, 12);
  assert.match(String(payload.loadedAt || ''), /^\d{4}-\d{2}-\d{2}T/);
});

test('leads page bootstrap falls back safely when no data is available', async () => {
  const service = createLeadsPageBootstrapService({
    agendaReadCoordinator: {
      async listConfirmationTasks() {
        return { ok: true, tasks: [] };
      },
      async listInterestedLeads() {
        return { ok: true, leads: [] };
      },
    },
    getUiStateValues: async () => null,
  });

  const payload = await service.buildLeadsBootstrapPayload();

  assert.equal(payload.ok, true);
  assert.deepEqual(payload.leads, []);
});
