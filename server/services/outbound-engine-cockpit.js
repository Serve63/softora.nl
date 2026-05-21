'use strict';

const {
  createOutboundControlPlane,
} = require('./outbound-engine-control-plane');

function createOutboundCockpitModel(input = {}) {
  const state = input.state && typeof input.state === 'object' ? input.state : {};
  const controlPlane = input.controlPlane || createOutboundControlPlane({
    now: input.now,
    targetDailyVolume: input.targetDailyVolume,
    domains: state.domains,
    inboxes: state.inboxes,
    campaigns: state.campaigns,
    leads: state.leads,
    suppressionList: state.suppressionList,
    health: state.health,
    operations: state.operations,
    emergencyPause: state.emergencyPause,
  });

  return {
    mode: 'dry_run',
    canSendRealMail: false,
    status: controlPlane.dashboard.status,
    headline: controlPlane.dashboard.headline,
    cards: createCards(controlPlane),
    blockers: controlPlane.readiness.blockers,
    warnings: controlPlane.readiness.warnings,
    nextActions: controlPlane.dashboard.nextActions,
    domains: createDomainRows(state.domains || [], controlPlane.plan.blockedInboxes || []),
    inboxes: createInboxRows(state.inboxes || [], controlPlane.plan),
    campaigns: createCampaignRows(state.campaigns || [], controlPlane.plan.blockedCampaigns || []),
    suppression: createSuppressionRows(state.suppressionList || []),
    dryRunPreview: createDryRunPreview(controlPlane.plan.jobs || []),
    ramp: controlPlane.forecast,
  };
}

function createCards(controlPlane) {
  const counts = controlPlane.dashboard.counts;
  return [
    { id: 'capacity', label: 'Veilige capaciteit', value: counts.forecastDailyVolume, tone: capacityTone(counts) },
    { id: 'target', label: 'Doel per dag', value: counts.targetDailyVolume, tone: 'neutral' },
    { id: 'healthyInboxes', label: 'Gezonde inboxen', value: counts.healthyInboxes, tone: counts.healthyInboxes > 0 ? 'good' : 'danger' },
    { id: 'dryRunJobs', label: 'Dry-run jobs', value: counts.plannedDryRunJobs, tone: counts.plannedDryRunJobs > 0 ? 'good' : 'warning' },
    { id: 'blockers', label: 'Blockers', value: controlPlane.readiness.blockers.length, tone: controlPlane.readiness.blockers.length ? 'danger' : 'good' },
  ];
}

function createDomainRows(domains, blockedInboxes) {
  const blockedByDomain = blockedInboxes.reduce((acc, item) => {
    const key = item.domain || '';
    acc[key] = [...(acc[key] || []), ...item.reasons];
    return acc;
  }, {});

  return domains.map((domain) => {
    const name = normaliseDomainName(domain.name);
    const reasons = uniqueStrings(blockedByDomain[name] || []);
    return {
      id: domain.id || name,
      name,
      status: reasons.length ? 'blocked' : domain.status || 'pending',
      auth: {
        spf: domain.spf || domain.spfStatus || 'missing',
        dkim: domain.dkim || domain.dkimStatus || 'missing',
        dmarc: domain.dmarc || domain.dmarcStatus || 'missing',
      },
      reasons,
    };
  });
}

function createInboxRows(inboxes, plan) {
  const blockedByEmail = new Map((plan.blockedInboxes || []).map((item) => [item.email, item]));
  const plannedByEmail = (plan.jobs || []).reduce((acc, job) => {
    acc[job.senderEmail] = (acc[job.senderEmail] || 0) + 1;
    return acc;
  }, {});

  return inboxes.map((inbox) => {
    const email = normaliseEmail(inbox.email);
    const blocked = blockedByEmail.get(email);
    return {
      email,
      domainId: inbox.domainId || normaliseDomainName(inbox.domain),
      status: blocked ? 'blocked' : inbox.status || 'pending',
      dailyLimit: inbox.dailyLimit || 20,
      sentToday: inbox.sentToday || 0,
      plannedToday: plannedByEmail[email] || 0,
      reasons: blocked ? blocked.reasons : [],
      warnings: blocked ? blocked.warnings : [],
    };
  });
}

function createCampaignRows(campaigns, blockedCampaigns) {
  const blockedById = new Map(blockedCampaigns.map((item) => [item.campaignId, item]));
  return campaigns.map((campaign) => {
    const blocked = blockedById.get(campaign.id);
    return {
      id: campaign.id || '',
      status: blocked ? 'blocked' : campaign.status || 'draft',
      subject: campaign.subject || '',
      hasOptOut: Boolean(campaign.optOutUrl || campaign.unsubscribeUrl),
      hasLandingPage: Boolean(campaign.landingPageUrl),
      reasons: blocked ? blocked.reasons : [],
    };
  });
}

function createSuppressionRows(entries) {
  return entries.map((entry) => {
    if (typeof entry === 'string') {
      return { target: entry, reason: 'manual', active: true };
    }
    return {
      target: entry.email || entry.domain || entry.leadId || '',
      reason: entry.reason || entry.type || 'manual',
      active: entry.active !== false,
    };
  });
}

function createDryRunPreview(jobs) {
  return jobs.slice(0, 25).map((job) => ({
    id: job.id,
    senderEmail: job.senderEmail,
    leadEmail: job.leadEmail,
    campaignId: job.campaignId,
    scheduledAt: job.scheduledAt,
    sendAllowed: false,
  }));
}

function capacityTone(counts) {
  if (counts.forecastDailyVolume >= counts.targetDailyVolume) return 'good';
  if (counts.forecastDailyVolume > 0) return 'warning';
  return 'danger';
}

function normaliseEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normaliseDomainName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

module.exports = {
  createOutboundCockpitModel,
};
