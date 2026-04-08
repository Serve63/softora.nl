# Security Baseline

## Doel
Zakelijk sterke beveiliging zonder de bestaande site te breken.

## Reeds aanwezig
- `helmet`
- rate limiting
- same-origin bescherming voor API-mutaties
- Fetch Metadata en content-type guards voor state-changing API-calls
- premium sessiecookies
- MFA-haakjes

## Verplicht vanaf nu
- Geen secrets in tracked files
- Service-role keys alleen server-side
- Kritieke mutaties krijgen audit logging
- Debug-routes blijven admin/debug-only
- Voor risicovolle routes: inputvalidatie voor verdere uitbreidingen

## Operationele checks
- `npm run check:secrets`
- `npm run verify:critical`
- `npm run backup:runtime` voor risicovolle deploys

## Roadmap
- RLS review op relevante Supabase-tabellen
- Strengere CSP zonder inline scripts
- Expliciete role-based middleware per routegroep
- CSRF hardening op sessie-authenticated mutaties
