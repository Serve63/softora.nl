# Rollback Playbook

## Voor elke risicovolle wijziging
1. Draai `npm run backup:runtime`
2. Bewaar het outputbestand buiten git
3. Controleer `npm run verify:critical`

## Direct rollbacken wanneer
- een kritieke flow uit [server/routes/manifest.js](../server/routes/manifest.js) faalt
- afspraakdata terugvalt of verschuift
- leadaudio of gesprekssamenvatting verdwijnt
- auth/session routes onstabiel worden

## Rollback-volgorde
1. Redeploy de laatst bekende stabiele release
2. Zet compat-flags of oude renderingpaden terug indien beschikbaar
3. Herstel runtime-backup als data geraakt is
4. Draai daarna opnieuw `verify:critical`

## Minimale herstelset
- agenda-afspraken
- call updates
- AI call insights
- leadstatus-afleidingen
