function primeServerAppRuntime({
  ensureRuntimeStateHydratedFromSupabase,
}) {
  void ensureRuntimeStateHydratedFromSupabase();
}

function startServerAppRuntime({
  app,
  port,
  getColdcallingProvider,
  getMissingEnvVars,
  isSupabaseConfigured,
  supabaseStateTable,
  supabaseStateKey,
  ensureRuntimeStateHydratedFromSupabase,
  log = console.log,
  warn = console.warn,
}) {
  primeServerAppRuntime({
    ensureRuntimeStateHydratedFromSupabase,
  });

  app.listen(port, () => {
    const provider = getColdcallingProvider();
    log(`Softora coldcalling backend draait op http://localhost:${port} (provider: ${provider})`);
    const missingEnv = getMissingEnvVars(provider);
    if (missingEnv.length > 0) {
      warn(
        `[Startup] Let op: ontbrekende env vars voor ${provider} (${missingEnv.join(', ')}). /api/coldcalling/start zal falen totdat deze zijn ingevuld.`
      );
    }
    if (isSupabaseConfigured()) {
      log(
        `[Startup] Supabase state persistence actief (${supabaseStateTable}:${supabaseStateKey}).`
      );
    } else {
      log(
        '[Startup] Supabase state persistence uit (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ontbreken).'
      );
    }
  });
}

module.exports = {
  primeServerAppRuntime,
  startServerAppRuntime,
};
