# SIP Mixer Control Service

Aparte control plane service voor het `sip_media_mixer` providerpad in `server.js`.

## Doel

- Expose `POST /v1/outbound/start`
- Expose `GET /v1/outbound/calls/:callId`
- API-key auth via `Authorization: Bearer <SIP_MIXER_CONTROL_API_KEY>`
- Nu met 3 engine-modes:
  - `mock` (default) voor end-to-end testen zonder telephony infra
  - `webhook` om door te schakelen naar een externe media engine
  - `twilio_stream` voor echte outbound calls via Twilio Media Streams

## Quick start

```bash
cd sip-mixer-control-service
npm install
SIP_MIXER_CONTROL_API_KEY=dev-secret npm start
```

Service draait standaard op `http://localhost:10001`.

## Environment

- `PORT` default `10001`
- `SIP_MIXER_CONTROL_API_KEY` required
- `SIP_MIXER_ENGINE_MODE` `mock`, `webhook` of `twilio_stream` (default `mock`)
- `SIP_MIXER_REQUEST_TIMEOUT_MS` default `15000`
- `SIP_MIXER_PUBLIC_BASE_URL` public https base URL van deze service (vereist voor `twilio_stream`, fallback: `RENDER_EXTERNAL_HOSTNAME`)

### Mock mode tuning

- `SIP_MIXER_MOCK_RING_DELAY_MS` default `900`
- `SIP_MIXER_MOCK_CONNECT_DELAY_MS` default `2200`
- `SIP_MIXER_MOCK_DURATION_MS` default `18000`
- `SIP_MIXER_MOCK_TERMINAL_STATUS` default `completed`

### Webhook mode

- `SIP_MIXER_ENGINE_BASE_URL` required
- `SIP_MIXER_ENGINE_BEARER_TOKEN` optional
- `SIP_MIXER_ENGINE_START_PATH` default `/v1/calls/start`
- `SIP_MIXER_ENGINE_STATUS_PATH_TEMPLATE` default `/v1/calls/{callId}`

### Twilio stream mode

- `TWILIO_ACCOUNT_SID` required
- `TWILIO_AUTH_TOKEN` required
- `TWILIO_OUTBOUND_CALLER_NUMBER` required
- `TWILIO_MEDIA_WS_URL` required (bijv. `wss://twilio-media-bridge-.../twilio-media`)
- Service gebruikt:
  - `POST /v1/twilio/call-status` als Twilio status callback
  - `ALL /v1/twilio/outbound-twiml` als TwiML endpoint voor `<Connect><Stream>`

## Contract

### `POST /v1/outbound/start`

Request body (minimaal):

```json
{
  "lead": { "phone": "+31612345678" },
  "campaign": {},
  "dynamicVariables": {},
  "profileId": "default"
}
```

Response:

```json
{
  "ok": true,
  "callId": "sipmix_...",
  "status": "queued",
  "startedAt": "2026-03-16T...Z"
}
```

### `GET /v1/outbound/calls/:callId`

Response:

```json
{
  "callId": "sipmix_...",
  "status": "in-progress",
  "startedAt": "2026-03-16T...Z",
  "endedAt": "",
  "endedReason": "",
  "durationSeconds": null,
  "recordingUrl": ""
}
```

### `POST /v1/outbound/calls/:callId/events`

Optionele endpoint om statusupdates te pushen vanuit externe engine.
