const crypto = require('node:crypto');
const { SEARCHER_INSTRUCTIONS, CONTROLLER_INSTRUCTIONS } = require('./kvk-luna-searcher-prompt');

const TABLE = 'softora_kvk_api_budget';
const MODEL = 'gpt-6.1-sol';
// All workers run through Codex on the local ChatGPT subscription; the paid API is not used.
const MODEL_LABEL = 'Searcher: Codex Sol 6.1 xhigh · Controleur: Codex Sol 6.1 xhigh';
const ROLE_MODELS = {
  searcher: { model: MODEL, modelLabel: 'Codex Sol 6.1 xhigh', reasoningEffort: 'xhigh' },
  controller: { model: MODEL, modelLabel: 'Codex Sol 6.1 xhigh', reasoningEffort: 'xhigh' },
};
const STALE_MS = 120000;
const ROLES = new Set(['searcher', 'controller', 'robot']);

function validationBlocked(message) {
  return /^Herstel nodig:/.test(message)
    || (/^Gestopt:/.test(message) && /na \d+ (?:nieuwe Codex-pogingen|herstelpogingen)/.test(message));
}

function createKvkApiWorkersService(deps = {}) {
  const getSupabaseClient = deps.getSupabaseClient || (() => null);
  const now = deps.now || (() => new Date());
  const validTokens = [deps.kvkDatabaseSyncToken, deps.fallbackSyncToken].filter(Boolean);
  const identityJudge = deps.identityJudge || null;

  function tokenAllowed(req) {
    const submitted = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    return validTokens.some((expected) => {
      const a = Buffer.from(submitted);
      const b = Buffer.from(String(expected));
      return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
    });
  }

  function client() {
    const value = getSupabaseClient({ timeoutMs: 30000, ignoreFailureCooldown: true });
    if (!value) throw Object.assign(new Error('Werkerstatus niet beschikbaar.'), { status: 503 });
    return value;
  }

  async function readRow() {
    const { data, error } = await client().from(TABLE).select('*').eq('id', true).single();
    if (error || !data) throw Object.assign(new Error('KVK-werkerstatus ontbreekt of is onbereikbaar.'), { status: 503 });
    return data;
  }

  function isLive(row, role) {
    const requested = Date.parse(row[`${role}_requested_at`] || '');
    const heartbeat = Date.parse(row[`${role}_heartbeat_at`] || '');
    return row[`${role}_enabled`] === true && Number.isFinite(requested)
      && Number.isFinite(heartbeat) && heartbeat >= requested
      && now().getTime() - heartbeat <= STALE_MS;
  }

  function publicState(row) {
    return {
      model: MODEL,
      modelLabel: MODEL_LABEL,
      reasoningEffort: 'xhigh',
      maxWorkersPerRole: 10,
      workers: Object.fromEntries([...ROLES].map((role) => [role, {
        ...ROLE_MODELS[role],
        enabled: row[`${role}_enabled`] === true,
        count: Number(row[`${role}_count`] || 1),
        active: isLive(row, role) && !validationBlocked(String(row[`${role}_message`] || '')),
        blocked: validationBlocked(String(row[`${role}_message`] || '')),
        heartbeatAt: row[`${role}_heartbeat_at`] || null,
        message: String(row[`${role}_message`] || '').slice(0, 1200),
        currentBatch: String(row[`${role}_batch`] || '').slice(0, 100),
      }])),
    };
  }

  async function handle(res, action) {
    try { return await action(); }
    catch (error) { return res.status(error.status || 503).json({ ok: false, error: error.message || 'KVK-werkers niet beschikbaar.' }); }
  }

  async function getStatus(_req, res) {
    return handle(res, async () => res.json({ ok: true, state: publicState(await readRow()) }));
  }

  async function setEnabled(req, res) {
    return handle(res, async () => {
      const body = req.body || {};
      const requested = {};
      if (ROLES.has(body.role)) {
        if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
          return res.status(400).json({ ok: false, error: 'Ongeldige aan/uit-instelling.' });
        }
        if (body.role === 'robot' && body.count !== undefined) return res.status(400).json({ ok: false, error: 'Robot v5 draait als een vaste werker.' });
        if (body.count !== undefined && (!Number.isInteger(body.count) || body.count < 1 || body.count > 10)) {
          return res.status(400).json({ ok: false, error: 'Kies een aantal van 1 tot en met 10.' });
        }
        if (body.enabled === undefined && body.count === undefined) {
          return res.status(400).json({ ok: false, error: 'Kies een aantal of zet de werkers aan/uit.' });
        }
        requested[body.role] = { enabled: body.enabled, count: body.count };
      } else if (typeof body.searcherEnabled === 'boolean' && typeof body.controllerEnabled === 'boolean') {
        // Compatibility for an already open dashboard from before the count selector.
        requested.searcher = { enabled: body.searcherEnabled };
        requested.controller = { enabled: body.controllerEnabled };
      } else {
        return res.status(400).json({ ok: false, error: 'Ongeldige werkrol of instelling.' });
      }
      const row = await readRow();
      const changes = {};
      for (const [role, value] of Object.entries(requested)) {
        if (value.count !== undefined) changes[`${role}_count`] = value.count;
        if (value.enabled !== undefined) {
          changes[`${role}_enabled`] = value.enabled;
          changes[`${role}_requested_at`] = value.enabled && !row[`${role}_enabled`] ? now().toISOString() : row[`${role}_requested_at`];
          changes[`${role}_message`] = value.enabled ? 'Start aangevraagd; wacht op lokale werker.' : 'Uitgezet via dashboard.';
        }
      }
      const { error } = await client().from(TABLE).update(changes).eq('id', true);
      if (error) throw error;
      return res.json({ ok: true, state: publicState(await readRow()) });
    });
  }

  async function poll(req, res) {
    if (!tokenAllowed(req)) return res.status(401).json({ ok: false, error: 'Ongeldig worker-token.' });
    // The local Codex workers always run the instructions that ship with this server.
    return handle(res, async () => {
      const state = publicState(await readRow());
      // Keep the user's switch separate from permission to run more model work.
      // Existing workers already wait when enabled=false in their polling view.
      for (const worker of Object.values(state.workers)) {
        if (worker.blocked) worker.enabled = false;
      }
      return res.json({ ok: true, state,
        searcherInstructions: SEARCHER_INSTRUCTIONS, controllerInstructions: CONTROLLER_INSTRUCTIONS });
    });
  }

  async function report(req, res) {
    if (!tokenAllowed(req)) return res.status(401).json({ ok: false, error: 'Ongeldig worker-token.' });
    return handle(res, async () => {
      const role = String(req.body?.role || '');
      if (!ROLES.has(role)) return res.status(400).json({ ok: false, error: 'Ongeldige werkrol.' });
      const message = String(req.body?.message || '').slice(0, 1200);
      const blocked = req.body?.halt === true && validationBlocked(message);
      const update = {
        [`${role}_heartbeat_at`]: now().toISOString(),
        [`${role}_message`]: blocked ? message.replace(/^Gestopt:/, 'Herstel nodig:').slice(0, 1200) : message,
        [`${role}_batch`]: String(req.body?.currentBatch || '').slice(0, 100),
      };
      if (req.body?.halt === true && !blocked) update[`${role}_enabled`] = false;
      const { error } = await client().from(TABLE).update(update).eq('id', true);
      if (error) throw error;
      return res.json({ ok: true });
    });
  }

  // The Robot's only model route: one fixed-answer identity question per undecided company.
  async function judgeIdentity(req, res) {
    if (!tokenAllowed(req)) return res.status(401).json({ ok: false, error: 'Ongeldig worker-token.' });
    if (!identityJudge) return res.status(503).json({ ok: false, error: 'Beoordelingsmodel niet geconfigureerd.' });
    try {
      const result = await identityJudge.judge(req.body);
      return res.status(result.status).json(result.body);
    } catch (_error) {
      return res.status(502).json({ ok: false, error: 'Beoordelingsmodel niet bereikbaar.' });
    }
  }

  // Kept so an old local worker gets a clear answer instead of a paid request.
  async function research(req, res) {
    if (!tokenAllowed(req)) return res.status(401).json({ ok: false, error: 'Ongeldig worker-token.' });
    return res.status(410).json({ ok: false, error: 'De betaalde API is uitgeschakeld; werk de lokale werker bij naar Codex.' });
  }

  return { getStatus, setEnabled, poll, report, research, judgeIdentity };
}

module.exports = { createKvkApiWorkersService };
