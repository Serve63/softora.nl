# Softora Quality Protocol

## Doel
Dit protocol houdt de codebase stabiel, veilig en agent-vriendelijk terwijl we gefaseerd opschonen. Continuiteit van de site gaat altijd voor refactor-snelheid of cosmetische netheid.

## Prioriteitsvolgorde
1. Werkende site en rollback-pad behouden.
2. Kritieke contracts en response-shapes stabiel houden.
3. Security en toegangscontrole aanscherpen.
4. Onderhoudbaarheid en logische bestandsindeling verbeteren.
5. Performance optimaliseren zonder gedrag of veiligheid te beschadigen.

## Kernregels
- `server.js` blijft een klein entrypoint en export-layer, geen businesslogica.
- `server/services/server-app-runtime.js` en `server/services/server-app-runtime-*.js` blijven compositie- en wiringlagen, geen nieuwe domeinlogica.
- Nieuwe businesslogica hoort in gerichte `server/services/*` modules met bijbehorende contract- of smoke-tests.
- Nieuwe routes horen in `server/routes/*`, validatie in `server/schemas/*`, beveiligingscontrole in `server/security/*`.
- Root-level HTML mag kleine bootstrap bevatten, maar grotere paginalogica hoort in `assets/*`.
- Database of formele repositories zijn leidend zodra een pad is gemigreerd; voeg geen tweede bron van waarheid toe.

## Hoog-risico workflow
- Lees altijd eerst [AGENTS.md](../AGENTS.md), [docs/repo-map.md](repo-map.md) en [server/routes/manifest.js](../server/routes/manifest.js).
- Maak bij high-risk wijzigingen eerst een runtime-backup.
- Knip refactors op in kleine, omkeerbare stappen met gerichte tests per stap.
- Laat compat-paden of feature flags tijdelijk naast nieuw gedrag bestaan als een domein nog half gemigreerd is.
- Als een kritieke flow wankelt, eerst terug naar de laatst bewezen compatibele staat en dan pas verder verbeteren.

## Verboden vervuiling
- Geen nieuwe businesshelpers in `server.js` of in runtime-compositiebestanden.
- Geen stille response-shape wijzigingen op bestaande routes.
- Geen nieuwe ad-hoc mappen onder `server/`.
- Geen browser-opslag als systeem-van-record voor productiegedrag.
- Geen debug- of adminpaden zonder bestaande auth-, rol- en auditcontroles.

## Security baseline
- Secrets blijven uit tracked files en service-role keys blijven server-side.
- State-changing routes valideren input expliciet en controleren rollen of scopes.
- Debug/admin functionaliteit vereist bestaande premium-auth of admin-guarding en audit-events waar relevant.
- Nieuwe externe webhooks of providerkoppelingen krijgen expliciete verificatie, foutafhandeling en veilige defaults.

## Performance baseline
- Optimaliseer pas na contractstabiliteit en security-checks.
- Vermijd onnodige synchronous hot-path logica in request-handlers als er al gedeelde async helpers bestaan.
- Houd runtime-compositie compact; grote setupblokken moeten naar kleinere modules zodat startup en debugging begrijpelijk blijven.
- Pagina-assets horen gedeeld en cachebaar te zijn zodra inline scripts of styles substantieel worden.

## Definition Of Done
- Productiegedrag krijgt of behoudt contract- of smoke-testdekking.
- `npm run check:guardrails` blijft groen.
- `npm run verify:critical` is groen voor afronding.
- Voor high-risk wijzigingen bestaat een verse rollback-backup.
- Nieuwe code landt op de juiste architectuurplek en maakt bestaande centrale bestanden niet weer zwaarder.

## Handhaving
Dit protocol wordt geborgd via:
- [AGENTS.md](../AGENTS.md)
- [docs/repo-map.md](repo-map.md)
- [docs/architecture.md](architecture.md)
- [scripts/check-agent-guardrails.js](../scripts/check-agent-guardrails.js)
- [server/routes/manifest.js](../server/routes/manifest.js)
