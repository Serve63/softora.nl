const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { createActiveOrderAutomationService } = require('../../server/services/active-order-automation');

function createFixture(overrides = {}) {
  const fsCalls = {
    mkdtemp: [],
    writeFile: [],
    rm: [],
  };
  const githubCalls = [];
  const commandCalls = [];
  const stratoCalls = [];

  const service = createActiveOrderAutomationService({
    automationEnabled:
      overrides.automationEnabled === undefined ? true : Boolean(overrides.automationEnabled),
    githubToken: overrides.githubToken === undefined ? 'github-token' : overrides.githubToken,
    githubOwner: overrides.githubOwner === undefined ? 'servecreusen' : overrides.githubOwner,
    githubPrivate: true,
    githubOwnerIsOrg: false,
    githubRepoPrefix: 'softora-case-',
    githubDefaultBranch: 'main',
    vercelToken: overrides.vercelToken === undefined ? 'vercel-token' : overrides.vercelToken,
    vercelScope: 'softora',
    stratoCommand: '',
    stratoWebhookUrl: '',
    stratoWebhookToken: '',
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    sanitizeLaunchDomainName: (value) => {
      const raw = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      return raw.includes('.') ? raw : '';
    },
    slugifyAutomationText: (value, fallback = 'project') =>
      String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || fallback,
    fsPromises: {
      async mkdtemp(prefix) {
        fsCalls.mkdtemp.push(prefix);
        return '/tmp/softora-case-test-123';
      },
      async writeFile(filePath, content, encoding) {
        fsCalls.writeFile.push({ filePath, content, encoding });
      },
      async rm(targetPath, options) {
        fsCalls.rm.push({ targetPath, options });
      },
    },
    osModule: {
      tmpdir: () => '/tmp',
      homedir: () => '/home/tester',
    },
    pathModule: path,
    ensureGitHubRepository:
      overrides.ensureGitHubRepository ||
      (async (owner, repoName) => {
        githubCalls.push({ type: 'ensure', owner, repoName });
        return {
          owner,
          repo: repoName,
          htmlUrl: `https://github.com/${owner}/${repoName}`,
          created: true,
        };
      }),
    upsertGitHubFile:
      overrides.upsertGitHubFile ||
      (async (owner, repo, filePath, content, message) => {
        githubCalls.push({ type: 'upsert', owner, repo, filePath, content, message });
        return { path: filePath };
      }),
    runCommandWithOutput:
      overrides.runCommandWithOutput ||
      (async (command, args, options) => {
        commandCalls.push({ command, args, options });
        if (args.includes('deploy')) {
          return {
            stdout: 'Inspecteer https://softora-case.vercel.app',
            stderr: '',
          };
        }
        return {
          stdout: 'alias ok',
          stderr: '',
        };
      }),
    runStratoAutomationHook:
      overrides.runStratoAutomationHook ||
      (async (input) => {
        stratoCalls.push(input);
        return {
          status: 'ok',
          message: 'Strato webhook uitgevoerd.',
        };
      }),
    logger: {
      error: () => {},
    },
  });

  return {
    commandCalls,
    fsCalls,
    githubCalls,
    service,
    stratoCalls,
  };
}

test('active order automation service parses vercel urls and supports disabled automation', async () => {
  const { service } = createFixture({ automationEnabled: false });

  assert.equal(
    service.parseFirstVercelUrl('eerste https://a.vercel.app tweede https://b.vercel.app'),
    'https://b.vercel.app'
  );

  const result = await service.runActiveOrderLaunchPipeline({ html: '<html></html>' });

  assert.equal(result.ok, true);
  assert.equal(result.outputs.domainStatus, 'skipped');
  assert.equal(result.steps[0].status, 'skipped');
});

test('active order automation service validates html and required automation config', async () => {
  const missingHtmlFixture = createFixture();
  await assert.rejects(
    () => missingHtmlFixture.service.runActiveOrderLaunchPipeline({ html: '   ' }),
    /Launch pipeline verwacht HTML/
  );

  const missingConfigFixture = createFixture({
    githubToken: '',
  });
  await assert.rejects(
    () => missingConfigFixture.service.runActiveOrderLaunchPipeline({ html: '<html></html>' }),
    /GitHub automation niet compleet/
  );
});

test('active order automation service runs the pipeline and cleans up temp workspace', async () => {
  const { commandCalls, fsCalls, githubCalls, service, stratoCalls } = createFixture();

  const result = await service.runActiveOrderLaunchPipeline({
    orderId: 42,
    company: 'Softora',
    title: 'Nieuwe case',
    description: 'Beschrijving',
    deliveryTime: '2 weken',
    domainName: 'https://www.softora.nl/demo',
    html: '<html><body>Softora</body></html>',
  });

  assert.equal(result.ok, true);
  assert.equal(result.outputs.githubRepoUrl, 'https://github.com/servecreusen/softora-case-softora-42');
  assert.equal(result.outputs.deploymentUrl, 'https://softora-case.vercel.app');
  assert.equal(result.outputs.domainStatus, 'ok');
  assert.equal(fsCalls.mkdtemp.length, 1);
  assert.equal(fsCalls.writeFile.length, 3);
  assert.equal(fsCalls.rm.length, 1);
  assert.equal(githubCalls.filter((call) => call.type === 'upsert').length, 3);
  assert.equal(commandCalls.length, 2);
  assert.equal(stratoCalls.length, 1);
  assert.equal(result.steps.some((step) => step.id === 'vercel_domain_alias' && step.status === 'ok'), true);
});

test('active order automation service degrades alias failures to skipped without failing deploy', async () => {
  const { service } = createFixture({
    runCommandWithOutput: async (_command, args) => {
      if (args.includes('deploy')) {
        return {
          stdout: 'https://softora-case.vercel.app',
          stderr: '',
        };
      }
      const error = new Error('Alias mislukt');
      error.stderr = 'alias denied';
      throw error;
    },
  });

  const result = await service.runActiveOrderLaunchPipeline({
    company: 'Softora',
    title: 'Nieuwe case',
    domainName: 'softora.nl',
    html: '<html><body>Softora</body></html>',
  });

  const aliasStep = result.steps.find((step) => step.id === 'vercel_domain_alias');
  assert.equal(result.ok, true);
  assert.equal(aliasStep.status, 'skipped');
  assert.match(aliasStep.message, /alias denied/i);
});
