# AI Coldcaller MVP (Directe Implementatie)

Directe eigen stack zonder Vapi / ElevenAgents:

- Twilio = telefoonnummer + live call + Media Streams
- OpenAI Realtime 1.5 = gesprekbrein (luisteren + beslissen wat gezegd wordt)
- ElevenLabs = stemlaag (TTS)
- Node.js + TypeScript backend = regellaag

## Wat deze MVP doet

1. Twilio webhook neemt inkomende calls aan en opent een Media Stream naar je backend.
2. Backend stuurt inbound call-audio door naar OpenAI Realtime.
3. OpenAI bepaalt het tekstantwoord.
4. Backend stuurt die tekst naar ElevenLabs streaming TTS.
5. ElevenLabs audio (u-law 8k) gaat terug de Twilio call in.
6. Bij interruptie (prospect praat erdoorheen) stopt backend direct lopende playback.

## Architectuur (MVP)

`Caller <-> Twilio <-> WebSocket /twilio-media <-> OpenAI Realtime (text brain) <-> ElevenLabs TTS <-> Twilio`

## Projectstructuur

```
coldcaller-mvp/
  src/
    audio/ulaw.ts
    bridge/callBridgeSession.ts
    elevenlabs/ttsClient.ts
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

1. Ga naar de map:
   ```bash
   cd coldcaller-mvp
   ```
2. Installeer dependencies:
   ```bash
   npm install
   ```
3. Maak je env file:
   ```bash
   cp .env.example .env
   ```
4. Vul je keys en IDs in `.env`.
5. Start in dev mode:
   ```bash
   npm run dev
   ```
6. Expose lokaal met HTTPS/WSS (bijv. ngrok of Cloudflare Tunnel).

## Benodigde `.env` variabelen

Zie `.env.example`. Belangrijkste:

- `PUBLIC_BASE_URL` = publieke https url van je backend
- `PUBLIC_WSS_URL` = publieke wss url naar `/twilio-media`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL`
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`

## Handmatige Twilio stappen (jij moet doen)

1. Open Twilio Console -> Phone Numbers -> jouw nummer.
2. Zet Voice webhook op:
   - URL: `https://<jouw-domein>/twilio/voice`
   - Method: `POST`
3. Save config.
4. Test inbound: bel je Twilio-nummer.
5. Test outbound (optioneel):
   ```bash
   curl -X POST https://<jouw-domein>/api/calls/start \
     -H 'content-type: application/json' \
     -d '{"to":"+31XXXXXXXXX"}'
   ```

## Handmatige OpenAI stappen (jij moet doen)

1. Zorg dat je API key Realtime toegang heeft.
2. Gebruik model in `.env`:
   - standaard: `gpt-realtime`
3. Geen dashboard-flowbuilder nodig; backend doet direct websocket koppeling.

## Handmatige ElevenLabs stappen (jij moet doen)

1. Maak/kies een voice in ElevenLabs.
2. Zet in `.env`:
   - `ELEVENLABS_API_KEY`
   - `ELEVENLABS_VOICE_ID`
3. MVP gebruikt streaming endpoint met `output_format=ulaw_8000` zodat Twilio direct telephony audio kan afspelen zonder extra transcoding.

## Waarom deze ElevenLabs route

Voor MVP-latency en stabiliteit is directe HTTP streaming TTS met `u-law 8k` de snelste haalbare route:
- geen extra no-code laag
- geen ffmpeg transcode pad nodig
- direct geschikt voor Twilio Media Streams output
- automatische fallback aanwezig: als `ulaw_8000` niet geaccepteerd wordt, gebruikt de backend `pcm_16000` en transcodeert intern naar `u-law 8k`.

## Logging

Logs zijn JSON in stdout, inclusief:
- Twilio stream start/stop
- OpenAI connectie/events
- Assistant tekstoutput
- TTS errors/interrupts

## Bekende MVP-beperkingen

- Geen CRM, agenda, analytics of afspraakworkflow.
- Geen persistente call-opslag.
- E2E test zonder jouw keys/telefooninstellingen kan niet volledig automatisch.

## Snelle troubleshooting

- **Geen audio terug in call**: check `ELEVENLABS_OUTPUT_FORMAT` (u-law 8k) en kijk naar TTS error logs.
- **Call hangt direct op**: check Twilio webhook URL + publieke HTTPS bereikbaarheid.
- **Hoge latency**: controleer tunnel, regio en `ELEVENLABS_OPTIMIZE_LATENCY`.
- **Modelfout OpenAI**: gebruik model dat in jouw account Realtime access heeft.
