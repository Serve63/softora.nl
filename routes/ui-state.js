'use strict';

/**
 * routes/ui-state.js — UI state get/set endpoints.
 * Alle business logic functies komen via ctx uit server.js.
 */

module.exports = function registerUiStateRoutes(app, ctx) {
  const {
    normalizeString,
    normalizeUiStateScope, sanitizeUiStateValues,
    getUiStateValues, setUiStateValues,
  } = ctx;

  async function handleGet(req, res, scopeRaw) {
    const scope = normalizeUiStateScope(scopeRaw);
    if (!scope) return res.status(400).json({ ok: false, error: 'Ongeldige UI state scope' });
    const state = await getUiStateValues(scope);
    if (!state) return res.status(503).json({ ok: false, error: 'Kon UI state niet laden zonder geldige Supabase-opslag.' });
    return res.status(200).json({ ok: true, scope, values: state.values || {}, source: state.source || 'supabase', updatedAt: state.updatedAt || null });
  }

  async function handleSet(req, res, scopeRaw) {
    const scope = normalizeUiStateScope(scopeRaw);
    if (!scope) return res.status(400).json({ ok: false, error: 'Ongeldige UI state scope' });

    const patchProvided = req.body && typeof req.body === 'object' && req.body.patch && typeof req.body.patch === 'object';
    let valuesToSave;

    if (patchProvided) {
      const current = await getUiStateValues(scope);
      if (!current) return res.status(503).json({ ok: false, error: 'Kon UI state patch niet laden zonder geldige Supabase-opslag.' });
      const currentValues = current?.values && typeof current.values === 'object' ? current.values : {};
      const patchValues = sanitizeUiStateValues(req.body.patch);
      valuesToSave = { ...currentValues, ...patchValues };
    } else {
      valuesToSave = sanitizeUiStateValues(req.body?.values || {});
    }

    const state = await setUiStateValues(scope, valuesToSave, {
      source: normalizeString(req.body?.source || 'frontend'),
      actor: normalizeString(req.body?.actor || ''),
    });

    if (!state) return res.status(503).json({ ok: false, error: 'Kon UI state niet opslaan zonder geldige Supabase-opslag.' });
    return res.status(200).json({ ok: true, scope, values: state.values || {}, source: state.source || 'supabase', updatedAt: state.updatedAt || null });
  }

  app.get('/api/ui-state/:scope', async (req, res) => handleGet(req, res, req.params.scope));
  app.get('/api/ui-state-get', async (req, res) => handleGet(req, res, req.query.scope));
  app.post('/api/ui-state/:scope', async (req, res) => handleSet(req, res, req.params.scope));
  app.post('/api/ui-state-set', async (req, res) => handleSet(req, res, req.query.scope));
};
