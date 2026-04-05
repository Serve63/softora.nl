# Operationele Checklist

## Voor een release
- `npm run verify:critical`
- `npm run backup:runtime`
- health endpoints controleren

## Dagelijks
- smoke-resultaten bekijken
- security audit events bekijken
- dependency/health-status controleren
- recente regressies of afspraak-desyncs nalopen

## Bij incidenten
- eerst kritieke flow isoleren
- rollback-beslissing nemen op basis van impact
- pas daarna root cause fixen
