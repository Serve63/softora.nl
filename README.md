# Softora AI Coldcalling Dashboard + Vapi (Outbound Calls)

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
```

Belangrijk:

- `VAPI_API_KEY` is je private key en blijft alleen op de backend.
- Gebruik deze key nooit in frontend JS/HTML.
- `WEBHOOK_SECRET` is optioneel. De backend checkt dan headers zoals `Authorization` of `x-vapi-secret`.

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
- bevat TODO-comments voor status/transcript/afspraak-opslag

## Belangrijke notities

- In de backend is een fallback ingebouwd voor Vapi endpoints (`/call` en `/call/phone`) om compatibiliteit te houden.
- Voor productie is het beter om echte leads uit je leadbron/CRM te gebruiken in plaats van de test-array in de frontend.
- Als je de UI labels wilt aanpassen van "mailing" naar "calling", kan dat later los van deze koppeling.
