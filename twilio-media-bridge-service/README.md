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
- `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_ID`
- Optioneel ambience: `AMBIENCE_ENABLED=true` + `AMBIENCE_FILE_PATH=...`
- Low-latency profiel is code-fixed (geen Render env tuning nodig):
  - `AGENT_ECHO_GUARD_MS=80`
  - `MAX_PREFLUSH_TWILIO_AUDIO_CHUNKS=8`
  - `INBOUND_SILENCE_GATE_ENABLED=true`
  - `INBOUND_SILENCE_RMS_THRESHOLD=260`
  - `INBOUND_SILENCE_HANGOVER_MS=240`

## Start command
`npm run start`

## Welke URL in Vercel als TWILIO_MEDIA_WS_URL
Na deploy op Render:
- `wss://<jouw-render-service-domein>/twilio-media`

Voorbeeld:
- `wss://twilio-media-bridge.onrender.com/twilio-media`
