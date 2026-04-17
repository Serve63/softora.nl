const test = require('node:test');
const assert = require('node:assert/strict');

const { createLeadOwnerService } = require('../../server/services/lead-owners');

function createFixture(overrides = {}) {
  const leadOwnerAssignmentsByCallId = new Map(overrides.assignments || []);
  const persistReasons = [];
  let nextLeadOwnerRotationIndex = Number(overrides.nextLeadOwnerRotationIndex || 0) || 0;

  const premiumUsersStore = {
    getCachedUsers: () => overrides.users || [],
    buildUserDisplayName: (user) =>
      String(user?.displayName || user?.fullName || user?.name || '').trim(),
  };

  const service = createLeadOwnerService({
    premiumUsersStore,
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    normalizePremiumSessionEmail: (value) =>
      String(value || '').trim().toLowerCase(),
    leadOwnerAssignmentsByCallId,
    getNextLeadOwnerRotationIndex: () => nextLeadOwnerRotationIndex,
    setNextLeadOwnerRotationIndex: (value) => {
      nextLeadOwnerRotationIndex = Number(value) || 0;
    },
    queueRuntimeStatePersist: (reason) => persistReasons.push(reason),
  });

  return {
    leadOwnerAssignmentsByCallId,
    persistReasons,
    premiumUsersStore,
    service,
    getNextLeadOwnerRotationIndex: () => nextLeadOwnerRotationIndex,
  };
}

test('lead owner service rotates through fallback owners and persists assignments', () => {
  const { leadOwnerAssignmentsByCallId, persistReasons, service, getNextLeadOwnerRotationIndex } =
    createFixture();

  const first = service.buildLeadOwnerFields('call-1');
  const second = service.buildLeadOwnerFields('call-2');

  assert.deepEqual(first, {
    leadOwnerKey: 'serve',
    leadOwnerName: 'Servé Creusen',
    leadOwnerFullName: 'Servé Creusen',
    leadOwnerUserId: '',
    leadOwnerEmail: '',
  });
  assert.deepEqual(second, {
    leadOwnerKey: 'martijn',
    leadOwnerName: 'Martijn van de Ven',
    leadOwnerFullName: 'Martijn van de Ven',
    leadOwnerUserId: '',
    leadOwnerEmail: '',
  });
  assert.equal(leadOwnerAssignmentsByCallId.get('call-1')?.key, 'serve');
  assert.equal(leadOwnerAssignmentsByCallId.get('call-2')?.key, 'martijn');
  assert.deepEqual(persistReasons, ['lead_owner_assignment', 'lead_owner_assignment']);
  assert.equal(getNextLeadOwnerRotationIndex(), 0);
});

test('lead owner service derives active pool users and normalizes username-like display names', () => {
  const { service } = createFixture({
    users: [
      {
        id: 'u-1',
        displayName: 'serve.creusen',
        email: 'serve@softora.nl',
        status: 'active',
      },
      {
        id: 'u-2',
        displayName: 'Martijn van de Ven',
        email: 'martijn@softora.nl',
        status: 'active',
      },
      {
        id: 'u-3',
        displayName: 'Iemand Anders',
        email: 'ander@softora.nl',
        status: 'inactive',
      },
    ],
  });

  const fields = service.buildLeadOwnerFields('call-42');

  assert.equal(fields.leadOwnerKey, 'serve');
  assert.equal(fields.leadOwnerName, 'Servé Creusen');
  assert.equal(fields.leadOwnerFullName, 'Servé Creusen');
  assert.equal(fields.leadOwnerUserId, 'u-1');
  assert.equal(fields.leadOwnerEmail, 'serve@softora.nl');
});

test('lead owner service preserves explicit owner values and supports lookup without auto-create', () => {
  const { service } = createFixture({
    assignments: [
      [
        'call-9',
        {
          key: 'martijn',
          displayName: 'martijn.vdven',
          fullName: 'martijn.vdven',
          userId: 'u-9',
          email: 'MARTIJN@SOFTORA.NL',
        },
      ],
    ],
  });

  const existing = service.buildLeadOwnerFields('call-9');
  const explicit = service.buildLeadOwnerFields('call-10', {
    key: 'serve',
    displayName: 'Servé Creusen',
    fullName: 'Servé Creusen',
    userId: 'u-10',
    email: 'SERVE@SOFTORA.NL',
  });
  const missing = service.getOrAssignLeadOwnerByCallId('call-11', { createIfMissing: false });

  assert.equal(existing.leadOwnerKey, 'martijn');
  assert.equal(existing.leadOwnerName, 'Martijn van de Ven');
  assert.equal(existing.leadOwnerEmail, 'martijn@softora.nl');
  assert.equal(explicit.leadOwnerKey, 'serve');
  assert.equal(explicit.leadOwnerUserId, 'u-10');
  assert.equal(explicit.leadOwnerEmail, 'serve@softora.nl');
  assert.equal(missing, null);
});
