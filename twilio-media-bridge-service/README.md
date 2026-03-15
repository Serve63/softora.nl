# Twilio Media Bridge Service

Aparte Node.js + TypeScript realtime service voor Twilio Media Streams.

Huidige rol in de nieuwe coldcalling-architectuur:

- Twilio conference AI-participant opent een bidirectional media stream naar deze service
- deze service bridged caller-audio naar ElevenLabs WebSocket
- ElevenLabs audio gaat direct terug naar Twilio
- Twilio `<Stream><Parameter>` values worden doorgezet als ElevenLabs `dynamic_variables`

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
- (optioneel) `VERBOSE_MEDIA_LOGS=true` voor frame-level debug logging

## Start command
`npm run start`

## Welke URL in backend als `TWILIO_MEDIA_WS_URL`
Na deploy op Render:
- `wss://<jouw-render-service-domein>/twilio-media`

Voorbeeld:
- `wss://twilio-media-bridge.onrender.com/twilio-media`

## Vereiste Twilio TwiML

De backend maakt voor de AI-participant TwiML zoals:

```xml
<Response>
  <Connect>
    <Stream url="wss://.../twilio-media">
      <Parameter name="name" value="..." />
      <Parameter name="company" value="..." />
      <Parameter name="phone" value="+31..." />
    </Stream>
  </Connect>
</Response>
```

Die parameters worden in deze bridge automatisch vertaald naar ElevenLabs `conversation_initiation_client_data.dynamic_variables`.
