# Twilio Media Bridge Service

Aparte Node.js + TypeScript realtime service voor Twilio Media Streams.

## Lokaal draaien
1. `cd twilio-media-bridge-service`
2. `npm install`
3. Development: `npm run dev`
4. Production lokaal: `npm run build && npm run start`

Service luistert op `PORT` (default `3000`), met:
- Health: `GET /` en `GET /healthz` -> `ok`
- WebSocket: `GET /twilio-media` (upgrade)

## Deploy op Render
Maak een nieuwe **Web Service** op Render met root directory:
- `twilio-media-bridge-service`

Instellingen:
- Runtime: `Node`
- Build Command: `npm install && npm run build`
- Start Command: `npm run start`

Environment:
- `NODE_ENV=production`
- `PORT` wordt door Render gezet
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_AGENT_ID`
- (optioneel) `ELEVENLABS_API_BASE_URL`
- (optioneel) `AMBIENCE_ENABLED=true`
- (optioneel) `AMBIENCE_FILE_PATH=assets/office-ambience.wav`
- (optioneel) `AMBIENCE_GAIN=0.06`
- (optioneel) `AMBIENCE_UNDER_AGENT_GAIN=0.5`

Audio gedrag:
- Office-ambience speelt doorlopend op de outbound lijn.
- Tijdens agent-speech wordt ambience extra zachter gemixt voor verstaanbaarheid.
- Bij backpressure krijgt agent-audio voorrang en wordt ambience tijdelijk onderdrukt om haperingen te beperken.

## Start command
`npm run start`

## Welke URL in Vercel als TWILIO_MEDIA_WS_URL
Na deploy op Render:
- `wss://<jouw-render-service-domein>/twilio-media`

Voorbeeld:
- `wss://twilio-media-bridge.onrender.com/twilio-media`
