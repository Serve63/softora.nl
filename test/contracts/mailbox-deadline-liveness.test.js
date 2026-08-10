const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('harde mailboxdeadlines houden een verder lege Node-runtime levend', () => {
  const mutationRunnerPath = path.resolve(
    __dirname,
    '../../server/services/mailbox-campaign-mutation-runner.js'
  );
  const queryTimeoutPath = path.resolve(
    __dirname,
    '../../server/services/mailbox-index-query-timeout.js'
  );
  const script = `
    const { createMailboxCampaignMutationRunner } = require(${JSON.stringify(mutationRunnerPath)});
    const { executeMailboxIndexQuery } = require(${JSON.stringify(queryTimeoutPath)});

    async function main() {
      const runner = createMailboxCampaignMutationRunner({
        mailboxCampaignConsistencyStore: {
          isAvailable: () => true,
          beginMutation: () => new Promise(() => {}),
          completeMutation: async () => null,
        },
      });
      await runner.run({
        requestKey: 'imap-sync:deadline-liveness',
        kind: 'imap-sync',
        leaseSeconds: 16,
        deadlineMs: 10,
      }, async () => null).catch((error) => {
        if (error?.code !== 'MAILBOX_CAMPAIGN_MUTATION_DEADLINE') throw error;
      });

      const mutation = new AbortController();
      const query = {
        abortSignal(signal) {
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
      };
      await executeMailboxIndexQuery(query, {
        label: 'deadline-liveness',
        timeoutMs: 250,
        mutationSignal: mutation.signal,
      }).catch((error) => {
        if (error?.code !== 'MAILBOX_INDEX_WRITE_OUTCOME_UNKNOWN') throw error;
      });
      process.stdout.write('deadlines-live');
    }

    main().catch((error) => {
      process.stderr.write(String(error?.stack || error));
      process.exitCode = 1;
    });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 5000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.stdout, 'deadlines-live');
});
