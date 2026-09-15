const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyRemoteDeliveryUpdates,
  createInstantlyCampaignReplacement,
  isRemoteLeadConfirmedSent,
  normalizeReplacementCampaigns,
  splitRequestedCount,
} = require('../../server/services/instantly-campaign-replacement');

function createHarness(overrides = {}) {
  let rows = overrides.rows || [
    { id: 'old-queued', email: 'old@example.test', status: 'gemaild', databaseStatus: 'gemaild', instantlyLeadId: 'old-serve', instantlyStatus: 'synced', lastColdmailProvider: 'instantly' },
    { id: 'old-sent', email: 'sent@example.test', status: 'gemaild', databaseStatus: 'gemaild', instantlyLeadId: 'sent-serve', instantlyStatus: 'sent', instantlyEmailSentAt: '2026-09-14T08:00:00.000Z', lastColdmailProvider: 'instantly' },
    { id: 'new-1', email: 'one@example.test', status: 'prospect', databaseStatus: 'prospect' },
    { id: 'new-2', email: 'two@example.test', status: 'prospect', databaseStatus: 'prospect' },
    { id: 'new-3', email: 'three@example.test', status: 'prospect', databaseStatus: 'prospect' },
  ];
  const calls = [];
  const campaigns = { serve: 'campaign-serve', martijn: 'campaign-martijn' };
  const remoteByCampaign = new Map([
    [campaigns.serve, [
      { id: 'old-serve', email: 'old@example.test', status: 1 },
      { id: 'sent-serve', email: 'sent@example.test', status: 3, timestamp_last_contact: '2026-09-14T08:00:00.000Z' },
    ]],
    [campaigns.martijn, [{ id: 'old-martijn', email: 'old-martijn@example.test', status: 2 }]],
  ]);
  const service = createInstantlyCampaignReplacement({
    campaigns,
    now: () => new Date('2026-09-14T12:00:00.000Z'),
    loadRows: async () => ({ values: {}, rows }),
    persistRows: async (_loaded, nextRows, meta) => {
      calls.push({ type: 'persist', meta });
      rows = nextRows;
      return { ok: true };
    },
    collectEligibleRows: async (allRows, limit) => ({
      selectedRows: allRows.map((row, index) => ({ row, index, id: row.id })).filter((item) => item.id.startsWith('new-')).slice(0, limit),
      failed: [],
    }),
    buildLead: async (item, context) => ({ email: item.row.email, custom_variables: { softora_sender_profile: context.owner } }),
    loadContext: async (_allRows, sender) => ({ owner: sender.key, sender }),
    resolveSender: (owner) => ({ key: owner, name: owner === 'serve' ? 'Servé Creusen' : 'Martijn van de Ven', email: `${owner}@websoftora.com` }),
    reserveRows: async (items, options) => {
      calls.push({ type: 'reserve', items, options });
      return { ok: true, reservationId: 'reservation-1' };
    },
    releaseReservation: async (reservationId) => {
      calls.push({ type: 'release', reservationId });
      return { ok: true };
    },
    confirmReservation: async (reservationId, options) => {
      calls.push({ type: 'confirm', reservationId, options });
      return { ok: true, count: 12 };
    },
    saveLegacyGuards: async (items, options) => {
      calls.push({ type: 'legacy-guards', items, options });
      return { count: items.length };
    },
    getCampaign: async (campaignId) => ({ id: campaignId, status: campaignId === campaigns.serve ? 1 : 0 }),
    pauseCampaign: async (campaignId) => {
      calls.push({ type: 'pause', campaignId });
      return { id: campaignId, status: 2 };
    },
    listCampaignLeads: async (campaignId) => (remoteByCampaign.get(campaignId) || []).map((lead) => ({ ...lead })),
    addCampaignLeads: async (campaignId, leads) => {
      calls.push({ type: 'add', campaignId, leads });
      const data = typeof overrides.addCampaignLeads === 'function'
        ? await overrides.addCampaignLeads(campaignId, leads, calls)
        : {
        leads_uploaded: leads.length,
        created_leads: leads.map((lead, index) => ({ id: `${campaignId}-new-${index}`, email: lead.email, index })),
      };
      const created = Array.isArray(data && data.created_leads) ? data.created_leads : [];
      remoteByCampaign.set(campaignId, [
        ...(remoteByCampaign.get(campaignId) || []),
        ...created.map((lead) => ({
          ...lead,
          status: 1,
          payload: leads[Number(lead.index) || 0] && leads[Number(lead.index) || 0].custom_variables,
        })),
      ]);
      return data;
    },
    deleteCampaignLeads: async (campaignId, ids) => {
      calls.push({ type: 'delete', campaignId, ids });
      if (typeof overrides.deleteCampaignLeads === 'function') {
        return overrides.deleteCampaignLeads(campaignId, ids, calls, remoteByCampaign);
      }
      const idSet = new Set(ids);
      remoteByCampaign.set(campaignId, (remoteByCampaign.get(campaignId) || []).filter((lead) => !idSet.has(lead.id)));
      return { count: ids.length };
    },
    activateCampaign: async (campaignId) => {
      calls.push({ type: 'activate', campaignId });
      return { id: campaignId, status: 1 };
    },
  });
  return { service, calls, getRows: () => rows };
}

test('replacement campaign config and odd counts stay deterministic', () => {
  assert.deepEqual(normalizeReplacementCampaigns('{"serve":" serve-id ","martijn":{"id":"martijn-id"}}'), { serve: 'serve-id', martijn: 'martijn-id' });
  assert.deepEqual(splitRequestedCount(5), { serve: 3, martijn: 2 });
});

test('confirmed Instantly delivery requires real delivery evidence', () => {
  assert.equal(isRemoteLeadConfirmedSent({ id: 'queued', status: 1 }), false);
  assert.equal(isRemoteLeadConfirmedSent({ id: 'sent', status: 3, timestamp_last_contact: '2026-09-14T08:00:00.000Z' }), true);
});

test('replacement preserves sent leads, replaces only waiting leads and activates both campaigns', async () => {
  const { service, calls, getRows } = createHarness();

  const result = await service.replace({ limit: 3, uploadId: 'upload-1', actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(result.uploaded, 3);
  assert.deepEqual(result.distribution, { serve: 2, martijn: 1 });
  assert.equal(result.replacedQueued, 2);
  assert.deepEqual(calls.filter((call) => call.type === 'pause').map((call) => call.campaignId), ['campaign-serve']);
  assert.deepEqual(calls.filter((call) => call.type === 'delete' && call.ids.includes('old-serve')).map((call) => call.ids), [['old-serve']]);
  assert.equal(calls.some((call) => call.type === 'delete' && call.ids.includes('sent-serve')), false);
  assert.deepEqual(calls.filter((call) => call.type === 'activate').map((call) => call.campaignId), ['campaign-serve', 'campaign-martijn']);
  assert.equal(calls.find((call) => call.type === 'reserve').options.provisional, true);
  assert.equal(calls.find((call) => call.type === 'confirm').options.status, 'queued');
  assert.equal(calls.find((call) => call.type === 'legacy-guards').items.length, 3);

  const rows = getRows();
  assert.equal(rows[0].status, 'prospect');
  assert.equal(rows[0].lastColdmailProvider, '');
  assert.equal(rows[1].instantlyEmailSentAt, '2026-09-14T08:00:00.000Z');
  assert.equal(rows[2].status, 'prospect');
  assert.equal(rows[2].instantlyStatus, 'synced');
  assert.equal(rows[2].lastColdmailProvider, 'instantly');
  assert.equal(rows[2].instantlyEmailSentAt, undefined);
  assert.equal(rows[4].instantlySenderProfileKey, 'martijn');
});

test('partial upload is deleted again and provisional guards are released', async () => {
  const { service, calls, getRows } = createHarness({
    addCampaignLeads: async (campaignId, leads) => ({
      leads_uploaded: campaignId === 'campaign-serve' ? 1 : leads.length,
      created_leads: [{ id: `${campaignId}-partial`, email: leads[0].email, index: 0 }],
    }),
  });

  await assert.rejects(
    service.replace({ limit: 3, uploadId: 'upload-partial' }),
    (error) => error && error.code === 'INSTANTLY_REPLACEMENT_PARTIAL_UPLOAD'
  );

  assert.equal(calls.some((call) => call.type === 'delete' && call.ids.includes('campaign-serve-partial')), true);
  assert.equal(calls.some((call) => call.type === 'release' && call.reservationId === 'reservation-1'), true);
  assert.equal(calls.some((call) => call.type === 'persist'), false);
  assert.equal(getRows()[2].instantlyStatus, undefined);
});

test('partial old-list deletion keeps the recorded new leads and campaigns paused', async () => {
  const { service, calls, getRows } = createHarness({
    deleteCampaignLeads: async (campaignId, ids, _calls, remoteByCampaign) => {
      if (campaignId === 'campaign-serve' && ids.includes('old-serve')) return { count: 0 };
      const idSet = new Set(ids);
      remoteByCampaign.set(campaignId, (remoteByCampaign.get(campaignId) || []).filter((lead) => !idSet.has(lead.id)));
      return { count: ids.length };
    },
  });

  const result = await service.replace({ limit: 3, uploadId: 'upload-delete-partial' });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'INSTANTLY_REPLACEMENT_PARTIAL_DELETE');
  assert.equal(result.uploaded, 3);
  assert.equal(result.replacedQueued, 1);
  assert.equal(result.remainingQueued, 1);
  assert.equal(result.campaignsPaused, true);
  assert.equal(calls.some((call) => call.type === 'release'), false);
  assert.equal(calls.some((call) => call.type === 'activate'), false);
  assert.equal(getRows()[0].instantlyLeadId, 'old-serve');
  assert.equal(getRows()[2].instantlyStatus, 'synced');
  assert.equal(getRows()[2].status, 'prospect');
});

test('delivery reconciliation moves only confirmed remote sends to gemaild', () => {
  const rows = [
    { id: 'queued', email: 'queued@example.test', status: 'prospect', databaseStatus: 'prospect', instantlyLeadId: 'lead-queued', instantlyStatus: 'synced', lastColdmailProvider: 'instantly' },
    { id: 'sent', email: 'sent@example.test', status: 'prospect', databaseStatus: 'prospect', instantlyLeadId: 'lead-sent', instantlyStatus: 'synced', lastColdmailProvider: 'instantly' },
  ];
  const result = applyRemoteDeliveryUpdates(rows, [
    { id: 'lead-queued', email: 'queued@example.test', status: 1 },
    { id: 'lead-sent', email: 'sent@example.test', status: 3, timestamp_last_contact: '2026-09-14T09:30:00.000Z' },
  ], '2026-09-14T10:00:00.000Z', 'Test');

  assert.equal(result.updated, 1);
  assert.equal(result.rows[0].status, 'prospect');
  assert.equal(result.rows[1].status, 'gemaild');
  assert.equal(result.rows[1].instantlyEmailSentAt, '2026-09-14T09:30:00.000Z');
});

test('delivery reconciliation persists only changed rows through the safe upsert path', async () => {
  let rows = [{
    id: 'queued',
    email: 'queued@example.test',
    status: 'prospect',
    databaseStatus: 'prospect',
    instantlyLeadId: 'lead-queued',
    instantlyStatus: 'synced',
    lastColdmailProvider: 'instantly',
  }];
  const singleWrites = [];
  const fullWrites = [];
  const service = createInstantlyCampaignReplacement({
    campaigns: { serve: 'campaign-serve', martijn: 'campaign-martijn' },
    now: () => new Date('2026-09-14T10:00:00.000Z'),
    loadRows: async () => ({ values: {}, rows }),
    persistRows: async () => {
      fullWrites.push(true);
      throw new Error('full replacement must not be used');
    },
    persistSingleRow: async (row, meta) => {
      singleWrites.push({ row, meta });
      rows = rows.map((current) => current.id === row.id ? row : current);
      return { ok: true };
    },
    listCampaignLeads: async (campaignId) => campaignId === 'campaign-serve'
      ? [{ id: 'lead-queued', email: 'queued@example.test', status: 3, timestamp_last_contact: '2026-09-14T09:30:00.000Z' }]
      : [],
  });

  const result = await service.refreshDeliveryStatus({ actor: 'Test' });

  assert.equal(result.updated, 1);
  assert.equal(fullWrites.length, 0);
  assert.equal(singleWrites.length, 1);
  assert.equal(singleWrites[0].row.status, 'gemaild');
  assert.equal(singleWrites[0].meta.upsertOnly, true);
  assert.equal(rows[0].instantlyEmailSentAt, '2026-09-14T09:30:00.000Z');
});

test('delivery reconciliation never claims a send when the durable upsert fails', async () => {
  const service = createInstantlyCampaignReplacement({
    campaigns: { serve: 'campaign-serve', martijn: 'campaign-martijn' },
    now: () => new Date('2026-09-14T10:00:00.000Z'),
    loadRows: async () => ({ values: {}, rows: [{
      id: 'queued', email: 'queued@example.test', status: 'prospect', databaseStatus: 'prospect',
      instantlyLeadId: 'lead-queued', instantlyStatus: 'synced',
    }] }),
    persistSingleRow: async () => null,
    persistRows: async () => ({ ok: true }),
    listCampaignLeads: async (campaignId) => campaignId === 'campaign-serve'
      ? [{ id: 'lead-queued', email: 'queued@example.test', status: 3, timestamp_last_contact: '2026-09-14T09:30:00.000Z' }]
      : [],
  });

  await assert.rejects(
    () => service.refreshDeliveryStatus({ actor: 'Test' }),
    (error) => error && error.code === 'INSTANTLY_DELIVERY_PERSIST_FAILED'
  );
});
