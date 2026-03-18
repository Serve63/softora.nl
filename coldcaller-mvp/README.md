# AI Coldcaller MVP (Twilio + OpenAI Realtime 1.5)

Directe stack zonder Vapi/ElevenAgents:

- Twilio = telefoonnummer + call + media stream
- OpenAI Realtime 1.5 = luisteren + redeneren + stem-output
- Node.js + TypeScript = bridge

## Wat deze versie doet

1. Twilio ontvangt de call en opent `/twilio-media`.
2. Backend stuurt inbound audio naar OpenAI Realtime.
3. OpenAI Realtime antwoordt direct met audio (g711_ulaw).
4. Backend stuurt die audio direct terug naar Twilio.
5. Barge-in werkt: als beller door de AI praat, wordt current output gecanceld.

## Architectuur

`Caller <-> Twilio <-> /twilio-media <-> OpenAI Realtime (audio in/out)`

## Projectstructuur

```txt
coldcaller-mvp/
  src/
    audio/ulaw.ts
    bridge/callBridgeSession.ts
    openai/realtimeClient.ts
    twilio/routes.ts
    utils/logger.ts
    config.ts
    index.ts
  .env.example
  package.json
  tsconfig.json
```

## Lokaal starten

1. `cd coldcaller-mvp`
2. `npm install`
3. `cp .env.example .env`
4. Vul `.env`
5. `npm run dev`

## Belangrijkste env vars

- `PUBLIC_BASE_URL`
- `PUBLIC_WSS_URL`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `OPENAI_API_KEY`
- `OPENAI_REALTIME_MODEL` (default `gpt-realtime`)
- `OPENAI_REALTIME_VOICE` (bijv. `shimmer`)
- `OPENAI_REALTIME_VAD_THRESHOLD`
- `OPENAI_REALTIME_VAD_PREFIX_PADDING_MS`
- `OPENAI_REALTIME_VAD_SILENCE_DURATION_MS`
- `AGENT_SYSTEM_PROMPT` (optioneel, maar praktisch altijd zetten)

## Twilio instellen

1. Twilio Console -> Phone Numbers -> jouw nummer.
2. Voice webhook:
   - URL: `https://<jouw-domein>/twilio/voice`
   - Method: `POST`
3. Save.

## Outbound test (optioneel)

```bash
curl -X POST https://<jouw-domein>/api/calls/start \
  -H 'content-type: application/json' \
  -d '{"to":"+31XXXXXXXXX"}'
```

## Logging

Belangrijk in logs:

- `Twilio stream gestart`
- `OpenAI Realtime socket verbonden`
- `Bridge sessie metrics`
- `OpenAI realtime event error` (als er iets kapot gaat)

## Troubleshooting

- Geen audio: check of Twilio webhook op `/twilio/voice` staat.
- Te vroeg reageren: verhoog `OPENAI_REALTIME_VAD_SILENCE_DURATION_MS` (bv. `950` of `1100`).
- Te sloom: verlaag `OPENAI_REALTIME_VAD_SILENCE_DURATION_MS` (bv. `700`).
- Rare antwoorden: check `AGENT_SYSTEM_PROMPT` en logs op transcript.
