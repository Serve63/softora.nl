# Softora Architectuur Baseline

## Huidige richting
- Bestaande routes en schermen blijven compatibel.
- De codebase wordt gefaseerd opgesplitst zonder full rewrite.
- `server.js` blijft een klein entrypoint, terwijl de app-compositie landt onder `server/services/server-app-runtime*.js`.

## Doelstructuur
- `server/routes/` voor route-registratie
- `server/services/` voor businesslogica
- `server/repositories/` voor data-toegang
- `server/security/` voor auth, rate limits, CSRF en webhook-validatie
- `server/schemas/` voor formele request/response contracts
- `assets/pages/` voor paginalogica buiten HTML

## Niet-breekbare flows
Zie [server/routes/manifest.js](../server/routes/manifest.js).

## Navigatie
- Start oriëntatie in [docs/repo-map.md](repo-map.md).
- Lees voor nieuwe wijzigingen ook [docs/quality-protocol.md](quality-protocol.md).
- Runtime entrypoint blijft [server.js](../server.js).
- Vercel gebruikt [api/_app-handler.js](../api/_app-handler.js) als bootstrap naar dezelfde Express app.

## Werkvolgorde
1. Safety net en rollback
2. Agenda-domein
3. Leads-domein
4. Coldcalling/call insights
5. Mailbox, SEO, klanten
