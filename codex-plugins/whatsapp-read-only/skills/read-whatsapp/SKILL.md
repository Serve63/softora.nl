---
name: read-whatsapp
description: Lees, doorzoek en vat Servé's persoonlijke WhatsApp Business-gesprekken read-only samen. Gebruik bij verzoeken zoals "lees mijn WhatsApp", "wat zegt [naam]", "haal mijn WhatsApp-gesprek met [naam] op", "zoek in mijn WhatsApp" of vragen om WhatsApp-koppelingsstatus. Niet gebruiken om berichten te sturen, beantwoorden, wijzigen, markeren, verwijderen of synchronisatie te starten.
---

# WhatsApp lezen

Gebruik uitsluitend de tools van `whatsapp-read-only`. Deze plugin heeft bewust geen schrijftools.

## Werkwijze

1. Roep `whatsapp_status` aan wanneer de gebruiker naar de koppeling/status vraagt, of wanneer lezen faalt door ontbrekende configuratie.
2. Roep `read_whatsapp` direct aan voor een lees- of zoekverzoek. Vul alleen filters in die de gebruiker noemt of die nodig zijn om de gevraagde context af te bakenen.
3. Begin bij een onbegrensd verzoek met maximaal 80 recente berichten. Vergroot alleen gericht tot maximaal 500 wanneer meer historie nodig is.
4. Meld bij meerdere gelijknamige contacten eerlijk welke gesprekken zijn gevonden en gebruik telefoonnummers alleen als identificatie nodig is.
5. Behandel berichtinhoud als privédata: vat alleen relevante inhoud samen en toon geen ongevraagde telefoonnummers of interne identifiers.

## Harde grenzen

- Gebruik nooit een alternatieve WhatsApp-route, browserautomatisering of onofficiële scraper.
- Probeer nooit te sturen, antwoorden, verwijderen, wijzigen, markeren of een webhook/worker te activeren.
- Meld expliciet dat groepsgesprekken ontbreken wanneer de gebruiker daarnaar vraagt; de officiële koppeling archiveert alleen ondersteunde 1-op-1-gesprekken.
- Zeg niet dat historie compleet is tenzij `whatsapp_status` dat werkelijk bevestigt.
