let appHandler = null;
let bootError = null;

try {
  const loaded = require('../server');
  appHandler = loaded && loaded.app;
  if (typeof appHandler !== 'function') {
    throw new Error('Express app export niet gevonden in server.js');
  }
} catch (error) {
  bootError = error;
  console.error('[Vercel][BootstrapError]', error);
}

module.exports = (req, res) => {
  if (bootError || typeof appHandler !== 'function') {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        ok: false,
        error: 'Vercel bootstrap fout',
        detail: process.env.NODE_ENV === 'development' ? String(bootError?.message || '') : undefined,
      })
    );
    return;
  }

  try {
    return appHandler(req, res);
  } catch (error) {
    console.error('[Vercel][HandlerError]', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: 'Interne serverfout' }));
      return;
    }
    throw error;
  }
};
