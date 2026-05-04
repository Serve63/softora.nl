# Operationele Checklist

## Voor een release
- `npm run check:production-deploy-source`
- `npm run verify:critical`
- `npm run backup:runtime`
- `npm run deploy:production`
- `npm run check:live-production-version`
- health endpoints controleren

## Automatische productie
- Elke push/merge naar `main` hoort door Vercel automatisch naar productie te gaan.
- De workflow `Live Production Version` draait daarna `npm run check:live-production-version:wait`.
- Als `www.softora.nl` niet exact op de nieuwste `origin/main` staat, is dat een release-incident en mag er niet worden doorgewerkt alsof productie klopt.

## Dagelijks
- smoke-resultaten bekijken
- security audit events bekijken
- dependency/health-status controleren
- recente regressies of afspraak-desyncs nalopen

## Bij incidenten
- eerst kritieke flow isoleren
- rollback-beslissing nemen op basis van impact
- pas daarna root cause fixen
