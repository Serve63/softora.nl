# Softora Agent Guardrails

Deze repo is agent-vriendelijk aan het worden, maar nog niet volledig opgesplitst. Werk daarom volgens deze regels:

## Altijd eerst
- Draai `npm run verify:critical` voor je afrondt.
- Draai bij wijzigingen in `server.js`, `server/routes`, `server/security`, `agenda`, `auth`, `leads` of `coldcalling` eerst `npm run backup:runtime`.
- Gebruik [server/routes/manifest.js](server/routes/manifest.js) als lijst van kritieke flows.
- Behandel agenda, leads, call-insights en auth als hoog-risico domeinen.
- Laat `npm run check:guardrails` groen blijven; die check draait ook mee in `verify:critical`.

## Bron van waarheid
- Database en formele repositories zijn leidend zodra een pad is gemigreerd.
- In-memory state in [server.js](server.js) is legacy en mag niet verder worden uitgebouwd als business-truth.
- Voeg geen nieuwe parallelle opslagpaden toe zonder expliciete compat-flag of rollback-pad.

## Wijzigen zonder regressies
- Verander bestaande routes niet zomaar; houd response-shapes stabiel.
- Voeg nieuwe logica bij voorkeur toe via `server/routes`, `server/services`, `server/repositories`, `server/security`, `server/schemas`.
- Nieuwe frontendlogica hoort uiteindelijk in losse bestanden, niet in grote inline scripts.
- Nieuwe businesshelpers horen niet meer in [server.js](server.js); houd dat bestand zoveel mogelijk wiring-only.
- Nieuwe servercode hoort niet in nieuwe ad-hoc mappen onder `server/`; gebruik de bestaande architectuurmappen.
- Productiecodewijzigingen horen samen te gaan met contract- of smoke-testupdates.

## Rollback
- Voor risicovolle veranderingen: eerst `npm run backup:runtime`.
- Gebruik feature flags of compat-switches voor paden die oud en nieuw gedrag tijdelijk naast elkaar nodig hebben.
- Als een kritieke flow faalt, eerst terug naar de laatst werkende compatibele staat en daarna pas verder debuggen.
- Alleen bij een bewuste uitzondering mag je guardrails tijdelijk overrulen via env flags zoals `SKIP_RUNTIME_BACKUP_CHECK=1` of `ALLOW_SERVER_JS_GROWTH=1`, en noteer dan waarom.

## Security
- Secrets nooit in tracked files.
- Service-role keys alleen server-side.
- State-changing routes moeten uiteindelijk via expliciete validatie en role checks lopen.
- Nieuwe debug of admin routes altijd achter bestaande admin/debug toegang.
