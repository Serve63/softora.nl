# Softora Architectuur Baseline

## Huidige richting
- Bestaande routes en schermen blijven compatibel.
- De codebase wordt gefaseerd opgesplitst zonder full rewrite.
- `server.js` blijft tijdelijk legacy entrypoint, maar nieuwe structuur landt onder `server/`.

## Doelstructuur
- `server/routes/` voor route-registratie
- `server/services/` voor businesslogica
- `server/repositories/` voor data-toegang
- `server/security/` voor auth, rate limits, CSRF en webhook-validatie
- `server/schemas/` voor formele request/response contracts
- `assets/pages/` voor paginalogica buiten HTML

## Niet-breekbare flows
Zie [server/routes/manifest.js](/Users/servecreusen/softora.nl-12/server/routes/manifest.js).

## Werkvolgorde
1. Safety net en rollback
2. Agenda-domein
3. Leads-domein
4. Coldcalling/call insights
5. Mailbox, SEO, klanten
