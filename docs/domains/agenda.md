# Domein: Agenda

## Kritiek belang
Agenda is een kernflow. Datum, tijd, locatie en afrondingsstatus mogen niet onbedoeld terugvallen naar call-data of tijdelijke runtime-state.

## Doel
- Eén write-pad voor afspraakupdates
- Eén read-pad voor agenda-overzicht
- Expliciete afrondingsstatus voor oranje agenda-items
- Audit trail voor datum/tijd/status mutaties

## Veiligheidsregels
- Handmatige afspraakwijzigingen hebben voorrang op afgeleide call-data.
- Nieuwe mutaties moeten rollbackbaar zijn.
- Alle UI’s moeten op dezelfde afspraakbron uitkomen.

## Huidige fase
- Fase 2A: de agenda write-routes lopen via [server/routes/agenda.js](/Users/servecreusen/softora.nl-12/server/routes/agenda.js) met centrale payload-normalisatie in [server/schemas/agenda.js](/Users/servecreusen/softora.nl-12/server/schemas/agenda.js).
- De businesslogica leeft nog deels in [server.js](/Users/servecreusen/softora.nl-12/server.js), maar route-definities voor mutaties horen vanaf nu niet meer rechtstreeks daar toegevoegd te worden.
