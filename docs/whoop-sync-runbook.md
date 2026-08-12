# WHOOP sync runbook

## Doel

Gebruik dit runbook wanneer het gezondheidsdossier geen nieuwe dag toont, een sync blijft hangen of WHOOP opnieuw gekoppeld lijkt te moeten worden. Deel nooit tokens, versleutelde tokenvelden, providerheaders of persoonlijke gezondheidsinhoud in logs of tickets.

## Veilige diagnose

1. Controleer eerst de productieversie met `npm run check:live-production-version`.
2. Lees als ingelogde premium-admin `/api/health/whoop/status` en noteer alleen:
   `connectionStatus`, `syncState`, `lastSyncErrorCode`, `lastSyncedDay`, `expectedDay`,
   `nextRetryAt`, `latestRun` en `alerts`.
3. Controleer in Supabase zonder `encrypted_tokens`, `profile`, `body_measurement`, `summary` of `raw` te selecteren:
   - de connectionstatus, leases en laatste foutcode;
   - de laatste `softora_health_sync_runs` met run-id, lock-id, target day, attempt en timestamps;
   - de queue-status en eerstvolgende retry;
   - `max(local_day)` en aantallen per recordtype.
4. Controleer Vercel op de cronroutes `/api/health/whoop/webhook-worker`,
   `/api/health/whoop/reconcile` en `/api/health/whoop/daily-sync`. Een HTTP 200 is alleen
   triggerbewijs; databewijs vereist een nieuw opgeslagen record en een voortgeschoven `lastSyncedDay`.

## Betekenis van statussen

- `current`: de verwachte datadag is werkelijk opgeslagen.
- `syncing`: er bestaat een actieve databaselease.
- `retry_scheduled`: de verwachte dag ontbreekt en de gratis worker probeert later opnieuw.
- `stale`: data of runstatus loopt achter zonder actieve lease.
- `provider_unavailable`: veilige data-GETs faalden na begrensde retries; bestaande data blijft staan.
- `needs_reauthorization`: WHOOP wees de refresh token definitief af, of de uitkomst van een roterende tokenrefresh is niet veilig vast te stellen.

## Herstelregels

- Start nooit twee tokenrefreshes en herhaal nooit blind een roterende refresh token na een netwerkfout of 5xx.
- Alle handmatige, cron-, webhook-, reconcile- en backfillruns moeten via
  `softora_claim_whoop_sync_run` lopen.
- Alleen de huidige lock-id mag een sync of tokenrefresh afronden via de fenced finish-RPC.
- Een verlopen lease mag worden herclaimd; een oude eigenaar mag daarna niets meer voltooien of vrijgeven.
- De worker haalt vanaf de laatste werkelijk opgeslagen dag begrensd in. Een lege providerresponse
  mag `lastSyncedDay` niet vooruitzetten en plant een nieuwe poging.
- Voer herautorisatie alleen uit wanneer `needsReauthorization` waar is; dit is een gebruikersactie en geen automatische recovery.

## Releasebewijs

Een WHOOP-release is pas bewezen wanneer alle onderstaande punten kloppen:

1. De WHOOP-contracttests en `npm run verify:critical` zijn groen.
2. De migratie staat live en de vier state-machine-RPC's zijn alleen uitvoerbaar door `service_role`.
3. `npm run check:live-production-version` bevestigt exact de actuele `origin/main`.
4. De statusroute toont geen token, profiel, lichaamsmeting of recordinhoud.
5. Een automatische worker/cronrun gebruikt de gedeelde claim-RPC.
6. `max(local_day)` en `lastSyncedDay` zijn alleen vooruitgegaan nadat records voor die dag zijn opgeslagen.
