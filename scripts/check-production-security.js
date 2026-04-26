#!/usr/bin/env node
const { loadRuntimeEnv } = require('../server/config/runtime-env');
const { createRuntimeHelpers } = require('../server/services/runtime-helpers');

function normalizeString(value) {
  return String(value || '').trim();
}

function isEnabledFlag(value) {
  return /^(1|true|yes)$/i.test(normalizeString(value));
}

function hasEnvValue(env, name) {
  return Boolean(normalizeString(env?.[name]));
}

function hasAnyEnvValue(env, names) {
  return names.some((name) => hasEnvValue(env, name));
}

function isHttpsUrl(value) {
  try {
    return new URL(normalizeString(value)).protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

function shouldRunProductionSecurityCheck(env = process.env) {
  const runtimeEnv = loadRuntimeEnv(env);
  return runtimeEnv.app.isProduction || isEnabledFlag(env.CHECK_PRODUCTION_SECURITY);
}

function collectProductionSecurityFindings(env = process.env) {
  const runtimeEnv = loadRuntimeEnv(env);
  const helpers = createRuntimeHelpers({ env });
  const forced = isEnabledFlag(env.CHECK_PRODUCTION_SECURITY);
  const skipped = !runtimeEnv.app.isProduction && !forced;
  const violations = [];
  const warnings = [];

  if (skipped) {
    return {
      forced,
      skipped,
      provider: helpers.getColdcallingProvider(),
      violations,
      warnings,
    };
  }

  if (!isHttpsUrl(runtimeEnv.app.publicBaseUrl)) {
    violations.push('PUBLIC_BASE_URL or APP_BASE_URL must be set to an https URL.');
  }

  if (!runtimeEnv.supabase.url || !runtimeEnv.supabase.serviceRoleKey) {
    violations.push('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }

  const sessionSecret = runtimeEnv.premiumAuth.sessionSecret;
  if (!sessionSecret) {
    violations.push('PREMIUM_SESSION_SECRET must be set.');
  } else if (sessionSecret.length < 32) {
    violations.push('PREMIUM_SESSION_SECRET must be at least 32 characters.');
  }

  if (!runtimeEnv.premiumAuth.requireMfa) {
    violations.push('PREMIUM_REQUIRE_MFA must stay enabled for production.');
  }

  const mfaSecret = runtimeEnv.premiumAuth.mfaTotpSecret;
  if (!mfaSecret) {
    violations.push('PREMIUM_MFA_TOTP_SECRET must be set.');
  } else if (mfaSecret.length < 16) {
    violations.push('PREMIUM_MFA_TOTP_SECRET must be at least 16 characters.');
  }

  if (!runtimeEnv.premiumAuth.enforceSameOriginRequests) {
    violations.push('PREMIUM_ENFORCE_SAME_ORIGIN_REQUESTS must stay enabled.');
  }

  if (!runtimeEnv.premiumAuth.adminIpAllowlist) {
    warnings.push('PREMIUM_ADMIN_IP_ALLOWLIST is empty; consider limiting admin access by IP.');
  }

  if (!hasAnyEnvValue(env, ['WEBHOOK_SECRET', 'RETELL_API_KEY'])) {
    violations.push('WEBHOOK_SECRET or RETELL_API_KEY must be set for Retell webhook verification.');
  }

  const provider = helpers.getColdcallingProvider();
  const missingProviderEnv = helpers.getMissingEnvVars(provider);
  missingProviderEnv.forEach((name) => {
    violations.push(`${name} must be set for ${provider} coldcalling.`);
  });

  if (
    provider === 'twilio' &&
    !hasAnyEnvValue(env, ['TWILIO_AUTH_TOKEN', 'TWILIO_WEBHOOK_SECRET'])
  ) {
    violations.push('TWILIO_AUTH_TOKEN or TWILIO_WEBHOOK_SECRET must be set for Twilio webhooks.');
  }

  return {
    forced,
    skipped,
    provider,
    violations,
    warnings,
  };
}

function runCli(env = process.env, logger = console) {
  const findings = collectProductionSecurityFindings(env);
  if (findings.skipped) {
    logger.log('[production-security] Skipped outside production.');
    return 0;
  }

  findings.warnings.forEach((warning) => {
    logger.warn(`[production-security] Warning: ${warning}`);
  });

  if (findings.violations.length > 0) {
    findings.violations.forEach((violation) => {
      logger.error(`[production-security] ${violation}`);
    });
    return 1;
  }

  logger.log(`[production-security] Production security config is complete for ${findings.provider}.`);
  return 0;
}

if (require.main === module) {
  process.exit(runCli());
}

module.exports = {
  collectProductionSecurityFindings,
  runCli,
  shouldRunProductionSecurityCheck,
};
