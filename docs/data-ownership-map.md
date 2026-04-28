# Data ownership map

Deze kaart legt vast waar belangrijke Softora-data hoort te leven. Het doel is om dubbele waarheid te voorkomen: als een domein naar Supabase of een formele repository is gemigreerd, mag in-memory state alleen nog cache, compat-laag of tijdelijke fallback zijn.

## Basisregel

Database en formele repositories zijn de bron van waarheid zodra een pad is gemigreerd. In-memory runtime state mag gedrag versnellen of oude flows compatibel houden, maar mag niet stilletjes uitgroeien tot nieuwe business-truth.

## Huidige data-eigenaren

| Domein | Huidige eigenaar | Tijdelijke of ondersteunende laag | Opmerking |
| --- | --- | --- | --- |
| Runtime snapshot | Supabase `runtime_state` via `server/services/supabase-state.js` en runtime-sync helpers | In-memory runtime state | Snapshot blijft compatibel met oude flows, maar nieuwe waarheid hoort richting formele opslag. |
| Call updates | Supabase rows met `call_update:` key-prefix | Runtime call-update merge helpers | Dedicated rows voorkomen dat grote snapshots de enige bron zijn. |
| Dismissed leads | Dedicated Supabase dismissed-leads state | In-memory dismissed lead sets | Read-modify-write bescherming voorkomt dat multi-instance runtime elkaar overschrijft. |
| Premium klanten/database | UI-state scope `premium_customers_database`, ingekapseld door `server/repositories/premium-customers-repository.js` | Premium frontend core helpers | De eerste repository-adapter bestaat; het domein moet nog naar een explicieter tabelmodel of dedicated rows groeien. |
| Premium database foto's | UI-state scope `premium_database_photos` | Frontend preview/renderhelpers | Foto's en kosten horen op termijn een expliciete opslag- en retentie-afspraak te krijgen. |
| Agenda afspraken | Runtime state met Supabase synchronisatie | Agenda services en bootstrap helpers | Hoog-risico domein: response-shapes en merge-regels moeten stabiel blijven. |
| Leads en follow-ups | Runtime state met Supabase synchronisatie en dedicated dismissed-leads data | Agenda/leads materialisatiehelpers | Geen nieuwe parallelle lead-identiteit toevoegen zonder migratieplan. |
| Premium auth gebruikers | Supabase-backed premium users | Bootstrap/fallback gebruikers alleen als compat-pad | Service-role access blijft server-side; auth-data mag niet naar frontend-state lekken. |
| UI voorkeuren/configuratie | UI-state scopes via runtime ops | Frontend clients met Supabase-only checks waar vereist | UI-state is geschikt voor voorkeuren, niet voor nieuwe kritieke business-truth. |

## Migratieprioriteit

1. Premium klanten/database naar een explicieter repository- of tabelmodel brengen.
2. Agenda en leads verder losmaken van grote runtime snapshots waar dat veilig kan.
3. UI-state scopes classificeren als voorkeur, cache, of business-data.
4. Runtime snapshot verkleinen zodra dedicated opslagpaden stabiel genoeg zijn.

Gebruik [repository-migration-plan.md](repository-migration-plan.md) als uitvoeringsplan voor deze migratievolgorde.

## Regels voor nieuwe data

1. Kies eerst een bestaande eigenaar uit deze kaart.
2. Voeg geen nieuw scope-, key- of snapshotpad toe zonder rollback- en compat-afspraak.
3. Gebruik UI-state alleen voor UI-voorkeuren of tijdelijke compat-data, niet als nieuwe primaire businessdatabase.
4. Voeg contracttests toe voor merge-regels, timeouts en fallbackgedrag.
5. Werk deze kaart bij zodra een domein van tijdelijke state naar formele opslag verhuist.

## Signalen dat data-eigenaarschap vervuilt

- Een feature leest en schrijft dezelfde businessdata via twee verschillende paden.
- Een frontendpagina bepaalt business-truth omdat de server geen expliciete repository heeft.
- Een grote runtime snapshot groeit door met nieuwe domeinen.
- Een test moet JSON-scope details kennen om businessgedrag te bewaken.
- Een fallbackpad kan nieuwer gedrag overschrijven in plaats van alleen herstellen.

## Niet doen

- Geen nieuwe database-achtige UI-state scope zonder duidelijke eigenaar.
- Geen service-role of auth-gevoelige data richting browser sturen.
- Geen nieuwe in-memory collecties als permanente bron van waarheid.
- Geen stille migratie waarbij oude en nieuwe opslag elkaar kunnen overschrijven.
- Geen datamodelwijziging zonder contracttest voor bestaande response-shapes.

## Klantstatussen

Klantstatussen horen bij de premium klantenrepository en volgen het contract in [docs/customer-status-contract.md](customer-status-contract.md).

De centrale route voor statusupdates op bestaande klanten is `updateCustomerStatusWithHistoryInRows`. Agenda-, lead-, coldcalling- en coldmailingflows mogen klantstatussen gebruiken, maar zijn niet de eigenaar van de statuswaarheid.

Nieuwe code mag klantstatussen daarom niet als losse route-state, frontend-state of nieuwe `server.js` businesslogica behandelen. Als een flow extra statusgedrag nodig heeft, breid eerst het repository-contract en de bijbehorende contracttests uit.
