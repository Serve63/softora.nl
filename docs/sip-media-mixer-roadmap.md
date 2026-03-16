# SIP Media Mixer Roadmap

Doel: continue zachte office-ambience onder de AI-stem, zonder regressie op de bestaande coldcalling-flow.

## Scope

- Productie blijft op `elevenlabs` zolang niet bewezen groen.
- `sip_media_mixer` provider is parallel en expliciet aan te zetten.
- Media-mix en SIP handling gebeuren buiten deze backend.

## Control Plane Contract

Deze backend verwacht bij `sip_media_mixer`:

1. `POST /v1/outbound/start`
2. `GET /v1/outbound/calls/:callId`

Zie README voor request/response-vorm.

## Fases

1. Infra bootstrap
   - SIP/media-server beschikbaar (bijv. Asterisk/FreeSWITCH + mixer logic)
   - publiek control endpoint met auth
   - observability: call logs + metrics

2. Canarystart
   - aparte testomgeving
   - `COLDCALLING_PROVIDER=sip_media_mixer`
   - productie blijft op `elevenlabs`

3. Quality gates
   - call completion niet slechter dan baseline
   - geen extra stotteren/overlap
   - ambience continu, zacht, niet hoorbaar in AI-inbound
   - rollback binnen 1 deploy

4. Gefaseerde live rollout
   - klein traffic-percentage
   - monitoren per cohort
   - direct terug bij regressie

## Rollback

1. `COLDCALLING_PROVIDER=elevenlabs`
2. `COLDCALLING_ALLOW_IMPLICIT_TWILIO_CONFERENCE=false`
3. redeploy
4. `/api/healthz` checken op provider + lock status
