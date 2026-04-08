# Softora Repo Map

## Doel
Snelle oriëntatie voor mensen en AI-agents, zodat nieuwe wijzigingen op de juiste plek landen zonder kritieke flows te breken.

## Runtime entrypoints
- [server.js](../server.js): huidige Express runtime en legacy hoofd-entrypoint.
- [server/app.js](../server/app.js): kleine loader voor dezelfde Express app.
- [api/_app-handler.js](../api/_app-handler.js): Vercel bootstrap naar de bestaande Express app.
- [twilio-media-bridge/server.js](../twilio-media-bridge/server.js): losse subservice voor Twilio media streams.

## Hoog-risico domeinen
- Agenda
- Leads
- Call insights / coldcalling
- Auth / premium sessies

Gebruik voor deze domeinen altijd eerst:
- [AGENTS.md](../AGENTS.md)
- [server/routes/manifest.js](../server/routes/manifest.js)
- [docs/rollback-playbook.md](rollback-playbook.md)

## Backend structuur
- [server/routes](../server/routes): route-registratie voor gemigreerde domeinen.
  Agenda, active orders, AI dashboard, AI tools, premium auth, SEO read/write, runtime debug ops, runtime ops, health en premium user-management routes landen hier.
- [server/services](../server/services): businesslogica en coördinatie.
  Active orders, active-order automation, AI dashboard, AI helper/core utilities, AI tools, agenda-read, agenda HTML bootstrap, agenda appointment state/repair/upsert helpers, agenda task-formatting helpers, agenda metadata/summaries/call-source refresh helpers, agenda lead-detail/transcript helpers, agenda interested-lead state/orchestration/read-materialization, agenda lead-follow-up reuse/backfill helpers, agenda post-call/active-order orchestration, agenda confirmation-task orchestration, confirmation mail/IMAP-SMTP infrastructuur, premium auth, premium user-management, runtime backup/debug ops, runtime state sync, runtime Supabase state access, runtime ops, SEO core/read/write, UI state, website-input helpers, website-generation helpers en HTML page-rendering logica zijn al apart ondergebracht.
- [server/schemas](../server/schemas): formele payload-normalisatie en contracts.
- [server/config](../server/config): gedeelde configuratie en feature flags.
- [server/security](../server/security): security-gerichte helpers en guards.
  Premium auth-state, API-gates, sessiehelpers, runtime audit/activity helpers en premium page-authguards zitten hier inmiddels ook opgesplitst.
- [lib](../lib): losse helpers die nog niet onder `server/` zitten.
- [api](../api): serverless/Vercel entrypoints die doorsturen naar de Express app.

## Frontend structuur
- Root `*.html`: huidige pagina’s, inclusief premium en personeelsschermen.
- [assets](../assets): gedeelde frontend JS/CSS en themabestanden.

## Tests en safety net
- [scripts/verify-critical.js](../scripts/verify-critical.js): draait de minimale kritieke verificatieset.
- [test/contracts](../test/contracts): API- en schema-contracten.
- [test/smoke](../test/smoke): pagina-smokechecks.
- [.github/workflows/verify-critical.yml](../.github/workflows/verify-critical.yml): CI voor kritieke checks.

## Werkafspraken
- Verander bestaande response-shapes niet stilletjes.
- Voeg geen nieuwe bron van waarheid toe naast database of formele repositories.
- Nieuwe backendlogica niet verder ophopen in `server.js` als het ook in `server/` kan.
- Nieuwe frontendlogica niet inline in HTML als een los assetbestand redelijk is.

## Praktische startpunten
- Nieuwe route of API-fix: begin in [server/routes](../server/routes) en [server/services](../server/services).
- Agenda-wijziging: lees eerst [docs/domains/agenda.md](domains/agenda.md).
- Lead- of call-data wijziging: lees eerst [docs/domains/leads.md](domains/leads.md).
- Release of risicovolle deploy: volg [docs/operations-checklist.md](operations-checklist.md) en [docs/rollback-playbook.md](rollback-playbook.md).
