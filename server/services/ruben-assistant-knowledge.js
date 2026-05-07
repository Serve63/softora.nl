const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_CACHE_TTL_MS = 60 * 1000;
const MAX_FILE_BYTES = 350 * 1024;
const QUESTION_STOPWORDS = new Set([
  'aan',
  'als',
  'bij',
  'dat',
  'deze',
  'dit',
  'een',
  'het',
  'hoe',
  'kan',
  'met',
  'niet',
  'naar',
  'nog',
  'ook',
  'op',
  'over',
  'premium',
  'softora',
  'van',
  'voor',
  'waar',
  'wat',
  'werkt',
  'wil',
  'zijn',
]);

const EXCLUDED_DIRS = new Set([
  '.git',
  '.next',
  '.vercel',
  'backups',
  'coverage',
  'dist',
  'node_modules',
]);

const SENSITIVE_FILE_RE = /(^|\/)(\.env(?:$|\.(?!example$))|.*\.(pem|key|crt|p12|pfx)$)/i;
const SECRET_KEY_RE =
  /\b([A-Z0-9_]*(?:API|ADMIN|ANTHROPIC|AUTH|DATABASE|IMAP|JWT|KEY|OPENAI|PASSWORD|RETELL|SECRET|SERVICE|SMTP|STRATO|SUPABASE|TOKEN)[A-Z0-9_]*)\s*([:=])\s*(['"]?)([^\s'",`]+)\3/gi;
const SECRET_VALUE_RE =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|pat_[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g;

function normalizeString(value) {
  return String(value || '').trim();
}

function truncateText(value, maxLength = 500) {
  const text = normalizeString(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function toPosixPath(value) {
  return normalizeString(value).replace(/\\/g, '/');
}

function redactSensitiveText(value) {
  return String(value || '')
    .replace(SECRET_KEY_RE, '$1$2$3[redacted]$3')
    .replace(SECRET_VALUE_RE, '[redacted]');
}

function stripHtml(value) {
  return redactSensitiveText(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMatches(value, pattern, limit = 20) {
  const out = [];
  const text = String(value || '');
  let match;
  while ((match = pattern.exec(text)) && out.length < limit) {
    const raw = normalizeString(match[1] || match[2] || '');
    if (raw && !out.includes(raw)) out.push(raw);
  }
  return out;
}

function routeFromPremiumPage(relativePath) {
  const basename = path.basename(relativePath, '.html');
  if (basename === 'index') return '/';
  return `/${basename}`;
}

function pageLabelFromRoute(route) {
  return normalizeString(route)
    .replace(/^\//, '')
    .replace(/^premium-/, '')
    .replace(/-/g, ' ') || 'home';
}

function tokenize(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, ' ')
    .split(/[^a-z0-9À-ÿ]+/i)
    .filter((token) => token.length >= 3 && !QUESTION_STOPWORDS.has(token))
    .slice(0, 80);
}

function scoreItemForQuestion(item, question) {
  const questionTokens = tokenize(question);
  if (!questionTokens.length) return 0;

  const primary = [item.type, item.file, item.route, item.title].join(' ').toLowerCase();
  const secondary = [
    Array.isArray(item.headings) ? item.headings.join(' ') : '',
    Array.isArray(item.routes) ? item.routes.join(' ') : '',
    Array.isArray(item.scripts) ? item.scripts.join(' ') : '',
    Array.isArray(item.functions) ? item.functions.join(' ') : '',
    Array.isArray(item.factories) ? item.factories.join(' ') : '',
    Array.isArray(item.exports) ? item.exports.join(' ') : '',
  ]
    .join(' ')
    .toLowerCase();
  const summary = normalizeString(item.summary).toLowerCase();

  return questionTokens.reduce((score, token) => {
    if (primary.includes(token)) return score + 3;
    if (secondary.includes(token)) return score + 2;
    if (summary.includes(token)) return score + 0.5;
    return score;
  }, 0);
}

function isAllowedCandidate(relativePath) {
  const file = toPosixPath(relativePath);
  if (!file || SENSITIVE_FILE_RE.test(file)) return false;
  if (file.startsWith('premium-') && file.endsWith('.html')) return true;
  if (file.startsWith('assets/') && file.endsWith('.js')) return true;
  if (file.startsWith('server/routes/') && file.endsWith('.js')) return true;
  if (file.startsWith('server/services/') && file.endsWith('.js')) return true;
  if (file.startsWith('docs/') && file.endsWith('.md')) return true;
  return [
    '.env.example',
    'AGENTS.md',
    'package.json',
    'render.yaml',
    'server/routes/manifest.js',
    'vercel.json',
  ].includes(file);
}

async function walkFiles(root, dir = '') {
  const absoluteDir = path.join(root, dir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      files.push(...(await walkFiles(root, path.join(dir, entry.name))));
      continue;
    }
    if (!entry.isFile()) continue;
    const relativePath = toPosixPath(path.join(dir, entry.name));
    if (isAllowedCandidate(relativePath)) files.push(relativePath);
  }

  return files;
}

async function readTextFileSafe(root, relativePath) {
  const safeRelativePath = toPosixPath(relativePath);
  if (!isAllowedCandidate(safeRelativePath)) return '';
  if (SENSITIVE_FILE_RE.test(safeRelativePath)) return '';

  const absolutePath = path.resolve(root, safeRelativePath);
  if (!absolutePath.startsWith(path.resolve(root) + path.sep)) return '';

  const stat = await fs.stat(absolutePath);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return '';

  return redactSensitiveText(await fs.readFile(absolutePath, 'utf8'));
}

function buildPageItem(relativePath, source) {
  const title =
    extractMatches(source, /<title[^>]*>([\s\S]*?)<\/title>/gi, 1)[0] ||
    extractMatches(source, /<h1[^>]*>([\s\S]*?)<\/h1>/gi, 1)[0] ||
    pageLabelFromRoute(routeFromPremiumPage(relativePath));
  const headings = extractMatches(source, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi, 16).map(stripHtml);
  const scripts = extractMatches(source, /<script[^>]+src=["']([^"']+)["']/gi, 30)
    .map((script) => toPosixPath(script).replace(/^\//, ''))
    .filter(Boolean);

  return {
    type: 'page',
    file: relativePath,
    route: routeFromPremiumPage(relativePath),
    title: truncateText(stripHtml(title), 120),
    headings: headings.map((item) => truncateText(item, 120)).filter(Boolean),
    scripts,
    summary: truncateText(stripHtml(source), 900),
  };
}

function buildRouteItem(relativePath, source) {
  const routes = [];
  const routeRe = /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;
  let match;
  while ((match = routeRe.exec(source))) {
    routes.push(`${String(match[1] || '').toUpperCase()} ${match[2]}`);
  }

  return {
    type: 'backend-route',
    file: relativePath,
    routes: Array.from(new Set(routes)).slice(0, 40),
    summary: truncateText(stripHtml(source), 700),
  };
}

function buildServiceItem(relativePath, source) {
  const factories = extractMatches(source, /function\s+(create[A-Z][A-Za-z0-9_]+)/g, 12);
  const exportsBlock = source.match(/module\.exports\s*=\s*\{([\s\S]*?)\}/m);
  const exports = exportsBlock
    ? exportsBlock[1]
        .split(/[,\n]/)
        .map((item) => normalizeString(item).replace(/:.+$/, ''))
        .filter(Boolean)
        .slice(0, 16)
    : [];

  return {
    type: 'backend-service',
    file: relativePath,
    factories,
    exports,
    summary: truncateText(stripHtml(source), 650),
  };
}

function buildAssetItem(relativePath, source) {
  const functions = [
    ...extractMatches(source, /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g, 14),
    ...extractMatches(source, /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(/g, 8),
  ];
  return {
    type: 'frontend-asset',
    file: relativePath,
    functions: Array.from(new Set(functions)).slice(0, 18),
    summary: truncateText(stripHtml(source), 650),
  };
}

function buildDocItem(relativePath, source) {
  const headings = extractMatches(source, /^#{1,3}\s+(.+)$/gm, 20);
  return {
    type: 'doc',
    file: relativePath,
    title: truncateText(headings[0] || relativePath, 140),
    headings: headings.slice(0, 12).map((item) => truncateText(item, 140)),
    summary: truncateText(stripHtml(source), 800),
  };
}

function buildConfigItem(relativePath, source) {
  if (relativePath === 'package.json') {
    try {
      const parsed = JSON.parse(source);
      return {
        type: 'config',
        file: relativePath,
        title: parsed.name || 'package.json',
        scripts: Object.keys(parsed.scripts || {}),
        dependencies: Object.keys(parsed.dependencies || {}),
        summary: truncateText(parsed.description || '', 240),
      };
    } catch {
      return null;
    }
  }

  return {
    type: 'config',
    file: relativePath,
    title: relativePath,
    summary: truncateText(stripHtml(source), relativePath === '.env.example' ? 420 : 700),
  };
}

function buildKnowledgeItem(relativePath, source) {
  if (!source) return null;
  if (relativePath.startsWith('premium-') && relativePath.endsWith('.html')) {
    return buildPageItem(relativePath, source);
  }
  if (relativePath.startsWith('server/routes/') && relativePath.endsWith('.js')) {
    return buildRouteItem(relativePath, source);
  }
  if (relativePath.startsWith('server/services/') && relativePath.endsWith('.js')) {
    return buildServiceItem(relativePath, source);
  }
  if (relativePath.startsWith('assets/') && relativePath.endsWith('.js')) {
    return buildAssetItem(relativePath, source);
  }
  if (relativePath.startsWith('docs/') && relativePath.endsWith('.md')) {
    return buildDocItem(relativePath, source);
  }
  return buildConfigItem(relativePath, source);
}

function buildCoverage(items) {
  return items.reduce(
    (coverage, item) => {
      coverage.total += 1;
      coverage[item.type] = (coverage[item.type] || 0) + 1;
      return coverage;
    },
    { total: 0 }
  );
}

function summarizePages(items) {
  return items
    .filter((item) => item.type === 'page')
    .map((item) => ({
      route: item.route,
      title: item.title,
      file: item.file,
      scripts: item.scripts.slice(0, 8),
    }))
    .sort((a, b) => a.route.localeCompare(b.route))
    .slice(0, 80);
}

function createRubenAssistantKnowledge(deps = {}) {
  const {
    repoRoot = DEFAULT_REPO_ROOT,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    now = () => Date.now(),
    logger = console,
  } = deps;

  let cachedIndex = null;
  let cachedAt = 0;

  async function buildIndex() {
    const root = path.resolve(repoRoot);
    const files = await walkFiles(root);
    const items = [];

    for (const relativePath of files) {
      try {
        const source = await readTextFileSafe(root, relativePath);
        const item = buildKnowledgeItem(relativePath, source);
        if (item) items.push(item);
      } catch (error) {
        logger?.warn?.('[ruben-assistant-knowledge] skipped file', {
          file: relativePath,
          error: String(error?.message || error),
        });
      }
    }

    return {
      generatedAt: new Date(now()).toISOString(),
      repoRootName: path.basename(root),
      items,
      coverage: buildCoverage(items),
      pages: summarizePages(items),
    };
  }

  async function getIndex() {
    const currentTime = now();
    if (cachedIndex && currentTime - cachedAt < cacheTtlMs) return cachedIndex;
    cachedIndex = await buildIndex();
    cachedAt = currentTime;
    return cachedIndex;
  }

  async function buildKnowledgeContext(options = {}) {
    const question = normalizeString(options.question || '');
    const maxRelevantItems = Math.max(4, Math.min(24, Number(options.maxRelevantItems) || 14));
    const index = await getIndex();

    const scored = index.items
      .map((item) => ({
        item,
        score: scoreItemForQuestion(item, question),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.item.file || '').localeCompare(String(b.item.file || ''));
      });

    const relevantItems = scored
      .filter((entry) => entry.score >= 1.5)
      .slice(0, maxRelevantItems)
      .map((entry) => ({
        ...entry.item,
        relevanceScore: entry.score,
      }));

    const fallbackItems = relevantItems.length
      ? []
      : scored
          .filter((entry) => ['doc', 'backend-route', 'config'].includes(entry.item.type))
          .slice(0, 8)
          .map((entry) => ({ ...entry.item, relevanceScore: 0 }));

    return {
      generatedAt: index.generatedAt,
      source: 'repo-readonly-index',
      accessMode: 'read-only',
      cacheTtlMs,
      coverage: index.coverage,
      pages: index.pages,
      relevantItems: relevantItems.length ? relevantItems : fallbackItems,
      runtime: {
        branch:
          normalizeString(process.env.VERCEL_GIT_COMMIT_REF || process.env.RENDER_GIT_BRANCH) || null,
        commit:
          normalizeString(process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT) || null,
      },
      limitations: [
        'Deze kennislaag leest alleen bestanden en runtime-context; hij past niets aan.',
        'Geheime waarden en lokale .env-bestanden worden niet gelezen of worden geredact.',
        'Database-inhoud komt alleen mee via bestaande veilige servercontext, niet via directe write-toegang.',
      ],
    };
  }

  return {
    buildKnowledgeContext,
    getIndex,
    redactSensitiveText,
  };
}

module.exports = {
  createRubenAssistantKnowledge,
  redactSensitiveText,
};
