# Eerste v8-meting — 3 oktober 2026

De kandidaat herstelt twee positieve contactsets over twee historische sets.
Er verdwijnen geen eerdere goedkeuringen en er veranderen geen contactvelden
van bedrijven die beide varianten al goedkeurden. De bestaande foutieve
goedkeuring in de tweede set blijft aanwezig. Dit is een kleine aantoonbare
verbetering in deze replays; brede winst en live veiligheid zijn nog onbewezen.

| Meting | Ontwikkelset v7 → v8 | Tweede historische set v7 → v8 |
|---|---:|---:|
| Positieve / negatieve referenties | 100 / 60 | 120 / 80 |
| Positieve bedrijven gevonden | 65 → 66 | 68 → 69 |
| E-mail én telefoon exact gelijk aan referentie | 54 → 55 | 52 → 53 |
| Negatieve referentie toch goedgekeurd | 0 → 0 | 1 → 1 |
| Verloren eerdere goedkeuringen | 0 | 0 |
| Gewijzigde contacten bij eerdere goedkeuringen | 0 | 0 |
| Replaytijd, seconden | 269,309 → 527,141 | 1001,749 → 998,517 |

De tijden bewijzen geen snelheidswinst. De runs liepen deels naast andere
processen en herhalen geen gecontroleerde timingproef. Een eerdere variant
met een andere e-mailscanner en parsecache gaf identieke ontwikkeluitkomsten
en duurde 354,879 seconden; die variant is niet opgenomen in deze kandidaat.

## Wat deze meting bewijst

- Per set kregen v7 en v8 exact dezelfde opgeslagen bronpagina's. De bronhashes
  zijn voor/na de replay onveranderd gebleven.
- Beide kandidaat-runs gebruikten exact dezelfde overlaycode. De vergelijking
  van de tweede set controleert bovendien 98 gemeenschappelijk geïmporteerde
  engine-/dependencybestanden op identieke hashes.
- De eerste ontwikkelbaseline legde nog geen codehashmanifest vast; daarvoor
  wordt geen volledige broncodegelijkheidscontrole achteraf geclaimd.
- De vastgezette kandidaat is niet aangepast na het bekijken van de tweede
  vergelijking. Er is geen verse, nooit eerder gebruikte holdout geclaimd.
- Alle vier gemeten runs hadden 0 netwerkaanroepen/-pogingen, 0 modelaanroepen
  en 0 productieschrijfacties. De judge, assist en sitefinder stonden uit.
  Deze uitkomsten beoordelen dus de kostenvrije v7-kern met/zonder overlay,
  niet het volledige live gedrag met eventuele Codex-assistentie.

Exacte overeenkomst betreft de historische referentie. Andere geldige of
verouderde contactsets kunnen hiervan afwijken. De huidige correctheid van
iedere goedkeuring is hiermee niet onafhankelijk bewezen.

## Reproduceren en controleren

Zie [README.md](README.md) voor de runner en vereiste lokale installatie.
De ontwikkelbron is `limit-holdout-160-v7`, met referentie
`limit-holdout-160/truth.json`. De tweede bron is
`limit-holdout2-200-A-live`, met referentie `limit-holdout2-200/truth.json`.
Deze namen verwijzen uitsluitend naar beschermde lokale `data/shadow`-bestanden;
de bestanden en individuele contactuitvoer zijn niet opgenomen in Git.

Validatie: 20 gerichte Python-tests; 3 nieuwe Node-contracttests;
`npm run verify:critical` groen, inclusief 5157 contracttests en 100 smoke-tests.
De drie bestaande lokale PostgreSQL-integratiesuites zijn volgens hun bestaande
contract overgeslagen omdat geen testdatabase was geconfigureerd.

De live robot bleef actief met acht gelijktijdige bedrijven; searchers en
controleurs bleven uit. De v8-code is niet in de enginekeuze opgenomen of
geïnstalleerd. Voor volgende verbetering: verse onafhankelijke broncontrole,
de bestaande foutieve entiteitsgoedkeuring oplossen en gericht beter bewijs
verwerven voor de bedrijven waarvan contactpagina's nu leeg/onbereikbaar zijn.
