const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function createActiveOrderAutomationService(deps = {}) {
  const {
    automationEnabled = false,
    githubToken = '',
    githubOwner = '',
    githubPrivate = true,
    githubOwnerIsOrg = false,
    githubRepoPrefix = 'softora-case-',
    githubDefaultBranch = 'main',
    vercelToken = '',
    vercelScope = '',
    stratoCommand = '',
    stratoWebhookUrl = '',
    stratoWebhookToken = '',
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    sanitizeLaunchDomainName = (value) => String(value || '').trim(),
    slugifyAutomationText = (value, fallback = 'project') => String(value || '').trim() || fallback,
    fsPromises = fs.promises,
    osModule = os,
    pathModule = path,
    spawnImpl = spawn,
    fetchImpl = globalThis.fetch,
    logger = console,
  } = deps;

  const parseFirstVercelUrl =
    deps.parseFirstVercelUrl ||
    function parseFirstVercelUrl(text) {
      const match = String(text || '').match(/https:\/\/[a-z0-9-]+(?:-[a-z0-9-]+)*\.vercel\.app/gi);
      if (!match || !match.length) return '';
      return String(match[match.length - 1] || '').trim();
    };

  const runCommandWithOutput =
    deps.runCommandWithOutput ||
    (async function runCommandWithOutput(command, args = [], options = {}) {
      const cwd = options.cwd || process.cwd();
      const timeoutMs = Math.max(1_000, Math.min(900_000, Number(options.timeoutMs || 300_000)));
      const env = {
        ...process.env,
        ...(options.env && typeof options.env === 'object' ? options.env : {}),
      };

      return await new Promise((resolve, reject) => {
        const child = spawnImpl(command, Array.isArray(args) ? args : [], {
          cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        });

        let stdout = '';
        let stderr = '';
        let done = false;

        const finish = (error, result) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(result);
        };

        const timer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch (_) {
            // ignore kill errors
          }
          const error = new Error(`Command timeout na ${Math.round(timeoutMs / 1000)}s: ${command}`);
          error.code = 'COMMAND_TIMEOUT';
          error.stdout = stdout;
          error.stderr = stderr;
          finish(error);
        }, timeoutMs);

        child.stdout.on('data', (chunk) => {
          stdout += String(chunk || '');
          if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
        });
        child.stderr.on('data', (chunk) => {
          stderr += String(chunk || '');
          if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
        });

        child.on('error', (error) => {
          error.stdout = stdout;
          error.stderr = stderr;
          finish(error);
        });
        child.on('close', (code, signal) => {
          const exitCode = Number(code);
          if (Number.isFinite(exitCode) && exitCode === 0) {
            finish(null, {
              code: exitCode,
              signal: signal || null,
              stdout,
              stderr,
            });
            return;
          }
          const error = new Error(
            `Command faalde (${command}) met code ${Number.isFinite(exitCode) ? exitCode : 'onbekend'}`
          );
          error.code = 'COMMAND_FAILED';
          error.exitCode = Number.isFinite(exitCode) ? exitCode : null;
          error.signal = signal || null;
          error.stdout = stdout;
          error.stderr = stderr;
          finish(error);
        });
      });
    });

  const fetchGitHubApi =
    deps.fetchGitHubApi ||
    (async function fetchGitHubApi(pathnameValue, options = {}) {
      const token = String(options.token || githubToken || '').trim();
      if (!token) {
        throw new Error('ACTIVE_ORDER_AUTOMATION_GITHUB_TOKEN ontbreekt.');
      }

      const method = String(options.method || 'GET').toUpperCase();
      const endpoint = `https://api.github.com${pathnameValue}`;
      const headers = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'softora-automation',
      };
      if (method !== 'GET' && method !== 'HEAD') {
        headers['Content-Type'] = 'application/json';
      }
      const response = await fetchImpl(endpoint, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {
        data = null;
      }
      return {
        ok: response.ok,
        status: Number(response.status) || 0,
        data,
        text,
      };
    });

  const ensureGitHubRepository =
    deps.ensureGitHubRepository ||
    (async function ensureGitHubRepository(owner, repoName) {
      const lookup = await fetchGitHubApi(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`
      );
      if (lookup.ok) {
        const htmlUrl = normalizeString(lookup?.data?.html_url || '');
        return {
          owner,
          repo: repoName,
          htmlUrl: htmlUrl || `https://github.com/${owner}/${repoName}`,
          created: false,
        };
      }
      if (lookup.status !== 404) {
        throw new Error(`GitHub repository check mislukt (${lookup.status}).`);
      }

      const payload = {
        name: repoName,
        private: githubPrivate,
        auto_init: false,
        description: 'Automatisch gegenereerde Softora website case',
      };
      const createPath = githubOwnerIsOrg
        ? `/orgs/${encodeURIComponent(owner)}/repos`
        : '/user/repos';
      const createRes = await fetchGitHubApi(createPath, {
        method: 'POST',
        body: payload,
      });
      if (!createRes.ok) {
        const detail = normalizeString(createRes?.data?.message || createRes?.text || '');
        throw new Error(
          `GitHub repository aanmaken mislukt (${createRes.status})${detail ? `: ${detail}` : ''}`
        );
      }
      const htmlUrl = normalizeString(createRes?.data?.html_url || '');
      return {
        owner,
        repo: repoName,
        htmlUrl: htmlUrl || `https://github.com/${owner}/${repoName}`,
        created: true,
      };
    });

  const upsertGitHubFile =
    deps.upsertGitHubFile ||
    (async function upsertGitHubFile(owner, repo, filePath, content, message) {
      const encodedPath = String(filePath || '')
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('/');
      let sha = null;
      const current = await fetchGitHubApi(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
          repo
        )}/contents/${encodedPath}?ref=${encodeURIComponent(githubDefaultBranch)}`
      );
      if (current.ok && current?.data?.sha) {
        sha = String(current.data.sha);
      } else if (!current.ok && current.status !== 404) {
        throw new Error(`GitHub bestand lezen mislukt (${filePath})`);
      }

      const body = {
        message: String(message || `Update ${filePath}`),
        content: Buffer.from(String(content || ''), 'utf8').toString('base64'),
        branch: githubDefaultBranch,
      };
      if (sha) body.sha = sha;

      const save = await fetchGitHubApi(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
        {
          method: 'PUT',
          body,
        }
      );
      if (!save.ok) {
        const detail = normalizeString(save?.data?.message || save?.text || '');
        throw new Error(
          `GitHub bestand opslaan mislukt (${filePath})${detail ? `: ${detail}` : ''}`
        );
      }
      return save?.data?.content || null;
    });

  const runStratoAutomationHook =
    deps.runStratoAutomationHook ||
    (async function runStratoAutomationHook({ domainName, projectDir, deploymentUrl }) {
      const domain = sanitizeLaunchDomainName(domainName);
      if (!domain) {
        return {
          status: 'skipped',
          message: 'Geen domein opgegeven; Strato stap overgeslagen.',
        };
      }

      if (stratoCommand) {
        const escapedDomain = domain.replace(/'/g, `'\\''`);
        const escapedProjectDir = String(projectDir || '').replace(/'/g, `'\\''`);
        const escapedDeploymentUrl = String(deploymentUrl || '').replace(/'/g, `'\\''`);
        const command = stratoCommand
          .replace(/\{\{domain\}\}/g, escapedDomain)
          .replace(/\{\{projectDir\}\}/g, escapedProjectDir)
          .replace(/\{\{deploymentUrl\}\}/g, escapedDeploymentUrl);
        const result = await runCommandWithOutput('bash', ['-lc', command], {
          cwd: projectDir || process.cwd(),
          timeoutMs: 300000,
        });
        const info =
          parseFirstVercelUrl(result.stdout || '') ||
          normalizeString(result.stdout || result.stderr || '');
        return {
          status: 'ok',
          message: info ? truncateText(info, 220) : 'Strato command uitgevoerd.',
        };
      }

      if (stratoWebhookUrl) {
        const response = await fetchImpl(stratoWebhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(stratoWebhookToken ? { Authorization: `Bearer ${stratoWebhookToken}` } : {}),
          },
          body: JSON.stringify({
            domain,
            deploymentUrl: String(deploymentUrl || ''),
            projectDir: String(projectDir || ''),
          }),
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(
            `Strato webhook faalde (${response.status})${text ? `: ${truncateText(text, 180)}` : ''}`
          );
        }
        return {
          status: 'ok',
          message: 'Strato webhook uitgevoerd.',
        };
      }

      throw new Error(
        'Strato automatisering niet geconfigureerd (set ACTIVE_ORDER_AUTOMATION_STRATO_COMMAND of _WEBHOOK_URL).'
      );
    });

  const runActiveOrderLaunchPipeline =
    deps.runActiveOrderLaunchPipeline ||
    (async function runActiveOrderLaunchPipeline(input = {}) {
      if (!automationEnabled) {
        return {
          ok: true,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          outputs: {
            domainStatus: 'skipped',
            domainMessage: 'Automation disabled',
          },
          steps: [
            {
              id: 'automation_toggle',
              label: 'Automation',
              status: 'skipped',
              message: 'ACTIVE_ORDER_AUTOMATION_ENABLED staat uit.',
            },
          ],
        };
      }

      const orderId = Number(input.orderId) || null;
      const company =
        truncateText(normalizeString(input.company || input.clientName || ''), 160) ||
        'Softora Case';
      const title = truncateText(normalizeString(input.title || ''), 200) || 'Website';
      const description = truncateText(normalizeString(input.description || ''), 2000);
      const deliveryTime = truncateText(normalizeString(input.deliveryTime || ''), 200);
      const html = String(input.html || '');
      const domainName = sanitizeLaunchDomainName(input.domainName || input.domain || '');

      if (!html.trim()) {
        throw new Error('Launch pipeline verwacht HTML in body.html.');
      }

      if (!githubToken || !githubOwner) {
        throw new Error(
          'GitHub automation niet compleet: set ACTIVE_ORDER_AUTOMATION_GITHUB_TOKEN en ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER.'
        );
      }
      if (!vercelToken) {
        throw new Error('Vercel automation niet compleet: set ACTIVE_ORDER_AUTOMATION_VERCEL_TOKEN.');
      }

      const steps = [];
      const outputs = {};
      const startedAt = new Date().toISOString();

      const projectBase = domainName
        ? slugifyAutomationText(domainName.replace(/\.[^.]+$/, ''), 'project')
        : slugifyAutomationText(`${company}-${title}`, 'project');
      const projectFolderLabel = orderId
        ? `${projectBase}-${orderId}`
        : `${projectBase}-${Date.now()}`;
      const projectDir = await fsPromises.mkdtemp(
        pathModule.join(
          osModule.tmpdir(),
          `${slugifyAutomationText(projectFolderLabel, 'softora-case')}-`
        )
      );

      steps.push({
        id: 'temporary_workspace',
        label: 'Tijdelijke build-workspace',
        status: 'ok',
        message: 'Tijdelijke workspace klaargezet voor deploy.',
      });

      try {
        const meta = {
          orderId,
          company,
          title,
          description,
          deliveryTime,
          domainName: domainName || null,
          generatedAt: startedAt,
        };
        await fsPromises.writeFile(pathModule.join(projectDir, 'index.html'), html, 'utf8');
        await fsPromises.writeFile(
          pathModule.join(projectDir, 'softora-case.json'),
          JSON.stringify(meta, null, 2),
          'utf8'
        );
        await fsPromises.writeFile(
          pathModule.join(projectDir, 'README.md'),
          [
            `# ${title}`,
            '',
            `- Bedrijf: ${company}`,
            `- Order: ${orderId || 'n/a'}`,
            domainName ? `- Domein: ${domainName}` : '- Domein: niet opgegeven',
            `- Gegenereerd: ${startedAt}`,
            '',
            'Deze tijdelijke workspace is automatisch aangemaakt door Softora Active Order Automation.',
          ].join('\n'),
          'utf8'
        );

        const repoName = `${githubRepoPrefix}${projectBase}${orderId ? `-${orderId}` : ''}`.slice(
          0,
          95
        );
        const repoInfo = await ensureGitHubRepository(githubOwner, repoName);
        await upsertGitHubFile(
          repoInfo.owner,
          repoInfo.repo,
          'index.html',
          html,
          `Publish case ${orderId || ''}`.trim()
        );
        await upsertGitHubFile(
          repoInfo.owner,
          repoInfo.repo,
          'softora-case.json',
          JSON.stringify(meta, null, 2),
          `Update case metadata ${orderId || ''}`.trim()
        );
        await upsertGitHubFile(
          repoInfo.owner,
          repoInfo.repo,
          'README.md',
          [
            `# ${title}`,
            '',
            `Automatisch gepubliceerd vanuit Softora Active Opdrachten.`,
            '',
            `- Bedrijf: ${company}`,
            `- Order ID: ${orderId || 'n/a'}`,
            domainName ? `- Domein: ${domainName}` : '- Domein: niet opgegeven',
            `- Laatste update: ${new Date().toISOString()}`,
          ].join('\n'),
          `Update README ${orderId || ''}`.trim()
        );
        outputs.githubRepoUrl = repoInfo.htmlUrl;
        steps.push({
          id: 'github',
          label: 'GitHub push',
          status: 'ok',
          message: repoInfo.created
            ? `Repo aangemaakt + bestanden gepusht (${repoInfo.htmlUrl})`
            : `Bestanden gepusht (${repoInfo.htmlUrl})`,
        });

        const vercelArgs = ['--yes', 'vercel', 'deploy', projectDir, '--prod', '--yes', '--token', vercelToken];
        if (vercelScope) {
          vercelArgs.push('--scope', vercelScope);
        }
        const vercelResult = await runCommandWithOutput('npx', vercelArgs, {
          cwd: projectDir,
          timeoutMs: 600000,
          env: {
            HOME: process.env.HOME || osModule.homedir(),
          },
        });
        const deploymentUrl = parseFirstVercelUrl(`${vercelResult.stdout}\n${vercelResult.stderr}`);
        if (!deploymentUrl) {
          throw new Error('Vercel deploy uitgevoerd, maar deployment URL niet gevonden in output.');
        }
        outputs.deploymentUrl = deploymentUrl;
        steps.push({
          id: 'vercel',
          label: 'Vercel deploy',
          status: 'ok',
          message: deploymentUrl,
        });

        if (domainName) {
          const stratoResult = await runStratoAutomationHook({
            domainName,
            projectDir,
            deploymentUrl,
          });
          outputs.domainStatus = stratoResult.status;
          outputs.domainMessage = stratoResult.message || '';
          steps.push({
            id: 'strato',
            label: 'Strato domein',
            status: stratoResult.status === 'ok' ? 'ok' : 'skipped',
            message:
              stratoResult.message ||
              (stratoResult.status === 'ok' ? 'Domeinstap gereed.' : 'Overgeslagen.'),
          });

          try {
            const aliasArgs = [
              '--yes',
              'vercel',
              'alias',
              'set',
              deploymentUrl,
              domainName,
              '--token',
              vercelToken,
            ];
            if (vercelScope) {
              aliasArgs.push('--scope', vercelScope);
            }
            await runCommandWithOutput('npx', aliasArgs, {
              cwd: projectDir,
              timeoutMs: 180000,
              env: {
                HOME: process.env.HOME || osModule.homedir(),
              },
            });
            outputs.domainStatus = 'ok';
            outputs.domainMessage = `Domein alias gezet op ${domainName}`;
            steps.push({
              id: 'vercel_domain_alias',
              label: 'Vercel domein alias',
              status: 'ok',
              message: domainName,
            });
          } catch (error) {
            const message =
              truncateText(normalizeString(error?.stderr || error?.message || ''), 220) ||
              'Alias mislukt.';
            outputs.domainStatus = outputs.domainStatus || 'pending';
            outputs.domainMessage = outputs.domainMessage || message;
            steps.push({
              id: 'vercel_domain_alias',
              label: 'Vercel domein alias',
              status: 'skipped',
              message,
            });
          }
        } else {
          outputs.domainStatus = 'skipped';
          outputs.domainMessage = 'Geen domein opgegeven.';
          steps.push({
            id: 'strato',
            label: 'Strato domein',
            status: 'skipped',
            message: 'Geen domein opgegeven; stap overgeslagen.',
          });
        }

        return {
          ok: true,
          startedAt,
          finishedAt: new Date().toISOString(),
          outputs,
          steps,
        };
      } finally {
        try {
          await fsPromises.rm(projectDir, { recursive: true, force: true });
        } catch (cleanupError) {
          logger.error('[ActiveOrderAutomation][CleanupError]', cleanupError?.message || cleanupError);
        }
      }
    });

  return {
    ensureGitHubRepository,
    fetchGitHubApi,
    parseFirstVercelUrl,
    runActiveOrderLaunchPipeline,
    runCommandWithOutput,
    runStratoAutomationHook,
    upsertGitHubFile,
  };
}

module.exports = {
  createActiveOrderAutomationService,
};
