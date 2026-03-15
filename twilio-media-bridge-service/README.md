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
- Voor non-stop subtiele ambience: `AMBIENCE_ALWAYS_ON=true`, met `AMBIENCE_BASE_GAIN` en `AMBIENCE_UNDER_AGENT_GAIN`
- Ambience-inbound suppressie staat standaard aan (`AMBIENCE_INBOUND_SUPPRESSION_ENABLED=true`) om false speech triggers te blokkeren
- Voor soepeler speech start met ambience: gebruik `AMBIENCE_INBOUND_SUPPRESSION_PREROLL_MAX_CHUNKS` en `AMBIENCE_INBOUND_SPEECH_PASSTHROUGH_MS`
- Echo-guard is verlaagd voor snellere beurtwisseling, met speech-bypass tunables (`AGENT_ECHO_GUARD_*`)
- Outbound playout gebruikt nu centrale queue+pacing; finetune met `TWILIO_OUTBOUND_AGENT_QUEUE_MAX_CHUNKS` en `TWILIO_OUTBOUND_AGENT_JITTER_*`
- Voor minimale latency-spikes: tune `TWILIO_OUTBOUND_AGENT_MAX_LAG_CHUNKS`, `TWILIO_OUTBOUND_MAX_FRAMES_PER_TICK`, `AGENT_SILENCE_TO_AMBIENCE_MS` en `AMBIENCE_AFTER_CALLER_SPEECH_COOLDOWN_MS`

## Start command
`npm run start`

## Welke URL in Vercel als TWILIO_MEDIA_WS_URL
Na deploy op Render:
- `wss://<jouw-render-service-domein>/twilio-media`

Voorbeeld:
- `wss://twilio-media-bridge.onrender.com/twilio-media`
