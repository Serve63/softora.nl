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
