const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../testlib/server-process');

let serverRef = null;

test.before(async () => {
  serverRef = await startTestServer();
});

test.after(async () => {
  if (serverRef) {
    await serverRef.stop();
  }
});

async function getJson(pathname) {
  const response = await fetch(`${serverRef.baseUrl}${pathname}`, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function postJson(pathname, payload = {}) {
  const response = await fetch(`${serverRef.baseUrl}${pathname}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      origin: new URL(serverRef.baseUrl).origin,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function postProtectedApiExpectation(pathname, payload = {}, options = {}) {
  const authState = await getJson('/api/auth/session');
  const result = await postJson(pathname, payload);
  const configured = Boolean(authState.body?.configured);
  const successStatuses =
    Array.isArray(options.successStatuses) && options.successStatuses.length > 0
      ? options.successStatuses
      : [200];
  if (!configured) {
    assert.equal(result.response.status, 503, pathname);
    assert.equal(result.body.ok, false, pathname);
    return result;
  }
  assert.ok(
    successStatuses.includes(result.response.status) || result.response.status === 401,
    `${pathname} gaf onverwachte status ${result.response.status}`
  );
  return result;
}

async function getProtectedApiExpectation(pathname) {
  const authState = await getJson('/api/auth/session');
  const result = await getJson(pathname);
  const configured = Boolean(authState.body?.configured);
  if (!configured) {
    assert.equal(result.response.status, 503, pathname);
    assert.equal(result.body.ok, false, pathname);
    return result;
  }
  assert.ok(
    result.response.status === 200 || result.response.status === 401,
    `${pathname} gaf onverwachte status ${result.response.status}`
  );
  return result;
}

test('health endpoints expose stable baseline payloads', async () => {
  for (const pathname of ['/healthz', '/api/healthz', '/api/health/baseline']) {
    const { response, body } = await getJson(pathname);
    assert.equal(response.status, 200, pathname);
    assert.equal(body.ok, true, pathname);
    assert.equal(typeof body.service, 'string', pathname);
    assert.equal(typeof body.version, 'string', pathname);
    assert.equal(typeof body.timestamp, 'string', pathname);
    assert.equal(typeof body.supabase, 'object', pathname);
    assert.ok(Array.isArray(body.criticalFlows), pathname);
  }
});

test('dependency health endpoint exposes security-safe dependency state', async () => {
  const { response, body } = await getJson('/api/health/dependencies');
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.dependencies, 'object');
  assert.equal(typeof body.dependencies.supabase, 'object');
  assert.equal(typeof body.dependencies.mail, 'object');
  assert.equal(typeof body.dependencies.ai, 'object');
  assert.equal(typeof body.dependencies.sessions, 'object');
});

test('auth session contract is stable for anonymous requests', async () => {
  const { response, body } = await getJson('/api/auth/session');
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.configured, 'boolean');
  assert.equal(typeof body.authenticated, 'boolean');
  assert.equal(typeof body.mfaEnabled, 'boolean');
  assert.equal(typeof body.displayName, 'string');
});

test('premium profile and user management routes keep their auth boundaries', async () => {
  const authState = await getJson('/api/auth/session');
  const configured = Boolean(authState.body?.configured);

  const profileResult = await getJson('/api/auth/profile');
  if (!configured) {
    assert.equal(profileResult.response.status, 503);
    assert.equal(profileResult.body.ok, false);
  } else {
    assert.ok([200, 401].includes(profileResult.response.status));
    if (profileResult.response.status === 200) {
      assert.equal(profileResult.body.ok, true);
      assert.equal(typeof profileResult.body.user, 'object');
      assert.equal(typeof profileResult.body.session, 'object');
    }
  }

  const usersResult = await getJson('/api/premium-users');
  if (!configured) {
    assert.equal(usersResult.response.status, 503);
    assert.equal(usersResult.body.ok, false);
    return;
  }

  assert.ok([200, 401, 403].includes(usersResult.response.status));
  if (usersResult.response.status === 200) {
    assert.equal(usersResult.body.ok, true);
    assert.ok(Array.isArray(usersResult.body.users));
  }
});

test('auth logout contract stays stable for public callers', async () => {
  const { response, body } = await postJson('/api/auth/logout', {});
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.authenticated, false);
});

test('seo read routes keep their auth boundaries', async () => {
  const pagesResult = await getProtectedApiExpectation('/api/seo/pages');
  if (pagesResult.response.status === 200) {
    assert.equal(pagesResult.body.ok, true);
    assert.equal(typeof pagesResult.body.count, 'number');
    assert.ok(Array.isArray(pagesResult.body.pages));
  }

  const pageResult = await getProtectedApiExpectation('/api/seo/page?file=premium-website.html');
  if (pageResult.response.status === 200) {
    assert.equal(pageResult.body.ok, true);
    assert.equal(typeof pageResult.body.file, 'string');
    assert.equal(typeof pageResult.body.seo, 'object');
  }

  const auditResult = await getProtectedApiExpectation('/api/seo/site-audit');
  if (auditResult.response.status === 200) {
    assert.equal(auditResult.body.ok, true);
    assert.equal(typeof auditResult.body.overallScore, 'number');
    assert.ok(Array.isArray(auditResult.body.pages));
  }
});

test('seo write routes keep their auth boundaries', async () => {
  const pageSaveResult = await postProtectedApiExpectation('/api/seo/page', {
    file: 'premium-website.html',
    pageOverrides: { title: 'Contract test' },
  });
  if (pageSaveResult.response.status === 200) {
    assert.equal(pageSaveResult.body.ok, true);
    assert.equal(typeof pageSaveResult.body.file, 'string');
  }

  const automationResult = await postProtectedApiExpectation('/api/seo/automation', {
    preferredModel: 'gpt-5.1',
  });
  if (automationResult.response.status === 200) {
    assert.equal(automationResult.body.ok, true);
    assert.equal(typeof automationResult.body.automation, 'object');
  }
});

test('runtime ops routes keep their auth boundaries', async () => {
  const activityResult = await getProtectedApiExpectation('/api/dashboard/activity?limit=2');
  if (activityResult.response.status === 200) {
    assert.equal(activityResult.body.ok, true);
    assert.equal(typeof activityResult.body.count, 'number');
    assert.ok(Array.isArray(activityResult.body.activities));
  }

  const createResult = await postProtectedApiExpectation(
    '/api/dashboard/activity',
    {
      type: 'contract_test',
      title: 'Contract test activity',
    },
    { successStatuses: [201] }
  );
  if (createResult.response.status === 201) {
    assert.equal(createResult.body.ok, true);
    assert.equal(typeof createResult.body.activity, 'object');
    assert.equal(typeof createResult.body.activity.title, 'string');
  }

  const uiStateResult = await getProtectedApiExpectation('/api/ui-state-get?scope=contract_test');
  if (uiStateResult.response.status === 200) {
    assert.equal(uiStateResult.body.ok, true);
    assert.equal(uiStateResult.body.scope, 'contract_test');
    assert.equal(typeof uiStateResult.body.values, 'object');
  }
});

test('active order routes keep their auth boundaries and validation contracts', async () => {
  const generateResult = await postProtectedApiExpectation(
    '/api/active-orders/generate-site',
    {},
    { successStatuses: [400] }
  );
  if (generateResult.response.status === 400) {
    assert.equal(generateResult.body.ok, false);
    assert.equal(generateResult.body.error, 'Prompt ontbreekt');
  }

  const launchResult = await postProtectedApiExpectation(
    '/api/active-orders/launch-site',
    {},
    { successStatuses: [400] }
  );
  if (launchResult.response.status === 400) {
    assert.equal(launchResult.body.ok, false);
    assert.equal(launchResult.body.error, 'HTML ontbreekt');
  }
});

test('ai utility routes keep their auth boundaries and validation contracts', async () => {
  const previewResult = await postProtectedApiExpectation(
    '/api/website-preview/generate',
    {},
    { successStatuses: [400] }
  );
  if (previewResult.response.status === 400) {
    assert.equal(previewResult.body.ok, false);
    assert.equal(previewResult.body.error, 'Website-URL ontbreekt');
  }

  const linkCreateResult = await postProtectedApiExpectation(
    '/api/website-links/create',
    {},
    { successStatuses: [400, 503] }
  );
  if (linkCreateResult.response.status === 400) {
    assert.equal(linkCreateResult.body.ok, false);
    assert.equal(linkCreateResult.body.error, 'HTML code ontbreekt');
  }

  const dossierResult = await postProtectedApiExpectation(
    '/api/ai/order-dossier',
    {},
    { successStatuses: [400] }
  );
  if (dossierResult.response.status === 400) {
    assert.equal(dossierResult.body.ok, false);
    assert.equal(dossierResult.body.error, 'Onvoldoende dossierinformatie');
  }

  const transcriptResult = await postProtectedApiExpectation(
    '/api/ai/transcript-to-prompt',
    {},
    { successStatuses: [400] }
  );
  if (transcriptResult.response.status === 400) {
    assert.equal(transcriptResult.body.ok, false);
    assert.equal(transcriptResult.body.error, 'Transcript ontbreekt');
  }

  const notesResult = await postProtectedApiExpectation(
    '/api/ai/notes-image-to-text',
    {},
    { successStatuses: [400] }
  );
  if (notesResult.response.status === 400) {
    assert.equal(notesResult.body.ok, false);
    assert.equal(notesResult.body.error, 'Afbeelding ontbreekt');
  }
});

test('ai dashboard routes keep their auth boundaries and validation contracts', async () => {
  const chatResult = await postProtectedApiExpectation(
    '/api/ai/dashboard-chat',
    {},
    { successStatuses: [400] }
  );
  if (chatResult.response.status === 400) {
    assert.equal(chatResult.body.ok, false);
    assert.equal(chatResult.body.error, 'Vraag ontbreekt');
  }

  const summarizeResult = await postProtectedApiExpectation(
    '/api/ai/summarize',
    {},
    { successStatuses: [400] }
  );
  if (summarizeResult.response.status === 400) {
    assert.equal(summarizeResult.body.ok, false);
    assert.equal(summarizeResult.body.error, 'Tekst ontbreekt');
  }
});

test('agenda appointments contract remains readable', async () => {
  const result = await getProtectedApiExpectation('/api/agenda/appointments?limit=3');
  if (result.response.status === 200) {
    assert.equal(result.body.ok, true);
    assert.equal(typeof result.body.count, 'number');
    assert.ok(Array.isArray(result.body.appointments));
  }
});

test('agenda confirmation routes keep their auth boundaries and stable error contracts', async () => {
  const authState = await getJson('/api/auth/session');
  const configured = Boolean(authState.body?.configured);

  const detailResult = await getJson('/api/agenda/confirmation-tasks/999999');
  if (!configured) {
    assert.equal(detailResult.response.status, 503);
    assert.equal(detailResult.body.ok, false);
  } else {
    assert.ok([401, 404].includes(detailResult.response.status));
    if (detailResult.response.status === 404) {
      assert.equal(detailResult.body.ok, false);
      assert.equal(detailResult.body.error, 'Taak of afspraak niet gevonden');
    }
  }

  const sendResult = await postJson('/api/agenda/confirmation-tasks/999999/send-email', {
    recipientEmail: 'contract@softora.nl',
  });
  if (!configured) {
    assert.equal(sendResult.response.status, 503);
    assert.equal(sendResult.body.ok, false);
  } else {
    assert.ok([401, 404].includes(sendResult.response.status));
    if (sendResult.response.status === 404) {
      assert.equal(sendResult.body.ok, false);
      assert.equal(sendResult.body.error, 'Taak of afspraak niet gevonden');
    }
  }
});

test('agenda post-call routes keep their auth boundaries and stable error contracts', async () => {
  const authState = await getJson('/api/auth/session');
  const configured = Boolean(authState.body?.configured);

  const postCallResult = await postJson('/api/agenda/appointments/999999/post-call', {
    prompt: 'Contract test prompt',
  });
  if (!configured) {
    assert.equal(postCallResult.response.status, 503);
    assert.equal(postCallResult.body.ok, false);
  } else {
    assert.ok([401, 404].includes(postCallResult.response.status));
    if (postCallResult.response.status === 404) {
      assert.equal(postCallResult.body.ok, false);
      assert.equal(postCallResult.body.error, 'Afspraak niet gevonden');
    }
  }

  const addOrderResult = await postJson('/api/agenda/appointments/999999/add-active-order', {
    prompt: 'Contract test prompt',
  });
  if (!configured) {
    assert.equal(addOrderResult.response.status, 503);
    assert.equal(addOrderResult.body.ok, false);
  } else {
    assert.ok([401, 404].includes(addOrderResult.response.status));
    if (addOrderResult.response.status === 404) {
      assert.equal(addOrderResult.body.ok, false);
      assert.equal(addOrderResult.body.error, 'Afspraak niet gevonden');
    }
  }
});

test('agenda interested-lead routes keep their auth boundaries and stable error contracts', async () => {
  const authState = await getJson('/api/auth/session');
  const configured = Boolean(authState.body?.configured);

  const listResult = await getJson('/api/agenda/interested-leads?limit=2');
  if (!configured) {
    assert.equal(listResult.response.status, 503);
    assert.equal(listResult.body.ok, false);
  } else {
    assert.ok([200, 401].includes(listResult.response.status));
    if (listResult.response.status === 200) {
      assert.equal(listResult.body.ok, true);
      assert.equal(typeof listResult.body.count, 'number');
      assert.ok(Array.isArray(listResult.body.leads));
    }
  }

  const setInAgendaResult = await postJson('/api/agenda/interested-leads/set-in-agenda', {
    callId: 'missing-call',
    appointmentDate: '2026-04-10',
    appointmentTime: '14:30',
    location: 'Amsterdam',
  });
  if (!configured) {
    assert.equal(setInAgendaResult.response.status, 503);
    assert.equal(setInAgendaResult.body.ok, false);
  } else {
    assert.ok([401, 404].includes(setInAgendaResult.response.status));
    if (setInAgendaResult.response.status === 404) {
      assert.equal(setInAgendaResult.body.ok, false);
      assert.equal(setInAgendaResult.body.error, 'Lead of call niet gevonden.');
    }
  }

  const dismissResult = await postJson('/api/agenda/interested-leads/dismiss', {
    callId: 'missing-call',
  });
  if (!configured) {
    assert.equal(dismissResult.response.status, 503);
    assert.equal(dismissResult.body.ok, false);
  } else {
    assert.ok([200, 401].includes(dismissResult.response.status));
    if (dismissResult.response.status === 200) {
      assert.equal(dismissResult.body.ok, true);
      assert.equal(dismissResult.body.dismissed, true);
      assert.equal(dismissResult.body.callId, 'missing-call');
    }
  }
});

test('coldcalling endpoints keep their contract boundaries', async () => {
  const updatesResult = await getProtectedApiExpectation('/api/coldcalling/call-updates?limit=3');
  if (updatesResult.response.status === 200) {
    assert.equal(updatesResult.body.ok, true);
    assert.ok(Array.isArray(updatesResult.body.updates));
  }

  const costSummaryResult = await getJson('/api/coldcalling/cost-summary?scope=all_time');
  assert.ok([200, 401, 503].includes(costSummaryResult.response.status));
  if (costSummaryResult.response.status === 200) {
    assert.equal(costSummaryResult.body.ok, true);
    assert.equal(costSummaryResult.body.scope, 'all_time');
    assert.equal(typeof costSummaryResult.body.summary, 'object');
    assert.equal(typeof costSummaryResult.body.summary.costEur, 'number');
  } else {
    assert.equal(costSummaryResult.body.ok, false);
  }

  const missingCallIdResult = await getJson('/api/coldcalling/call-detail');
  assert.ok([400, 401, 503].includes(missingCallIdResult.response.status));
  assert.equal(missingCallIdResult.body.ok, false);
});

test('retell agenda function routes stay public but require Retell verification', async () => {
  const availabilityResult = await postJson('/api/retell/functions/agenda/availability', {
    date: '2099-04-20',
    time: '10:00',
  });
  assert.ok([401, 503].includes(availabilityResult.response.status));
  assert.equal(availabilityResult.body.ok, false);
});

test('runtime backup route is available in non-production verification mode', async () => {
  const authState = await getJson('/api/auth/session');
  const { response, body } = await getJson('/api/runtime-backup');
  if (!authState.body?.configured) {
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    return;
  }
  assert.ok([200, 401].includes(response.status));
  if (response.status === 200) {
    assert.equal(body.ok, true);
    assert.equal(typeof body.snapshot, 'object');
    assert.equal(typeof body.rollback, 'object');
  }
});

test('runtime debug routes keep their auth boundaries', async () => {
  const probeResult = await getProtectedApiExpectation('/api/supabase-probe');
  if (probeResult.response.status === 200) {
    assert.equal(typeof probeResult.body.configured, 'boolean');
    assert.equal(typeof probeResult.body.hasServiceRoleKey, 'boolean');
  }

  const syncResult = await postProtectedApiExpectation('/api/runtime-sync-now', {}, { successStatuses: [200] });
  if (syncResult.response.status === 200) {
    assert.equal(syncResult.body.ok === true || syncResult.body.ok === false, true);
    assert.equal(typeof syncResult.body.before, 'object');
    assert.equal(typeof syncResult.body.after, 'object');
    assert.equal(typeof syncResult.body.supabase, 'object');
  }
});
