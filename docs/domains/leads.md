# Domein: Leads

## Kritiek belang
Leads combineren call-data, agenda-data, samenvattingen, audio en workflow-status. Dat maakt dit domein foutgevoelig.

## Doel
- Eén detail-pad voor leadweergave
- Gesprekssamenvatting en audio uit consistente bron
- Geen placeholderteksten cachen als definitieve waarheid

## Veiligheidsregels
- `callId` en gekoppelde opname mogen niet verloren gaan in merge-logica.
- Leadmodal en database-popup moeten dezelfde samenvattingsbron kunnen delen.
- Samenvattingen over gesprekken zijn niet hetzelfde als afspraakbevestigingen.
