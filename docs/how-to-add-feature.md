# Nieuwe Feature Toevoegen

## Volgorde
1. Check of de feature een bestaand domein raakt.
2. Voeg of hergebruik een service onder `server/services/`.
3. Houd routes compatibel en documenteer contractwijzigingen.
4. Voeg waar nodig een smoke- of contracttest toe.
5. Draai `npm run verify:critical`.

## Niet doen
- Geen nieuwe zware businesslogica inline in HTML zetten.
- Geen nieuwe parallelle bronnen van waarheid maken.
- Geen snelle hotfixes die bestaande response-shapes impliciet veranderen.

## Bij risicovolle features
- Maak eerst een runtime-backup
- Gebruik compat-flags indien oud en nieuw gedrag tijdelijk naast elkaar moeten draaien
- Documenteer rollback-criterium in commit/PR beschrijving
