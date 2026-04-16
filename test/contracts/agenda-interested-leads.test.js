const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaInterestedLeadsCoordinator } = require('../../server/services/agenda-interested-leads');

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeDateYyyyMmDd(value) {
  const input = normalizeString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : '';
}

function normalizeTimeHhMm(value) {
  const input = normalizeString(value);
  return /^\d{2}:\d{2}$/.test(input) ? input : '';
}

function sanitizeAppointmentLocation(value) {
  return normalizeString(value);
}

function sanitizeAppointmentWhatsappInfo(value) {
  return normalizeString(value);
}

function toBooleanSafe(value, fallback = false) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function normalizeEmailAddress(value) {
  return normalizeString(value).toLowerCase();
}

function truncateText(value, maxLength = 500) {
  return normalizeString(value).slice(0, maxLength);
}

function buildLeadFollowUpCandidateKey(item) {
  const phone = normalizeString(item?.phone || '').replace(/\D/g, '');
  if (phone) return `phone:${phone}`;
  const company = normalizeString(item?.company || '').toLowerCase();
  const contact = normalizeString(item?.contact || '').toLowerCase();
  return company || contact ? `name:${company}|${contact}` : '';
}

function createResponseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createFixture(overrides = {}) {
  const appointments = overrides.appointments || [];
  const agendaAppointmentIdByCallId = new Map(overrides.agendaAppointmentIdByCallId || []);
  const aiCallInsightsByCallId = new Map(
    overrides.aiCallInsightsByCallId || [
      [
        'call-1',
        {
          summary: 'Lead wil graag een afspraak.',
          estimatedValueEur: 3500,
          contactEmail: 'klant@voorbeeld.nl',
        },
      ],
    ]
  );
  const activityCalls = [];
  const dismissCalls = [];
  const hydrateCalls = [];
  const syncRuntimeCalls = [];
  const upsertCalls = [];
  const cancelCalls = [];
  const dismissPersistCalls = [];
  const persistWaitCalls = [];
  const snapshotCalls = [];
  const applySnapshotCalls = [];
  const dismissedFreshCalls = [];
  const defaultFindInterestedLeadRowByCallId =
    overrides.findInterestedLeadRowByCallId ||
    ((callId) =>
      callId === 'call-1'
        ? {
            callId: 'call-1',
            company: 'Softora',
            contact: 'Serve Creusen',
            phone: '0612345678',
            source: 'AI Cold Calling',
            summary: 'Lead toonde interesse in een nieuwe website.',
            leadOwnerKey: 'owner-1',
          }
        : null);
  const defaultBuildAllInterestedLeadRows =
    overrides.buildAllInterestedLeadRows ||
    (() => {
      const lead = defaultFindInterestedLeadRowByCallId('call-1');
      return lead ? [lead] : [];
    });
  const defaultCollectInterestedLeadCallIdsByIdentity =
    overrides.collectInterestedLeadCallIdsByIdentity ||
    ((callId) => (normalizeString(callId) ? [normalizeString(callId)] : []));

  function setGeneratedAgendaAppointmentAtIndex(idx, nextValue, _reason) {
    appointments[idx] = {
      ...nextValue,
    };
    return appointments[idx];
  }

  const coordinator = createAgendaInterestedLeadsCoordinator({
    isSupabaseConfigured: () => Boolean(overrides.supabaseConfigured),
    getSupabaseStateHydrated: () => !overrides.supabaseConfigured || Boolean(overrides.supabaseHydrated),
    forceHydrateRuntimeStateWithRetries: async (times) => {
      hydrateCalls.push(times);
    },
    syncRuntimeStateFromSupabaseIfNewer: async (options) => {
      syncRuntimeCalls.push(options);
      return overrides.syncRuntimeResult !== undefined ? Boolean(overrides.syncRuntimeResult) : false;
    },
    backfillInsightsAndAppointmentsFromRecentCallUpdates: () => {},
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    sanitizeAppointmentLocation,
    sanitizeAppointmentWhatsappInfo,
    toBooleanSafe,
    agendaAppointmentIdByCallId,
    getGeneratedAppointmentIndexById: (raw) =>
      appointments.findIndex((item) => Number(item?.id || 0) === Number(raw)),
    getGeneratedAgendaAppointments: () => appointments,
    findInterestedLeadRowByCallId: defaultFindInterestedLeadRowByCallId,
    buildAllInterestedLeadRows: defaultBuildAllInterestedLeadRows,
    buildLeadFollowUpCandidateKey,
    collectInterestedLeadCallIdsByIdentity: defaultCollectInterestedLeadCallIdsByIdentity,
    getLatestCallUpdateByCallId:
      overrides.getLatestCallUpdateByCallId ||
      ((callId) =>
        callId === 'call-1'
          ? {
              callId: 'call-1',
              company: 'Softora',
              name: 'Serve Creusen',
              phone: '0612345678',
              summary: 'Lead wil een afspraak inplannen.',
              provider: 'retell',
            }
          : null),
    aiCallInsightsByCallId,
    buildGeneratedLeadFollowUpFromCall:
      overrides.buildGeneratedLeadFollowUpFromCall ||
      ((callUpdate) =>
        callUpdate
          ? {
              company: callUpdate.company,
              contact: callUpdate.name,
              phone: callUpdate.phone,
              summary: callUpdate.summary,
              source: 'AI Cold Calling (Lead opvolging)',
              provider: callUpdate.provider,
            }
          : null),
    normalizeColdcallingStack: (value) => normalizeString(value),
    getColdcallingStackLabel: () => 'Retell',
    buildLeadOwnerFields: (_callId, owner) =>
      owner
        ? {
            leadOwnerKey: normalizeString(owner.key),
            leadOwnerName: normalizeString(owner.displayName),
          }
        : {},
    normalizeEmailAddress,
    formatEuroLabel: (value) => (Number(value) > 0 ? `EUR ${Number(value)}` : ''),
    truncateText,
    resolveAppointmentLocation: () => '',
    resolveCallDurationSeconds: () => 180,
    resolvePreferredRecordingUrl: () => '',
    resolveAgendaLocationValue: (...values) => values.map((value) => normalizeString(value)).find(Boolean) || '',
    upsertGeneratedAgendaAppointment: (appointment, callId) => {
      upsertCalls.push({ appointment, callId });
      const persisted = {
        id: 501,
        ...appointment,
      };
      appointments[0] = persisted;
      agendaAppointmentIdByCallId.set(callId, persisted.id);
      return persisted;
    },
    buildLeadToAgendaSummary: async (_summary, location) => `Lead ingepland op ${location}`,
    setGeneratedAgendaAppointmentAtIndex,
    dismissInterestedLeadIdentity:
      overrides.dismissInterestedLeadIdentity ||
      ((callId, rowLike, reason, options) => {
        dismissCalls.push({ callId, rowLike, reason, options });
      }),
    persistDismissedLeadsToSupabase: async (reason) => {
      dismissPersistCalls.push(reason);
      if (overrides.persistDismissedLeadsPromise) {
        return await overrides.persistDismissedLeadsPromise;
      }
      return overrides.persistDismissedLeadsResult !== undefined
        ? Boolean(overrides.persistDismissedLeadsResult)
        : false;
    },
    ensureDismissedLeadsFreshFromSupabase: async (options) => {
      dismissedFreshCalls.push(options);
      return overrides.ensureDismissedLeadsFreshResult !== undefined
        ? Boolean(overrides.ensureDismissedLeadsFreshResult)
        : true;
    },
    appendDashboardActivity: (payload, reason) => {
      activityCalls.push({ payload, reason });
    },
    cancelOpenLeadFollowUpTasksByIdentity: (callId, rowLike, actor, reason) => {
      cancelCalls.push({ callId, rowLike, actor, reason });
      return 2;
    },
    buildRuntimeStateSnapshotPayload: () => {
      const snapshot = {
        savedAt: '2026-04-01T10:00:00.000Z',
        generatedAgendaAppointments: appointments.map((item) => ({ ...item })),
      };
      snapshotCalls.push(snapshot);
      return snapshot;
    },
    applyRuntimeStateSnapshotPayload: (snapshot, options) => {
      applySnapshotCalls.push({ snapshot, options });
      return true;
    },
    waitForQueuedRuntimeSnapshotPersist: async () => {
      persistWaitCalls.push('waited');
      if (overrides.persistWaitPromise) {
        return await overrides.persistWaitPromise;
      }
      return overrides.persistWaitResult !== undefined ? Boolean(overrides.persistWaitResult) : true;
    },
  });

  return {
    activityCalls,
    applySnapshotCalls,
    appointments,
    cancelCalls,
    coordinator,
    dismissPersistCalls,
    dismissCalls,
    dismissedFreshCalls,
    hydrateCalls,
    persistWaitCalls,
    snapshotCalls,
    syncRuntimeCalls,
    upsertCalls,
  };
}

test('agenda interested leads coordinator materializes a lead into the agenda', async () => {
  const { activityCalls, appointments, coordinator, dismissCalls, persistWaitCalls, upsertCalls } = createFixture();
  const res = createResponseRecorder();

  await coordinator.setInterestedLeadInAgendaResponse(
    {
      body: {
        callId: 'call-1',
        appointmentDate: '2026-04-10',
        appointmentTime: '14:30',
        location: 'Amsterdam',
        whatsappInfo: 'Stuur route door',
        whatsappConfirmed: true,
        actor: 'Serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.taskCompleted, true);
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].callId, 'call-1');
  assert.equal(appointments[0].id, 501);
  assert.equal(appointments[0].date, '2026-04-10');
  assert.equal(appointments[0].time, '14:30');
  assert.equal(appointments[0].location, 'Amsterdam');
  assert.equal(appointments[0].summary, 'Lead ingepland op Amsterdam');
  assert.equal(appointments[0].confirmationResponseReceived, true);
  assert.equal(dismissCalls[0].reason, 'interested_lead_set_in_agenda_dismiss');
  assert.equal(activityCalls[0].reason, 'dashboard_activity_interested_lead_set_in_agenda');
  assert.deepEqual(persistWaitCalls, ['waited']);
});

test('agenda interested leads coordinator responds accepted when shared persist stays pending', async () => {
  const { appointments, coordinator, persistWaitCalls, upsertCalls } = createFixture({
    supabaseConfigured: true,
    supabaseHydrated: true,
    persistWaitPromise: new Promise(() => {}),
  });
  const res = createResponseRecorder();

  await coordinator.setInterestedLeadInAgendaResponse(
    {
      body: {
        callId: 'call-1',
        appointmentDate: '2026-04-10',
        appointmentTime: '14:30',
        location: 'Amsterdam',
        whatsappInfo: 'Stuur route door',
        whatsappConfirmed: true,
        actor: 'Serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.taskCompleted, true);
  assert.equal(res.body.persistencePending, true);
  assert.equal(upsertCalls.length, 1);
  assert.equal(appointments[0].date, '2026-04-10');
  assert.deepEqual(persistWaitCalls, ['waited']);
});

test('agenda interested leads coordinator dismisses a lead and cancels open follow-up tasks', async () => {
  const { activityCalls, cancelCalls, coordinator, dismissCalls, persistWaitCalls } = createFixture({
    collectInterestedLeadCallIdsByIdentity: () => ['call-1', 'call-legacy'],
  });
  const res = createResponseRecorder();

  await coordinator.dismissInterestedLeadResponse(
    {
      body: {
        callId: 'call-1',
        actor: 'Serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.dismissed, true);
  assert.equal(res.body.cancelledTasks, 2);
  assert.equal(dismissCalls[0].reason, 'interested_lead_dismissed_manual');
  assert.deepEqual(dismissCalls[0].options?.relatedCallIds, ['call-1', 'call-legacy']);
  assert.equal(cancelCalls[0].reason, 'interested_lead_dismissed_manual_cancel');
  assert.equal(activityCalls[0].reason, 'dashboard_activity_interested_lead_removed');
  assert.deepEqual(persistWaitCalls, ['waited']);
});

test('agenda interested leads coordinator confirms dismissal after shared sync when local persist fails', async () => {
  const { cancelCalls, coordinator, dismissCalls, persistWaitCalls, syncRuntimeCalls } = createFixture({
    supabaseConfigured: true,
    supabaseHydrated: true,
    persistWaitResult: false,
    syncRuntimeResult: true,
    buildAllInterestedLeadRows: () => [],
  });
  const res = createResponseRecorder();

  await coordinator.dismissInterestedLeadResponse(
    {
      body: {
        callId: 'call-1',
        actor: 'Serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.dismissed, true);
  assert.equal(res.body.persistencePending, false);
  assert.equal(res.body.cancelledTasks, 2);
  assert.equal(dismissCalls[0].reason, 'interested_lead_dismissed_manual');
  assert.equal(cancelCalls[0].reason, 'interested_lead_dismissed_manual_cancel');
  assert.deepEqual(persistWaitCalls, ['waited']);
  assert.deepEqual(syncRuntimeCalls, [{ force: true, maxAgeMs: 0 }]);
});

test('agenda interested leads coordinator confirms dismissal once the dedicated dismissed row is persisted', async () => {
  const { coordinator, dismissPersistCalls, persistWaitCalls } = createFixture({
    supabaseConfigured: true,
    supabaseHydrated: true,
    persistDismissedLeadsResult: true,
    buildAllInterestedLeadRows: () => [],
  });
  const res = createResponseRecorder();

  await coordinator.dismissInterestedLeadResponse(
    {
      body: {
        callId: 'call-1',
        actor: 'Serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.dismissed, true);
  assert.deepEqual(dismissPersistCalls, ['interested_lead_dismissed_manual_route_confirm']);
  assert.deepEqual(persistWaitCalls, []);
});

test('agenda interested leads coordinator forceert remote dismissed-leads hydrate vóór elke dismiss (Vercel multi-instance regressietest)', async () => {
  // Repro: instance B is warm en kent alleen zijn eigen lokale dismisses. Zonder
  // vooraf-hydrate persisteert B met een onvolledige set en overschrijft de
  // dismisses van instance A. We eisen daarom dat de dismiss-route áltijd eerst
  // de remote dedicated state forceert te lezen, zodat de daaropvolgende persist
  // de UNION schrijft (zie persistDismissedLeadsToSupabase contracttest).
  const { coordinator, dismissedFreshCalls } = createFixture({
    supabaseConfigured: true,
    supabaseHydrated: true,
    persistDismissedLeadsResult: true,
    buildAllInterestedLeadRows: () => [],
  });
  const res = createResponseRecorder();

  await coordinator.dismissInterestedLeadResponse(
    {
      body: {
        callId: 'call-1',
        actor: 'Serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(dismissedFreshCalls.length >= 1,
    'dismiss-route moet eerst de remote dedicated dismissed-leads ophalen');
  assert.equal(dismissedFreshCalls[0]?.force, true,
    'dismiss-route moet de TTL omzeilen via force=true zodat we niet stale persisten');
});

test('agenda interested leads coordinator forceert remote dismissed-leads hydrate ook bij set-in-agenda (óók een dismiss)', async () => {
  // Set-in-agenda is qua dismissed-state een dismiss: de lead verdwijnt uit
  // de interested-lijst zodra hij is ingepland. We moeten daarom óók hier de
  // verse remote dismissed-leads ophalen vóór we persisten, zodat we nooit
  // dismisses van andere instances overschrijven.
  const { coordinator, dismissedFreshCalls } = createFixture({
    supabaseConfigured: true,
    supabaseHydrated: true,
  });
  const res = createResponseRecorder();

  await coordinator.setInterestedLeadInAgendaResponse(
    {
      body: {
        callId: 'call-1',
        appointmentDate: '2026-04-10',
        appointmentTime: '14:30',
        location: 'Amsterdam',
        actor: 'Serve',
      },
    },
    res
  );

  assert.ok(
    dismissedFreshCalls.some((options) => options?.force === true),
    'set-in-agenda-route moet de TTL omzeilen via force=true vóór de dismiss wordt gepersisteerd'
  );
});

test('agenda interested leads coordinator forceert óók runtime-state sync vóór set-in-agenda zodat een andere warme Vercel-instance een verse call-backed lead direct kent', async () => {
  // Repro: de lead is al zichtbaar in de browser (instance A), maar de POST
  // /set-in-agenda landt op instance B die deze callId nog niet heeft
  // gehydrateerd. Zonder forced shared-state sync krijgt de gebruiker 404:
  // "Lead of call niet gevonden."
  const { coordinator, syncRuntimeCalls } = createFixture({
    supabaseConfigured: true,
    supabaseHydrated: true,
  });
  const res = createResponseRecorder();

  await coordinator.setInterestedLeadInAgendaResponse(
    {
      body: {
        callId: 'call-1',
        appointmentDate: '2026-04-10',
        appointmentTime: '14:30',
        location: 'Amsterdam',
        actor: 'Serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.ok(
    syncRuntimeCalls.some((options) => options?.force === true && options?.maxAgeMs === 0),
    'set-in-agenda-route moet vóór materialisatie eerst de runtime-state + call updates vers ophalen'
  );
});

test('agenda interested leads coordinator kan set-in-agenda materialiseren uit de request-body snapshot als de lead intussen uit lokale runtime is verdwenen', async () => {
  // Repro: modal staat nog open met alle leaddetails, maar de server-instance
  // waarop de POST landt kent de callId lokaal niet (nog) of niet meer. In dat
  // geval mag "in agenda zetten" niet met 404 stranden zolang de modal een
  // geldige snapshot meestuurt.
  const { appointments, coordinator, upsertCalls } = createFixture({
    findInterestedLeadRowByCallId: () => null,
    getLatestCallUpdateByCallId: () => null,
    buildGeneratedLeadFollowUpFromCall: () => null,
    aiCallInsightsByCallId: [],
  });
  const res = createResponseRecorder();

  await coordinator.setInterestedLeadInAgendaResponse(
    {
      body: {
        callId: 'call-missing-locally',
        appointmentDate: '2026-04-23',
        appointmentTime: '23:23',
        location: 'Booterseweg 34',
        whatsappInfo: 'raamkozijn',
        whatsappConfirmed: true,
        actor: 'Serve',
        company: 'Servé Creusen',
        contact: 'Servé Creusen',
        phone: '0629917185',
        summary:
          'Ruben Nijhuis voerde een inhoudelijk gesprek met Servé Creusen over de huidige situatie.',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].callId, 'call-missing-locally');
  assert.equal(appointments[0].company, 'Servé Creusen');
  assert.equal(appointments[0].contact, 'Servé Creusen');
  assert.equal(appointments[0].phone, '0629917185');
  assert.equal(appointments[0].date, '2026-04-23');
  assert.equal(appointments[0].time, '23:23');
  assert.equal(appointments[0].location, 'Booterseweg 34');
});

test('agenda interested leads coordinator keeps dismiss unsafe when the same lead stays visible under another call id', async () => {
  const { applySnapshotCalls, coordinator, dismissCalls, persistWaitCalls } = createFixture({
    supabaseConfigured: true,
    supabaseHydrated: true,
    persistWaitResult: false,
    buildAllInterestedLeadRows: () => [
      {
        callId: 'call-2',
        company: 'Softora',
        contact: 'Serve Creusen',
        phone: '0612345678',
      },
    ],
  });
  const res = createResponseRecorder();

  await coordinator.dismissInterestedLeadResponse(
    {
      body: {
        callId: 'call-1',
        actor: 'Serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.equal(dismissCalls[0].reason, 'interested_lead_dismissed_manual');
  assert.deepEqual(persistWaitCalls, ['waited']);
  assert.equal(applySnapshotCalls.length, 1);
});

test('agenda interested leads coordinator hydrates first when supabase runtime is configured but cold', async () => {
  const { coordinator, hydrateCalls } = createFixture({
    supabaseConfigured: true,
    supabaseHydrated: false,
  });
  const res = createResponseRecorder();

  await coordinator.dismissInterestedLeadResponse(
    {
      body: {
        callId: 'call-1',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(hydrateCalls, [3]);
});

test('agenda interested leads coordinator rejects dismissal when shared Supabase persist fails', async () => {
  const { activityCalls, applySnapshotCalls, cancelCalls, coordinator, dismissCalls, persistWaitCalls, snapshotCalls } =
    createFixture({
      supabaseConfigured: true,
      supabaseHydrated: true,
      persistWaitResult: false,
    });
  const res = createResponseRecorder();

  await coordinator.dismissInterestedLeadResponse(
    {
      body: {
        callId: 'call-1',
        actor: 'Serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /gedeelde opslag/);
  assert.equal(dismissCalls.length, 1);
  assert.equal(cancelCalls.length, 1);
  assert.equal(activityCalls.length, 1);
  assert.deepEqual(persistWaitCalls, ['waited']);
  assert.equal(snapshotCalls.length, 1);
  assert.equal(applySnapshotCalls.length, 1);
});

test('agenda interested leads coordinator rejects set-in-agenda when shared Supabase persist fails', async () => {
  const { applySnapshotCalls, coordinator, persistWaitCalls, snapshotCalls, upsertCalls } = createFixture({
    supabaseConfigured: true,
    supabaseHydrated: true,
    persistWaitResult: false,
  });
  const res = createResponseRecorder();

  await coordinator.setInterestedLeadInAgendaResponse(
    {
      body: {
        callId: 'call-1',
        appointmentDate: '2026-04-10',
        appointmentTime: '14:30',
        location: 'Amsterdam',
        whatsappInfo: 'Stuur route door',
        whatsappConfirmed: true,
        actor: 'Serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /gedeelde opslag/);
  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(persistWaitCalls, ['waited']);
  assert.equal(snapshotCalls.length, 1);
  assert.equal(applySnapshotCalls.length, 1);
});

test('agenda interested leads coordinator accepts set-in-agenda after timeout when forced remote sync confirms it', async () => {
  const { applySnapshotCalls, coordinator, hydrateCalls, persistWaitCalls, syncRuntimeCalls } = createFixture({
    supabaseConfigured: true,
    supabaseHydrated: true,
    persistWaitResult: false,
    syncRuntimeResult: true,
  });
  const res = createResponseRecorder();

  await coordinator.setInterestedLeadInAgendaResponse(
    {
      body: {
        callId: 'call-1',
        appointmentDate: '2026-04-10',
        appointmentTime: '14:30',
        location: 'Amsterdam',
        whatsappInfo: 'Stuur route door',
        whatsappConfirmed: true,
        actor: 'Serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.taskCompleted, true);
  assert.deepEqual(persistWaitCalls, ['waited']);
  assert.ok(syncRuntimeCalls.length >= 1);
  assert.equal(syncRuntimeCalls[0]?.force, true);
  assert.equal(syncRuntimeCalls[0]?.maxAgeMs, 0);
  assert.equal(hydrateCalls.length, 0);
  assert.equal(applySnapshotCalls.length, 0);
});
