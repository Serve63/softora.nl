# Softora AI Coldcalling Dashboard

Retell-only coldcalling backend + statische dashboardpagina's.

## Stack

- Backend: Node.js + Express (`server.js`)
- Frontend: statische HTML/CSS/JS
- Provider: Retell (outbound + webhook)

## Vereiste env vars

```env
PORT=3000
COLDCALLING_PROVIDER=retell
RETELL_API_KEY=your_retell_api_key
RETELL_FROM_NUMBER=+31xxxxxxxxx
RETELL_AGENT_ID=agent_xxxxxxxxxxxxxxxxx
```

Optioneel:

```env
RETELL_AGENT_VERSION=1
RETELL_API_BASE_URL=https://api.retellai.com
WEBHOOK_SECRET=your_optional_webhook_secret
OPENAI_API_KEY=your_openai_api_key
VERBOSE_CALL_WEBHOOK_LOGS=true
```

## Lokaal starten

```bash
npm install
npm start
```

Open daarna:

- `http://localhost:3000/ai-lead-generator.html`
- `http://localhost:3000/premium-ai-lead-generator.html`

## Webhook instellen in Retell

- Productie: `https://jouwdomein.nl/api/retell/webhook`
- Lokaal via tunnel: `https://<jouw-tunnel-domein>/api/retell/webhook`

De backend ondersteunt zowel:

- Retell signature-validatie via `x-retell-signature`
- optionele extra secret-check via `WEBHOOK_SECRET`

## API routes

- `POST /api/coldcalling/start`
- `GET /api/coldcalling/status?callId=...`
- `GET /api/coldcalling/call-status/:callId`
- `GET /api/coldcalling/call-updates?limit=200&sinceMs=...`
- `POST /api/retell/webhook`
- `GET /healthz`

## Notities

- De `Start Campagne` knop in de dashboardpagina gebruikt `assets/coldcalling-dashboard.js`.
- Calls en call-updates worden in runtime state opgeslagen; optioneel via Supabase persist gemaakt.
- Voor productie: zet secrets alleen in je host-omgeving (niet in frontend of publieke repo).
