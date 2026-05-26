'use strict';

const {
  DEFAULT_OUTBOUND_POLICY,
  createOutboundDryRunPlan,
} = require('./outbound-engine');

const DEFAULT_REQUIRED_OPERATIONS = Object.freeze({
  centralSuppressionListConnected: false,
  bounceProcessorConnected: false,
  replyProcessorConnected: false,
  optOutEndpointConnected: false,
  seedInboxChecksConnected: false,
  dmarcReportsConnected: false,
  providerPostmasterConnected: false,
  legalReviewApproved: false,
  dryRunReviewedByHuman: false,
});

function createOutboundControlPlane(input = {}) {
  const now = normaliseDate(input.now);
  const snapshot = normaliseOutboundSnapshot(input);
  const plan = createOutboundDryRunPlan({
    now,
    policy: snapshot.policy,
    domains: snapshot.domains,
    inboxes: snapshot.inboxes,
    campaigns: snapshot.campaigns,
    leads: snapshot.leads,
    suppressionList: snapshot.suppressionList,
    health: snapshot.health,
  });
  const forecast = createOutboundRampForecast({
    targetDailyVolume: snapshot.targetDailyVolume,
    inboxCount: snapshot.inboxes.length,
    maxDailyPerInbox: snapshot.policy.maxDailyPerInbox,
  });
  const suppression = summarizeSuppressionList(snapshot.suppressionList);
  const readiness = evaluateOutboundReadiness(snapshot, plan, suppression);
  const dashboard = buildOutboundDashboard(snapshot, plan, readiness, forecast);

  return {
    ok: readiness.pilotReady,
    mode: 'dry_run',
    canSendRealMail: false,
    sendTransportImplemented: false,
    dashboard,
    readiness,
    forecast,
    suppression,
    plan,
  };
}

function normaliseOutboundSnapshot(input = {}) {
  const policy = {
    ...DEFAULT_OUTBOUND_POLICY,
    ...(input.policy || {}),
    sendWindow: {
      ...DEFAULT_OUTBOUND_POLICY.sendWindow,
      ...((input.policy && input.policy.sendWindow) || {}),
    },
  };

  return {
    policy,
    targetDailyVolume: positiveNumber(input.targetDailyVolume, 500),
    domains: Array.isArray(input.domains) ? input.domains : [],
    inboxes: Array.isArray(input.inboxes) ? input.inboxes : [],
    campaigns: Array.isArray(input.campaigns) ? input.campaigns : [],
    leads: Array.isArray(input.leads) ? input.leads : [],
    suppressionList: Array.isArray(input.suppressionList) ? input.suppressionList : [],
    health: input.health && typeof input.health === 'object' ? input.health : {},
    emergencyPause: normaliseEmergencyPause(input.emergencyPause),
    operations: {
      ...DEFAULT_REQUIRED_OPERATIONS,
      ...(input.operations || {}),
    },
  };
}

function evaluateOutboundReadiness(snapshot, plan, suppression) {
  const blockers = [];
  const warnings = [];
  const operations = snapshot.operations;

  if (snapshot.emergencyPause.active) blockers.push('emergency_pause_active');
  if (!plan.window.open) blockers.push(plan.window.reason);
  if (plan.summary.healthyInboxes < 1) blockers.push('no_healthy_inboxes');
  if (plan.summary.blockedInboxes > 0) warnings.push('some_inboxes_blocked');
  if (plan.summary.blockedCampaigns > 0) blockers.push('campaigns_blocked');
  if (plan.summary.eligibleLeads < 1) blockers.push('no_eligible_leads');
  if (plan.summary.plannedJobs < 1) blockers.push('dry_run_has_no_jobs');
  if (!operations.centralSuppressionListConnected) blockers.push('central_suppression_not_connected');
  if (!operations.bounceProcessorConnected) blockers.push('bounce_processor_not_connected');
  if (!operations.replyProcessorConnected) blockers.push('reply_processor_not_connected');
  if (!operations.optOutEndpointConnected) blockers.push('opt_out_endpoint_not_connected');
  if (!operations.seedInboxChecksConnected) blockers.push('seed_inbox_checks_not_connected');
  if (!operations.dmarcReportsConnected) blockers.push('dmarc_reports_not_connected');
  if (!operations.providerPostmasterConnected) warnings.push('provider_postmaster_not_connected');
  if (!operations.legalReviewApproved) blockers.push('legal_review_not_approved');
  if (!operations.dryRunReviewedByHuman) blockers.push('dry_run_not_human_reviewed');
  if (suppression.activeEntries < 1) warnings.push('suppression_list_empty');

  return {
    pilotReady: blockers.length === 0,
    canSendRealMail: false,
    liveSendingBlockers: ['send_transport_not_implemented', 'manual_production_approval_required'],
    blockers: uniqueStrings(blockers),
    warnings: uniqueStrings(warnings),
    requiredOperations: operations,
    safetyRails: [
      'dry_run_only',
      'separate_domains_required',
      'softora_nl_protected',
      'low_volume_per_inbox',
      'central_suppression_required',
      'health_signals_required',
      'human_review_required',
      'manual_live_transport_required',
    ],
  };
}

function buildOutboundDashboard(snapshot, plan, readiness, forecast) {
  return {
    status: resolveDashboardStatus(snapshot, plan, readiness),
    headline: resolveDashboardHeadline(snapshot, plan, readiness),
    counts: {
      targetDailyVolume: snapshot.targetDailyVolume,
      forecastDailyVolume: forecast.currentDailyCapacity,
      requiredInboxesForTarget: forecast.requiredInboxes,
      registeredDomains: snapshot.domains.length,
      registeredInboxes: snapshot.inboxes.length,
      healthyInboxes: plan.summary.healthyInboxes,
      approvedCampaigns: plan.summary.blockedCampaigns === 0 ? snapshot.campaigns.length : 0,
      eligibleLeads: plan.summary.eligibleLeads,
      plannedDryRunJobs: plan.summary.plannedJobs,
      blockedInboxes: plan.summary.blockedInboxes,
      blockedLeads: plan.summary.blockedLeads,
    },
    nextActions: createNextActions(snapshot, plan, readiness, forecast),
  };
}

function resolveDashboardStatus(snapshot, plan, readiness) {
  if (snapshot.emergencyPause.active) return 'paused';
  if (readiness.pilotReady) return 'ready_for_closed_pilot';
  if (plan.summary.healthyInboxes === 0 || plan.summary.blockedCampaigns > 0) return 'blocked';
  return 'draft';
}

function resolveDashboardHeadline(snapshot, plan, readiness) {
  if (snapshot.emergencyPause.active) return 'Noodpauze staat aan; outbound blijft volledig stil.';
  if (readiness.pilotReady) return 'Klaar voor gesloten dry-run pilot, nog niet voor live verzending.';
  if (plan.summary.healthyInboxes === 0) return 'Nog geen gezonde aparte inboxen beschikbaar.';
  if (plan.summary.plannedJobs === 0) return 'Nog geen droge planning mogelijk.';
  return 'Fundering staat, maar veiligheidsonderdelen ontbreken nog.';
}

function createNextActions(snapshot, plan, readiness, forecast) {
  const actions = [];
  const blockers = new Set(readiness.blockers);
  const warnings = new Set(readiness.warnings);

  if (forecast.missingInboxes > 0) {
    actions.push(`Voeg nog ${forecast.missingInboxes} inboxen toe voor ${forecast.targetDailyVolume} per dag.`);
  }
  if (blockers.has('no_healthy_inboxes')) actions.push('Maak aparte outbound-domeinen en inboxen gezond.');
  if (blockers.has('campaigns_blocked')) actions.push('Maak minimaal 1 campagne volledig goedgekeurd met opt-out en landing page.');
  if (blockers.has('no_eligible_leads')) actions.push('Vul leads aan met bedrijfsnaam, bron en relevantiereden.');
  if (blockers.has('central_suppression_not_connected')) actions.push('Sluit de centrale suppressielijst aan.');
  if (blockers.has('bounce_processor_not_connected')) actions.push('Sluit bounce-verwerking aan voordat pilot start.');
  if (blockers.has('reply_processor_not_connected')) actions.push('Sluit reply-verwerking aan voordat pilot start.');
  if (blockers.has('opt_out_endpoint_not_connected')) actions.push('Sluit opt-out endpoint en uitschrijflog aan.');
  if (blockers.has('seed_inbox_checks_not_connected')) actions.push('Sluit seed inbox checks aan voor spam-placement monitoring.');
  if (blockers.has('dmarc_reports_not_connected')) actions.push('Sluit DMARC aggregate reports aan.');
  if (blockers.has('legal_review_not_approved')) actions.push('Leg juridische outbound-regels en opt-out-policy vast.');
  if (blockers.has('dry_run_not_human_reviewed')) actions.push('Laat een mens de dry-run jobs visueel goedkeuren.');
  if (warnings.has('provider_postmaster_not_connected')) actions.push('Koppel provider/postmaster dashboards zodra domeinen bestaan.');
  if (snapshot.emergencyPause.active) actions.push('Haal noodpauze pas weg na root-cause en handmatige bevestiging.');
  if (!actions.length && !readiness.pilotReady) actions.push('Bekijk resterende blockers in readiness.blockers.');
  if (!actions.length) actions.push('Start gesloten pilot in dry-run reviewmodus; live sending blijft uit.');

  return actions;
}

function createOutboundRampForecast(input = {}) {
  const targetDailyVolume = positiveNumber(input.targetDailyVolume, 500);
  const inboxCount = Math.max(0, Math.floor(Number(input.inboxCount || 0)));
  const maxDailyPerInbox = positiveNumber(input.maxDailyPerInbox, DEFAULT_OUTBOUND_POLICY.maxDailyPerInbox);
  const safePerInboxTarget = Math.min(maxDailyPerInbox, 9);
  const requiredInboxes = Math.ceil(targetDailyVolume / safePerInboxTarget);

  const phases = [
    { label: 'Week 1-2', perInboxDailyLimit: 0, purpose: 'Setup, DNS, inbox health en testdata.' },
    { label: 'Week 3', perInboxDailyLimit: 3, purpose: 'Eerste kleine dry-run/pilotdruk.' },
    { label: 'Week 4', perInboxDailyLimit: 5, purpose: 'Rustig verhogen als alles groen blijft.' },
    { label: 'Week 5', perInboxDailyLimit: 7, purpose: 'Meer volume met strakke monitoring.' },
    { label: 'Week 6-8', perInboxDailyLimit: 9, purpose: 'Normale veilige werksnelheid.' },
    { label: 'Na groen licht', perInboxDailyLimit: safePerInboxTarget, purpose: 'Alleen verhogen bij blijvend groene reputatie.' },
  ];

  return {
    targetDailyVolume,
    inboxCount,
    safePerInboxTarget,
    requiredInboxes,
    missingInboxes: Math.max(0, requiredInboxes - inboxCount),
    currentDailyCapacity: inboxCount * safePerInboxTarget,
    phases: phases.map((phase) => ({
      ...phase,
      estimatedDailyVolume: inboxCount * phase.perInboxDailyLimit,
      targetReached: inboxCount * phase.perInboxDailyLimit >= targetDailyVolume,
    })),
  };
}

function summarizeSuppressionList(entries = []) {
  const active = [];
  const byReason = {};

  for (const entry of entries) {
    const reason = normaliseSuppressionReason(entry);
    if (!reason) continue;
    active.push(entry);
    byReason[reason] = (byReason[reason] || 0) + 1;
  }

  return {
    activeEntries: active.length,
    byReason,
  };
}

function normaliseSuppressionReason(entry) {
  if (typeof entry === 'string' && entry.trim()) return 'manual';
  if (!entry || typeof entry !== 'object') return '';
  if (entry.active === false) return '';
  return String(entry.reason || entry.type || 'manual').trim().toLowerCase();
}

function normaliseEmergencyPause(value) {
  if (!value) return { active: false, reason: null };
  if (value === true) return { active: true, reason: 'manual_pause' };
  return {
    active: Boolean(value.active),
    reason: value.reason || null,
  };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normaliseDate(value) {
  if (value instanceof Date) return value;
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

module.exports = {
  DEFAULT_REQUIRED_OPERATIONS,
  createOutboundControlPlane,
  createOutboundRampForecast,
  evaluateOutboundReadiness,
  normaliseOutboundSnapshot,
  summarizeSuppressionList,
};
