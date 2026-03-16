# Coldcalling Safe Rollout

Dit document beschrijft hoe je een nieuwe telephony-strategie test zonder de stabiele productieflow te breken.

## Doel

- Productie blijft stabiel op `elevenlabs`.
- Nieuwe route wordt alleen parallel getest.
- Terugrollen moet direct mogelijk zijn.

## Productie Guardrails

Zet in productie:

```env
COLDCALLING_PROVIDER=elevenlabs
COLDCALLING_ALLOW_IMPLICIT_TWILIO_CONFERENCE=false
```

Controleer:

- `/api/healthz`
  - `coldcalling.provider = "elevenlabs"`
  - `coldcalling.providerLocked = true`
  - `coldcalling.providerSelectionMode = "explicit"`

## Parallel Test Pad

1. Gebruik een aparte test-omgeving (niet productie) met eigen URL.
2. Zet alleen daar de nieuwe provider aan.
3. Laat productie envs en productie deploy ongemoeid.

## Acceptatie Gates

Een kandidaat mag pas live als alle gates groen zijn:

1. Geen regressie in call completion rate.
2. Geen regressie in antwoordvertraging.
3. Geen extra audio hapering of overlap.
4. Geen onverwachte provider-switches.
5. Rollback getest en werkt binnen 1 deploy.

## Rollback

Bij elk regressiesignaal:

1. `COLDCALLING_PROVIDER=elevenlabs`
2. `COLDCALLING_ALLOW_IMPLICIT_TWILIO_CONFERENCE=false`
3. Redeploy
4. Check `/api/healthz` op de drie guardrailvelden
