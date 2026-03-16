# Softora AI Coldcalling Dashboard

Huidige coldcalling-architecturen in deze repo:

- `elevenlabs`:
  native ElevenLabs outbound telephony vanuit `server.js`
- `twilio_conference`:
  Twilio outbound prospect call -> Twilio Conference -> AI participant via Twilio Media Stream bridge -> ElevenLabs WebSocket
  plus een aparte coached ambience participant alleen voor de prospect
- `sip_media_mixer`:
  parallel provider voor externe SIP/media-mixer control plane (bedoeld voor de robuuste ambience-route)

De actieve runtime-provider wordt als volgt gekozen:

- als `COLDCALLING_PROVIDER` expliciet is gezet, volgt de backend die waarde
- anders blijft de backend standaard op `elevenlabs`
- alleen als je `COLDCALLING_ALLOW_IMPLICIT_TWILIO_CONFERENCE=true` zet, mag hij impliciet naar `twilio_conference` schakelen zodra de vereiste Twilio envs aanwezig zijn

Voor maximale stabiliteit in productie:

- zet `COLDCALLING_PROVIDER=elevenlabs`
- laat `COLDCALLING_ALLOW_IMPLICIT_TWILIO_CONFERENCE` uit (of expliciet `false`)

## Twilio Conference + Ambience flow

Als je `COLDCALLING_PROVIDER=twilio_conference` gebruikt, is dit de vereiste setup:

```env
COLDCALLING_PROVIDER=twilio_conference
PUBLIC_BASE_URL=https://jouw-backend.onrender.com
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_OUTBOUND_CALLER_NUMBER=+31xxxxxxxxx
TWILIO_MEDIA_WS_URL=wss://twilio-media-bridge.onrender.com/twilio-media
```

Optioneel:

```env
# Alleen nodig als je een vaste bestaande TwiML App wilt forceren
TWILIO_CONFERENCE_TWIML_APP_SID=APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Alleen nodig als je niet het bundled office audio bestand wilt gebruiken
TWILIO_AMBIENCE_AUDIO_URL=https://jouw-backend.onrender.com/api/twilio/conference/ambience-audio
```

De backend:

- maakt/update automatisch de TwiML App voor AI- en ambience-participants
- start de prospect call
- laat de prospect in een conference joinen
- voegt daarna de AI participant toe via de bestaande Twilio media bridge
- voegt daarna een coached ambience participant toe zodat alleen de prospect het kantoorgeluid hoort

De aparte `twilio-media-bridge-service` heeft zelf wel deze envs nodig:

```env
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_AGENT_ID=your_elevenlabs_agent_id
```

## SIP Media Mixer flow (parallel)

Deze provider is bedoeld voor de route waarbij ambience op media-laag wordt gemixt (buiten deze app).

```env
COLDCALLING_PROVIDER=sip_media_mixer
SIP_MIXER_CONTROL_URL=https://jouw-sip-mixer-control.example.com
SIP_MIXER_CONTROL_API_KEY=your_sip_mixer_control_api_key
SIP_MIXER_PROFILE_ID=default
```

Contract (control API) dat deze backend verwacht:

- `POST /v1/outbound/start`
  - body: lead + campaign + dynamic variables
  - response: `{ callId, status }`
- `GET /v1/outbound/calls/:callId`
  - response: `{ callId, status, endedReason, startedAt, endedAt, durationSeconds, recordingUrl }`

De meegeleverde `sip-mixer-control-service` ondersteunt nu ook `SIP_MIXER_ENGINE_MODE=twilio_stream`:

- start echte Twilio outbound calls
- gebruikt `ALL /v1/twilio/outbound-twiml` met `<Connect><Stream>` naar je media bridge
- verwerkt Twilio statuscallbacks op `POST /v1/twilio/call-status`

Er staat ook een Render blueprint klaar voor deze externe service:

- [render.sip-mixer.yaml](/Users/servecreusen/softora.nl-7/render.sip-mixer.yaml)

## Legacy achtergrond

De oudere Vapi-teksten hieronder beschrijven de oorspronkelijke setup. De code ondersteunt die legacy stukken nog, maar de actieve coldcalling-flow wordt nu gekozen via `COLDCALLING_PROVIDER`.

Deze setup voegt een kleine `Node.js + Express` backend toe aan je bestaande statische dashboard, zodat je frontend veilig via een backend Vapi outbound calls kan starten.

## Wat is toegevoegd

- `server.js`: Express backend met:
  - `POST /api/coldcalling/start`
  - `POST /api/vapi/webhook`
- `assets/coldcalling-vapi.js`: frontend koppeling voor de bestaande `Start Campagne` knop
- `.env.example`: voorbeeldconfig
- `package.json`: dependencies + startscript

## 1) `.env` invullen

Maak een `.env` bestand in de projectroot (zelfde map als `server.js`) en vul in:

```env
PORT=3000
VAPI_API_KEY=your_vapi_private_api_key
VAPI_ASSISTANT_ID=your_assistant_id
VAPI_PHONE_NUMBER_ID=your_phone_number_id
WEBHOOK_SECRET=your_optional_webhook_secret
OPENAI_API_KEY=your_openai_api_key
```

Belangrijk:

- `VAPI_API_KEY` is je private key en blijft alleen op de backend.
- Gebruik deze key nooit in frontend JS/HTML.
- `WEBHOOK_SECRET` is optioneel. De backend checkt dan headers zoals `Authorization` of `x-vapi-secret`.
- `OPENAI_API_KEY` is optioneel. Als gezet, maakt de backend AI-samenvattingen van webhook call updates en probeert afspraken automatisch in de interne agenda-API te zetten.

## 2) Backend starten

Node 18+ is aanbevolen (vanwege built-in `fetch`).

```bash
npm install
npm start
```

De server draait standaard op:

- `http://localhost:3000`

## 3) Frontend lokaal testen

Omdat je frontend nu `fetch('/api/coldcalling/start')` gebruikt, open je de pagina via de Express server (zelfde origin):

- `http://localhost:3000/ai-lead-generator.html`
- of `http://localhost:3000/premium-ai-lead-generator.html`

Wat de frontend nu doet:

- Leest de bestaande UI-velden uit (aantal leads, sector, regio, prijs, korting, instructies)
- Gebruikt de spreadsheet-leadlijst (en alleen als die leeg is: fallback testlead)
- Stuurt alles naar `POST /api/coldcalling/start`
- Toont simpele status in de UI + logregels per lead

## 4) Vapi webhook URL instellen

Stel in Vapi je webhook/server URL in op:

- `https://jouwdomein.nl/api/vapi/webhook`

Voor lokaal testen gebruik je een tunnel (bijv. ngrok / Cloudflare Tunnel) en dan:

- `https://<jouw-tunnel-domein>/api/vapi/webhook`

Als je `WEBHOOK_SECRET` gebruikt:

- configureer dezelfde secret ook in Vapi (bij de webhook/server credential instellingen)

## 4b) Deploy naar Render (aanbevolen)

De repo bevat nu een `render.yaml`, zodat je backend + statische frontend als 1 service kan draaien.

### Render aanmaken

1. Log in op Render en kies `New +` -> `Blueprint`.
2. Koppel je GitHub repo: `Serve63/softora.nl`.
3. Render leest `render.yaml` automatisch in.
4. Vul in Render deze environment variables in (service settings):
   - `VAPI_API_KEY`
   - `VAPI_ASSISTANT_ID`
   - `VAPI_PHONE_NUMBER_ID`
   - `WEBHOOK_SECRET` (zelfde waarde als in Vapi webhook config, optioneel maar aanbevolen)
   - `OPENAI_API_KEY` (optioneel, voor AI-samenvatting + afspraakextractie)
5. Deploy de service.

### Na deploy

- Open je live dashboard via:
  - `https://<jouw-render-service>.onrender.com/ai-lead-generator.html`
- Stel in Vapi webhook URL in op:
  - `https://<jouw-render-service>.onrender.com/api/vapi/webhook`
- Healthcheck (voor controle):
  - `https://<jouw-render-service>.onrender.com/healthz`

Belangrijk:

- Ook al staat er nu lokaal/zelfs in je repo een `.env`, Render gebruikt zijn eigen environment variables.
- Zet je echte secrets altijd in Render service settings (niet vertrouwen op repo-`.env` voor live).
- Rotate je `VAPI_API_KEY` zodra je `.env` per ongeluk of bewust publiek hebt gemaakt.

## 5) API gedrag (backend)

### `POST /api/coldcalling/start`

Verwacht body:

```json
{
  "campaign": {
    "amount": 15,
    "sector": "Zakelijke Dienstverlening",
    "region": "Heel Nederland",
    "minProjectValue": 8000,
    "maxDiscountPct": 5,
    "extraInstructions": "Focus op CTO"
  },
  "leads": [
    { "name": "Jan", "company": "Bedrijf BV", "phone": "0612345678" }
  ]
}
```

De backend:

- zet NL telefoonnummers om naar E.164 (`+31...`)
- start per lead een outbound call via Vapi
- stuurt `assistantId`, `phoneNumberId` en `assistantOverrides.variableValues` mee
- retourneert een JSON response met succes/fout per lead

### `POST /api/vapi/webhook`

Voor nu:

- logt inkomende events (`message.type` + call data)
- bewaart recente events tijdelijk in memory (geen database)
- kan (optioneel) met `OPENAI_API_KEY` een AI-samenvatting + afspraakextractie doen
- bewaart AI insights tijdelijk in memory via `GET /api/ai/call-insights`
- zet AI-gedetecteerde afspraken (indien datum gevonden) in de interne agenda-feed via `GET /api/agenda/appointments`

## Belangrijke notities

- In de backend is een fallback ingebouwd voor Vapi endpoints (`/call` en `/call/phone`) om compatibiliteit te houden.
- Voor productie is het beter om echte leads uit je leadbron/CRM te gebruiken in plaats van de test-array in de frontend.
- Als je de UI labels wilt aanpassen van "mailing" naar "calling", kan dat later los van deze koppeling.
