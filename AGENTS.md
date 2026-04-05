# Softora Agent Guardrails

Deze repo is agent-vriendelijk aan het worden, maar nog niet volledig opgesplitst. Werk daarom volgens deze regels:

## Altijd eerst
- Draai `npm run verify:critical` voor je afrondt.
- Gebruik [server/routes/manifest.js](/Users/servecreusen/softora.nl-12/server/routes/manifest.js) als lijst van kritieke flows.
- Behandel agenda, leads, call-insights en auth als hoog-risico domeinen.

## Bron van waarheid
- Database en formele repositories zijn leidend zodra een pad is gemigreerd.
- In-memory state in [server.js](/Users/servecreusen/softora.nl-12/server.js) is legacy en mag niet verder worden uitgebouwd als business-truth.
- Voeg geen nieuwe parallelle opslagpaden toe zonder expliciete compat-flag of rollback-pad.

## Wijzigen zonder regressies
- Verander bestaande routes niet zomaar; houd response-shapes stabiel.
- Voeg nieuwe logica bij voorkeur toe via `server/routes`, `server/services`, `server/repositories`, `server/security`, `server/schemas`.
- Nieuwe frontendlogica hoort uiteindelijk in losse bestanden, niet in grote inline scripts.

## Rollback
- Voor risicovolle veranderingen: eerst `npm run backup:runtime`.
- Gebruik feature flags of compat-switches voor paden die oud en nieuw gedrag tijdelijk naast elkaar nodig hebben.
- Als een kritieke flow faalt, eerst terug naar de laatst werkende compatibele staat en daarna pas verder debuggen.

## Security
- Secrets nooit in tracked files.
- Service-role keys alleen server-side.
- State-changing routes moeten uiteindelijk via expliciete validatie en role checks lopen.
- Nieuwe debug of admin routes altijd achter bestaande admin/debug toegang.
