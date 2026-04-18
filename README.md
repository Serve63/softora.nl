# Softora AI Coldcalling Dashboard

Coldcalling backend + statische dashboardpagina's met stack-routing:
- `Retell AI` stack -> Retell outbound
- `Gemini Flash 3.1 Live` / `OpenAI Realtime 1.5` / `Hume Evi 3` -> Twilio outbound + media stream

## Stack

- Backend: Node.js + Express (`server.js`)
- Frontend: statische HTML/CSS/JS
- Providers: Retell + Twilio

## Repo wegwijzer

- Start bij [docs/repo-map.md](docs/repo-map.md) voor de snelste oriëntatie.
- Kritieke flows staan in [server/routes/manifest.js](server/routes/manifest.js).
- De huidige runtime start in [server.js](server.js).
- Nieuwe backendlogica hoort bij voorkeur onder `server/routes`, `server/services`, `server/schemas`.
- Agenda, leads, call-insights en auth zijn high-risk domeinen en vragen extra voorzichtigheid.
- Gebruik `npm run check:guardrails` voor snelle architectuur- en AI-workflow checks; die draait ook mee in `npm run verify:critical`.
- Draai bij high-risk wijzigingen eerst `npm run backup:runtime`.

## Vereiste env vars

```env
PORT=3000
COLDCALLING_PROVIDER=retell
PUBLIC_BASE_URL=https://jouwdomein.nl

# Retell
RETELL_API_KEY=your_retell_api_key
RETELL_FROM_NUMBER=+31xxxxxxxxx
RETELL_AGENT_ID=agent_xxxxxxxxxxxxxxxxx

# Twilio (voor Gemini/OpenAI realtime/Hume stacks)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_FROM_NUMBER=+31xxxxxxxxx
```

Optioneel:

```env
RETELL_AGENT_VERSION=1
RETELL_API_BASE_URL=https://api.retellai.com
WEBHOOK_SECRET=your_optional_webhook_secret
OPENAI_API_KEY=your_openai_api_key
VERBOSE_CALL_WEBHOOK_LOGS=true

# Twilio routing/security
TWILIO_OUTBOUND_TWIML_URL=https://jouwdomein.nl/api/twilio/voice
TWILIO_STATUS_CALLBACK_URL=https://jouwdomein.nl/api/twilio/status
TWILIO_WEBHOOK_SECRET=your_twilio_webhook_secret
TWILIO_MEDIA_WS_URL=wss://twilio-media-bridge-ln3f.onrender.com/twilio-media
TWILIO_MEDIA_WS_URL_GEMINI_FLASH_3_1_LIVE=wss://example.com/twilio-media
TWILIO_FROM_NUMBER_GEMINI_FLASH_3_1_LIVE=+31xxxxxxxxx

# Voor Twilio Regions/IE1 (aanbevolen voor NL + Frankfurt)
TWILIO_API_KEY_SID=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY_SECRET=your_twilio_api_key_secret
TWILIO_API_REGION=ie1
TWILIO_API_EDGE=dublin
# alternatief:
# TWILIO_API_BASE_URL=https://api.dublin.ie1.twilio.com

# Office ambience onder Gemini phone calls
AMBIENT_ENABLED=true
AMBIENT_NOISE_LEVEL=0.22
AMBIENT_DUCK_LEVEL=0.10
NOISE_GATE_RMS=250
# Testmodus: alleen ambience, geen Gemini
# AMBIENT_ONLY_MODE=false
# Eigen raw 8k mono PCM loopbestand voor de bridge
# AMBIENT_ASSET_PATH=twilio-media-bridge/assets/office-8k.raw
```

### Extra env vars voor `Voer opdracht uit` automation (Actieve Opdrachten)

Zet deze aan als je bij `Voer opdracht uit` direct alles wilt laten lopen:
- lokale projectmap schrijven
- commit/push naar GitHub
- deploy naar Vercel
- (optioneel) Strato domeinstap

```env
ACTIVE_ORDER_AUTOMATION_ENABLED=true

# GitHub
ACTIVE_ORDER_AUTOMATION_GITHUB_TOKEN=ghp_xxx
ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER=Serve63
ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER_IS_ORG=false
ACTIVE_ORDER_AUTOMATION_GITHUB_PRIVATE=true
ACTIVE_ORDER_AUTOMATION_GITHUB_REPO_PREFIX=softora-case-
ACTIVE_ORDER_AUTOMATION_GITHUB_DEFAULT_BRANCH=main

# Vercel
ACTIVE_ORDER_AUTOMATION_VERCEL_TOKEN=vercel_xxx
ACTIVE_ORDER_AUTOMATION_VERCEL_SCOPE=team_of_user_slug

# Strato (kies er 1):
# 1) command-template ({{domain}}, {{projectDir}}, {{deploymentUrl}})
ACTIVE_ORDER_AUTOMATION_STRATO_COMMAND=
# 2) of webhook endpoint naar eigen Strato-automation service
ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_URL=
ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_TOKEN=
```

Belangrijk:
- zonder `ACTIVE_ORDER_AUTOMATION_ENABLED=true` wordt de launch-stap bewust overgeslagen.
- zonder GitHub/Vercel tokens kan de automation niet publiceren.
- Strato heeft geen directe standaard-flow in deze app; daarom loopt dat via command of webhook-hook.

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
- `POST /api/twilio/voice`
- `POST /api/twilio/status`
- `POST /api/active-orders/launch-site`
- `GET /healthz`

## Notities

- De `Start Campagne` knop in de dashboardpagina gebruikt `assets/coldcalling-dashboard.js`.
- Calls en call-updates worden in de centrale Supabase runtime state opgeslagen.
- Voor productie: zet secrets alleen in je host-omgeving (niet in frontend of publieke repo).
