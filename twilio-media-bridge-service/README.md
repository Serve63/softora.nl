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
- (optioneel) `COMFORT_NOISE_ENABLED=true`
- (optioneel) `COMFORT_NOISE_MIN_GAP_MS=120`
- (optioneel) `COMFORT_NOISE_PCM_PEAK=120`

Gedrag:
- Tijdens stiltes stuurt de bridge subtiele comfort-noise naar Twilio voor een natuurlijke "open lijn".
- Alleen inbound media wordt naar ElevenLabs doorgestuurd; outbound wordt genegeerd om self-talk loops te voorkomen.

## Start command
`npm run start`

## Welke URL in Vercel als TWILIO_MEDIA_WS_URL
Na deploy op Render:
- `wss://<jouw-render-service-domein>/twilio-media`

Voorbeeld:
- `wss://twilio-media-bridge.onrender.com/twilio-media`
