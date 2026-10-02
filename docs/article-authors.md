# Artikelauteurs

Alle artikelen uit `blog` en `kennisbank` gebruiken Martijn van de Ven of Servé Creusen als auteur. De vaste toewijzing staat in `server/services/seo-content-article-authors.json` en geldt voor de zichtbare naam en de SEO-gegevens. De slug blijft de identiteit, ook wanneer een artikel naar de gezamenlijke verzameling verhuist.

Voeg na nieuwe artikelen de toewijzingen toe met:

```sh
node scripts/sync-seo-article-authors.js
```

De verdeler behoudt bestaande auteurs en geeft nieuwe artikelen aan degene met de minste artikelen. Bij een gelijke stand begint Martijn. Ook geplande artikelen tellen mee. De opdracht is herhaalbaar en slaat uitsluitend artikelmetadata in de repository op. De contracttest blokkeert publicatie wanneer een artikel nog geen vastgelegde auteur heeft.
