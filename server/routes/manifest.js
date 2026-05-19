const criticalFlowChecklist = Object.freeze([
  'premium login laadt en auth-session contract blijft stabiel',
  'agenda laadt en afsprakenlijst reageert zonder serverfout',
  'afspraak datum/tijd blijft behouden na refresh',
  'leadmodal opent met audio en gesprekssamenvatting',
  'geen deal markeert afspraak als afgerond',
  'opdracht aanmaken markeert afspraak als afgerond',
  'coldcalling database popup toont audio en samenvatting',
]);

const pageSmokeTargets = Object.freeze([
  { path: '/diensten', marker: 'Digitale diensten die verkeer omzetten in leads' },
  { path: '/ai-automatisering', marker: 'Automatiseer werk dat nu tijd en kansen kost' },
  { path: '/bedrijfssoftware-op-maat', marker: 'Bedrijfssoftware op maat' },
  { path: '/crm-systeem-op-maat', marker: 'Meer grip op leads, klanten en opvolging' },
  { path: '/ai-telefonist', marker: 'Laat geen telefoontje meer zonder opvolging' },
  { path: '/voicesoftware-op-maat', marker: 'Voicesoftware op maat' },
  { path: '/chatbot-laten-maken', marker: 'Chatbot op maat' },
  { path: '/website-laten-maken', marker: 'Website laten maken' },
  { path: '/blog', marker: 'Artikelen over websites, software en AI groei' },
  { path: '/kennisbank', marker: 'Heldere uitleg voor betere digitale keuzes' },
  { path: '/premium-personeel-login', marker: 'Softora | Personeel Login' },
  { path: '/premium-personeel-agenda', marker: 'Servé Digital | Agenda', allowLoginFallback: true },
  { path: '/premium-leads', marker: 'Softora | Leads Overzicht — Premium', allowLoginFallback: true },
  { path: '/premium-ai-lead-generator', marker: 'Cold Mailing', allowLoginFallback: true },
  { path: '/premium-actieve-opdrachten', marker: 'Softora | Actieve Opdrachten — Premium', allowLoginFallback: true },
]);

const contractTargets = Object.freeze([
  { path: '/healthz', method: 'GET' },
  { path: '/api/healthz', method: 'GET' },
  { path: '/api/health/baseline', method: 'GET' },
  { path: '/api/health/dependencies', method: 'GET' },
  { path: '/api/auth/session', method: 'GET' },
  { path: '/api/agenda/appointments?limit=3', method: 'GET' },
  { path: '/api/coldcalling/call-updates?limit=3', method: 'GET' },
  { path: '/api/coldcalling/cost-summary?scope=all_time', method: 'GET' },
  { path: '/api/coldcalling/call-detail', method: 'GET', expectsMissingCallId: true },
]);

module.exports = {
  criticalFlowChecklist,
  pageSmokeTargets,
  contractTargets,
};
