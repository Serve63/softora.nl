const test = require('node:test');
const assert = require('node:assert/strict');

const { createOutboundRecipientGuardService } = require('../../server/services/outbound-recipient-guard');

test('central outbound recipient guard hard-blocks growsocialmedia.nl before Supabase insert', async () => {
  let insertCalled = false;
  const service = createOutboundRecipientGuardService({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      from: () => ({
        insert: () => {
          insertCalled = true;
          return {
            select: async () => ({ data: [], error: null }),
          };
        },
      }),
    }),
  });

  await assert.rejects(
    () =>
      service.reserveRecipients([
        {
          recipientEmail: 'info@growsocialmedia.nl',
          recipientDomain: 'growsocialmedia.nl',
          recipientCompany: 'Grow Social Media',
          recipientCompanyKey: 'grow-social-media',
        },
      ], {
        provider: 'softora',
        channel: 'coldmail',
        source: 'test',
      }),
    (error) => {
      assert.equal(error.code, 'OUTREACH_SUPPRESSION_HARD_BLOCK');
      assert.match(error.message, /growsocialmedia\.nl/);
      return true;
    }
  );
  assert.equal(insertCalled, false);
});

test('central outbound recipient guard hard-blocks growsocialmedia.nl mail subdomains', async () => {
  let insertCalled = false;
  const service = createOutboundRecipientGuardService({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      from: () => ({
        insert: () => {
          insertCalled = true;
          return {
            select: async () => ({ data: [], error: null }),
          };
        },
      }),
    }),
  });

  await assert.rejects(
    () =>
      service.reserveRecipients([
        {
          recipientEmail: 'sales@mail.growsocialmedia.nl',
          recipientCompany: 'Grow Social Media',
        },
      ], {
        provider: 'softora',
        channel: 'coldmail',
        source: 'test',
      }),
    (error) => {
      assert.equal(error.code, 'OUTREACH_SUPPRESSION_HARD_BLOCK');
      assert.match(error.message, /growsocialmedia\.nl/);
      return true;
    }
  );
  assert.equal(insertCalled, false);
});

test('central outbound recipient guard hard-blocks Grow Social Media company names without domain', async () => {
  let insertCalled = false;
  const service = createOutboundRecipientGuardService({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      from: () => ({
        insert: () => {
          insertCalled = true;
          return {
            select: async () => ({ data: [], error: null }),
          };
        },
      }),
    }),
  });

  await assert.rejects(
    () =>
      service.reserveRecipients([
        {
          recipientEmail: 'owner@example.test',
          recipientCompany: 'Grow Social Media B.V.',
          recipientCompanyKey: 'grow-social-media-bv',
        },
      ], {
        provider: 'softora',
        channel: 'coldmail',
        source: 'test',
      }),
    (error) => {
      assert.equal(error.code, 'OUTREACH_SUPPRESSION_HARD_BLOCK');
      assert.match(error.message, /growsocialmedia\.nl/);
      return true;
    }
  );
  assert.equal(insertCalled, false);
});
