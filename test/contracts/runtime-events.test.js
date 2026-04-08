const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeEventStore } = require('../../server/security/runtime-events');

function createFixture() {
  const recentDashboardActivities = [];
  const recentSecurityAuditEvents = [];
  const persistReasons = [];

  const eventStore = createRuntimeEventStore({
    recentDashboardActivities,
    recentSecurityAuditEvents,
    queueRuntimeStatePersist: (reason) => persistReasons.push(reason),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    normalizePremiumSessionEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeIpAddress: (value) => String(value || '').trim(),
    normalizeOrigin: (value) => String(value || '').trim().toLowerCase(),
  });

  return {
    eventStore,
    persistReasons,
    recentDashboardActivities,
    recentSecurityAuditEvents,
  };
}

test('runtime event store appends normalized security audit events and caps the list', () => {
  const { eventStore, persistReasons, recentSecurityAuditEvents } = createFixture();
  for (let index = 0; index < 500; index += 1) {
    recentSecurityAuditEvents.push({ id: `old-${index}` });
  }

  const entry = eventStore.appendSecurityAuditEvent(
    {
      email: '  ADMIN@Softora.NL ',
      ip: ' 203.0.113.10 ',
      origin: ' HTTPS://APP.SOFTORA.NL ',
      detail: 'Afgewezen login',
    },
    'security_login_rejected'
  );

  assert.equal(recentSecurityAuditEvents.length, 500);
  assert.equal(recentSecurityAuditEvents[0], entry);
  assert.equal(entry.email, 'admin@softora.nl');
  assert.equal(entry.ip, '203.0.113.10');
  assert.equal(entry.origin, 'https://app.softora.nl');
  assert.equal(persistReasons[0], 'security_login_rejected');
});

test('runtime event store appends dashboard activities with stable defaults', () => {
  const { eventStore, persistReasons, recentDashboardActivities } = createFixture();

  const entry = eventStore.appendDashboardActivity(
    {
      detail: 'Nieuwe taak toegevoegd',
      taskId: '42',
      actor: 'serve',
    },
    'dashboard_activity_manual'
  );

  assert.equal(recentDashboardActivities[0], entry);
  assert.equal(entry.title, 'Dashboard actie');
  assert.equal(entry.source, 'premium-personeel-dashboard');
  assert.equal(entry.taskId, 42);
  assert.equal(entry.actor, 'serve');
  assert.equal(persistReasons[0], 'dashboard_activity_manual');
});
