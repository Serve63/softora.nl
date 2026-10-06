# Softora AI Coldcalling Dashboard

Coldcalling backend + statische dashboardpagina's met stack-routing:
- `Retell AI` stack -> Retell outbound
- `Gemini 3.8 Live` / `Gemini Flash 3.1 Live` / `OpenAI Realtime 1.5` / `Hume Evi 3` -> Twilio outbound + media stream

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
# Voor website image previews:
# WEBSITE_PREVIEW_IMAGE_MODEL=gpt-image-2
# (fallback/alias: OPENAI_IMAGE_MODEL=gpt-image-2)
VERBOSE_CALL_WEBHOOK_LOGS=true

# Twilio routing/security
TWILIO_OUTBOUND_TWIML_URL=https://jouwdomein.nl/api/twilio/voice
TWILIO_STATUS_CALLBACK_URL=https://jouwdomein.nl/api/twilio/status
TWILIO_WEBHOOK_SECRET=your_twilio_webhook_secret
TWILIO_MEDIA_WS_URL=wss://twilio-media-bridge-ln3f.onrender.com/twilio-media
TWILIO_MEDIA_WS_URL_GEMINI_FLASH_3_8_LIVE=wss://example.com/twilio-media
TWILIO_FROM_NUMBER_GEMINI_FLASH_3_8_LIVE=+31xxxxxxxxx
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
AMBIENT_NOISE_LEVEL=0.18
AMBIENT_DUCK_LEVEL=0.08
NOISE_GATE_RMS=250
# Testmodus: alleen ambience, geen Gemini
# AMBIENT_ONLY_MODE=false
# Vrij gelicentieerde callcenteropname met een doorlopende lus van 95 seconden:
AMBIENT_ASSET_PATH=assets/callcenter-dnlburnett-335711-8k.raw
# Eigen raw 8k mono PCM loopbestand kan ook:
# AMBIENT_ASSET_PATH=assets/jouw-office-loop-8k.raw
```

De callcenteropname is "Ambience - Busy office-call center.wav" van [dnlburnett](https://freesound.org/people/dnlburnett/sounds/335711/),
onder [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Bronvermelding en de
bewerkingen staan in `twilio-media-bridge/assets/CALLCENTER-LICENSE.txt`.
De brug laadt de lus eenmaal bij het opstarten en mengt hem uitsluitend in de uitgaande
20 ms telefoonframes; er wordt geen aparte audioprovider aangeroepen. Tijdens het praten
wordt de achtergrond zachter. `AMBIENT_ONLY_MODE` blijft een aparte testschakelaar en mag
pas worden uitgezet wanneer een echt Gemini-/Twilio-gesprek binnen het afgesproken budget valt.

### Gemini 3.8 Live activeren

Kies in de coldcall-generator `Gemini 3.8 Live` (`gemini_flash_3_8_live`).
De officiële Live API-model-ID is `gemini-3.8-live`:
https://ai.google.dev/gemini-api/docs/live-api/get-started-sdk.
Deploy eerst de bijgewerkte `twilio-media-bridge` op de bestaande bridge-host.
De bridge houdt de ingestelde `GEMINI_MODEL` voor bestaande 3.1-campagnes,
maar selecteert `models/gemini-3.8-live` voor een expliciete 3.8-sessie.
De keuze komt uit Twilio `start.customParameters`; setup wacht op dat bericht.
De aparte 3.8-URL en het aparte afzendnummer zijn optioneel; bestaande
Gemini/Twilio-configuratie blijft de fallback. Stel de bestaande bridge-debugtoken
server-side in als `TWILIO_MEDIA_BRIDGE_DEBUG_TOKEN` zodat de setupcontrole mag lopen.
Voor een 3.8-belactie moet de bridge exact `models/gemini-3.8-live` bevestigen;
een oude bridge, verkeerde model-ID of geweigerde setupcontrole blokkeert vóór Twilio belt.
Gebruik geen publieke debugtoken of API-key in frontendbestanden.

Een echte Gemini-sessie of Twilio-belactie kan providerkosten veroorzaken.
Code- en mocktests starten geen externe gesprekken. Activeer echte tests of campagnes
pas na een expliciet afgesproken budget en testnummer; zet geen betaalde fallback aan.
Rollback: kies de bestaande `Gemini 3.1 Live`-optie of stop de campagne.

### Mathijs, de eigen telefonische Softora-assistent

Inkomende gesprekken via `/api/twilio/voice` gaan standaard rechtstreeks naar Gemini 3.8
met het vaste profiel `softora_mathijs`. De eerste woorden zijn
"Hallo, met Mathijs van Softora.nl", gevolgd door een korte AI-introductie en hulpvraag.
De bedrijfskennis en gespreksgrenzen staan in `twilio-media-bridge/assistant-profile.js`.
Dit profiel gebruikt geen eventueel ouder salesprompt uit `GEMINI_SYSTEM_PROMPT`.
Uitgaande campagnes behouden hun ingestelde prompt en openingsbericht.

Mathijs beantwoordt bedrijfs- en algemene supportvragen. Klantdossiers, live opdrachtstatus,
agenda, mailverzending en doorverbinden zijn nog niet gekoppeld. Hij verwijst daarvoor naar
het team zonder te beweren dat hij een afspraak, bericht of terugbelverzoek heeft vastgelegd.
Werk de openbare kennis bij als diensten of contactgegevens wijzigen.

De bestaande webhookverificatie, caller-allowlist en media-token blijven verplicht.
Een expliciet gekozen `stack` blijft ondersteund. Voor de oude testkeuze met toetsen 1, 2 en 3
zet je server-side `TWILIO_INBOUND_PROVIDER_MENU=true`; standaard staat dit menu uit.
Controleer bij aansluiting dat het Twilio-nummer naar deze voice-webhook wijst.
De Google-key blijft uitsluitend als server-side Render-secret staan. Zonder key is Mathijs
niet belklaar. Voer geen echte Google-sessie of beltest uit zonder afgesproken budget;
code- en mocktests doen geen betaalde aanvragen.

Met een ingestelde Google-key vereisen alle debugroutes een `BRIDGE_DEBUG_TOKEN`, ook
wanneer `NODE_ENV` niet is ingesteld. Een eenmalige stemtest kan via deze private toegang met
`POST /debug/mathijs-voice-test`. Deze test is standaard uitgeschakeld. Alleen een expliciet
budget mag aanleiding zijn om `MATHIJS_VOICE_TEST_ENABLED=true` en een ISO-tijdstip als
`MATHIJS_VOICE_TEST_EXPIRES_AT` in te stellen (hooguit 10 minuten vooruit).
Een gedeelde aanvraaglimiet staat hooguit één geautoriseerde aanvraag per tien minuten toe.
De server accepteert daarnaast één test per proces en begrenst de Google-sessie en audio tot 90 seconden.
De test controleert drie gespreksturns en geeft transcripties en WAV-audio terug.
Hij start geen Twilio-belactie; de gewone lijn kan daarbij in ambience-testmodus blijven.
Schakel de test na gebruik uit en verwijder tijdelijke debugcredentials.

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

De lokale Playwright/FFmpeg-worker voor websitevideo's staat beschreven in [docs/company-website-video.md](docs/company-website-video.md).

Open daarna:

- `http://localhost:3000/ai-lead-generator.html`
- `http://localhost:3000/premium-ai-lead-generator` (zelfde coldmailing-UI als `/premium-bevestigingsmails`; het `.html`-bestand `premium-ai-lead-generator.html` is legacy/coldcalling-markup voor tests)

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
