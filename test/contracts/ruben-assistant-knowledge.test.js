const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  createRubenAssistantKnowledge,
  redactSensitiveText,
} = require('../../server/services/ruben-assistant-knowledge');

async function createFixtureRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'softora-ruben-knowledge-'));
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.mkdir(path.join(root, 'server/routes'), { recursive: true });
  await fs.mkdir(path.join(root, 'server/services'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });

  await fs.writeFile(
    path.join(root, 'premium-database.html'),
    [
      '<!doctype html>',
      '<title>Softora | Database</title>',
      '<h1>DATABASE</h1>',
      '<h2>Bedrijvenlijst</h2>',
      '<script src="assets/premium-database-photo-storage.js"></script>',
    ].join('\n')
  );
  await fs.writeFile(
    path.join(root, 'assets/premium-database-photo-storage.js'),
    'function loadDatabasePhotos() { return "database foto preview"; }'
  );
  await fs.writeFile(
    path.join(root, 'server/routes/mailbox.js'),
    "function register(app) { app.get('/api/mailbox/messages', handler); app.post('/api/mailbox/send', handler); }"
  );
  await fs.writeFile(
    path.join(root, 'server/services/mailbox.js'),
    'function createMailboxService() { return {}; }\nmodule.exports = { createMailboxService };'
  );
  await fs.writeFile(path.join(root, 'docs/architecture.md'), '# Architectuur\nMailbox en database.');
  await fs.writeFile(
    path.join(root, '.env.example'),
    'OPENAI_API_KEY=placeholder-secret-value\nSUPABASE_SERVICE_ROLE_KEY=verysecret'
  );
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'softora-test',
      description: 'Test repo',
      scripts: { 'verify:critical': 'node verify.js' },
      dependencies: { express: '^4.0.0' },
    })
  );
  await fs.writeFile(
    path.join(root, '.env'),
    ['OPENAI_API_KEY=sk', 'real-secret-should-not-read'].join('-')
  );

  return root;
}

test('ruben assistant knowledge builds a read-only safe index from current repo files', async () => {
  const repoRoot = await createFixtureRepo();
  const knowledge = createRubenAssistantKnowledge({
    repoRoot,
    now: () => Date.parse('2026-05-07T12:00:00.000Z'),
    cacheTtlMs: 1000,
    logger: { warn() {} },
  });

  const context = await knowledge.buildKnowledgeContext({
    question: 'Hoe werkt de premium database foto preview?',
  });

  assert.equal(context.source, 'repo-readonly-index');
  assert.equal(context.accessMode, 'read-only');
  assert.ok(context.coverage.page >= 1);
  assert.ok(context.coverage['frontend-asset'] >= 1);
  assert.ok(context.pages.some((page) => page.route === '/premium-database'));
  assert.ok(
    context.relevantItems.some((item) => item.file === 'assets/premium-database-photo-storage.js')
  );
  assert.doesNotMatch(JSON.stringify(context), new RegExp(['sk', 'real-secret-should-not-read'].join('-')));
  assert.doesNotMatch(JSON.stringify(context), /placeholder-secret-value/);
  assert.doesNotMatch(JSON.stringify(context), /verysecret/);

  const index = await knowledge.getIndex();
  assert.match(JSON.stringify(index), /\[redacted\]/);
  assert.doesNotMatch(JSON.stringify(index), new RegExp(['sk', 'real-secret-should-not-read'].join('-')));
});

test('ruben assistant knowledge redacts secret-looking values', () => {
  const redacted = redactSensitiveText(
    `OPENAI_ADMIN_KEY=${['sk', 'abc1234567890secretvalue'].join('-')} SUPABASE_SERVICE_ROLE_KEY=service-role`
  );

  assert.match(redacted, /OPENAI_ADMIN_KEY=\[redacted\]/);
  assert.match(redacted, /SUPABASE_SERVICE_ROLE_KEY=\[redacted\]/);
  assert.doesNotMatch(redacted, new RegExp(['sk', 'abc1234567890secretvalue'].join('-')));
});
