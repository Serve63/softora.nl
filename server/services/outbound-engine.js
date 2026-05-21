'use strict';

const DEFAULT_OUTBOUND_POLICY = Object.freeze({
  globalDailyLimit: 500,
  defaultInboxDailyLimit: 20,
  maxDailyPerInbox: 25,
  minMinutesBetweenInboxSends: 18,
  weekdaysOnly: true,
  sendWindow: Object.freeze({
    start: '09:00',
    end: '17:00',
    timeZone: 'Europe/Amsterdam',
  }),
  protectedSenderDomains: Object.freeze(['softora.nl']),
  hardBounceRateLimit: 0.02,
  complaintRateWarning: 0.001,
  complaintRateHardLimit: 0.003,
  seedSpamPlacementLimit: 0,
});

function createOutboundDryRunPlan(input = {}) {
  const policy = mergePolicy(input.policy);
  const now = normaliseDate(input.now);
  const domains = Array.isArray(input.domains) ? input.domains : [];
  const inboxes = Array.isArray(input.inboxes) ? input.inboxes : [];
  const campaigns = Array.isArray(input.campaigns) ? input.campaigns : [];
  const leads = Array.isArray(input.leads) ? input.leads : [];
  const suppressionList = createSuppressionSet(input.suppressionList);
  const health = input.health && typeof input.health === 'object' ? input.health : {};
  const domainById = new Map(domains.map((domain) => [String(domain.id || domain.name), domain]));
  const validCampaigns = [];
  const blockedCampaigns = [];
  const eligibleInboxes = [];
  const blockedInboxes = [];
  const eligibleLeads = [];
  const blockedLeads = [];
  const window = evaluateSendWindow(now, policy);

  for (const campaign of campaigns) {
    const campaignCheck = validateOutboundCampaign(campaign);
    if (campaignCheck.ok) {
      validCampaigns.push(campaign);
    } else {
      blockedCampaigns.push({
        campaignId: campaign && campaign.id ? campaign.id : null,
        reasons: campaignCheck.reasons,
      });
    }
  }

  for (const inbox of inboxes) {
    const domain = resolveInboxDomain(inbox, domainById);
    const healthCheck = evaluateInboxReadiness(inbox, domain, health, policy, now);

    if (healthCheck.ok) {
      eligibleInboxes.push({
        inbox,
        domain,
        dailyLimit: healthCheck.dailyLimit,
        availableSlots: healthCheck.availableSlots,
        warnings: healthCheck.warnings,
        planned: 0,
        nextAvailableAt: new Date(now.getTime()),
      });
    } else {
      blockedInboxes.push({
        email: normaliseEmail(inbox && inbox.email),
        domain: normaliseDomainName(domain && domain.name),
        reasons: healthCheck.reasons,
        warnings: healthCheck.warnings,
      });
    }
  }

  const seenLeadKeys = new Set();
  for (const lead of leads) {
    const eligibility = isLeadEligible(lead, suppressionList, seenLeadKeys);
    if (eligibility.ok) {
      eligibleLeads.push(lead);
    } else {
      blockedLeads.push({
        leadId: lead && lead.id ? lead.id : null,
        email: normaliseEmail(lead && lead.email),
        reasons: eligibility.reasons,
      });
    }
  }

  const jobs = [];
  const systemReasons = [];

  if (!window.open) systemReasons.push(window.reason);
  if (!validCampaigns.length) systemReasons.push('no_approved_campaign');
  if (!eligibleInboxes.length) systemReasons.push('no_healthy_inboxes');
  if (!eligibleLeads.length) systemReasons.push('no_eligible_leads');

  if (!systemReasons.length) {
    const maxJobs = Math.min(policy.globalDailyLimit, eligibleLeads.length);
    let leadIndex = 0;

    while (jobs.length < maxJobs && leadIndex < eligibleLeads.length) {
      const candidate = pickNextInbox(eligibleInboxes, policy);
      if (!candidate) break;

      const campaign = validCampaigns[jobs.length % validCampaigns.length];
      const scheduledAt = new Date(candidate.nextAvailableAt.getTime());

      if (!isInsideSendWindow(scheduledAt, policy)) {
        candidate.availableSlots = 0;
        continue;
      }

      const lead = eligibleLeads[leadIndex];
      jobs.push({
        id: `dryrun_${String(jobs.length + 1).padStart(4, '0')}`,
        dryRun: true,
        sendAllowed: false,
        leadId: lead.id || null,
        leadEmail: normaliseEmail(lead.email),
        campaignId: campaign.id || null,
        senderEmail: normaliseEmail(candidate.inbox.email),
        senderDomain: normaliseDomainName(candidate.domain.name),
        scheduledAt: scheduledAt.toISOString(),
        safetyChecks: [
          'dry_run_only',
          'sender_domain_not_protected',
          'inbox_quota_checked',
          'domain_auth_checked',
          'lead_not_suppressed',
          'campaign_approved',
        ],
      });

      candidate.planned += 1;
      candidate.availableSlots -= 1;
      candidate.nextAvailableAt = new Date(
        candidate.nextAvailableAt.getTime() + policy.minMinutesBetweenInboxSends * 60 * 1000,
      );
      leadIndex += 1;
    }
  }

  return {
    ok: systemReasons.length === 0,
    dryRun: true,
    canSendRealMail: false,
    requiresManualActivation: true,
    window,
    jobs,
    blockedInboxes,
    blockedCampaigns,
    blockedLeads,
    summary: {
      requestedLeads: leads.length,
      eligibleLeads: eligibleLeads.length,
      plannedJobs: jobs.length,
      healthyInboxes: eligibleInboxes.length,
      blockedInboxes: blockedInboxes.length,
      blockedCampaigns: blockedCampaigns.length,
      blockedLeads: blockedLeads.length,
      systemReasons,
      canSendRealMail: false,
      maxGlobalDailyLimit: policy.globalDailyLimit,
      maxDailyPerInbox: policy.maxDailyPerInbox,
    },
  };
}

function evaluateInboxReadiness(inbox, domain, health, policy, now) {
  const reasons = [];
  const warnings = [];
  const email = normaliseEmail(inbox && inbox.email);
  const senderDomain = normaliseDomainName(emailDomain(email));
  const domainName = normaliseDomainName(domain && domain.name ? domain.name : senderDomain);
  const inboxHealth = getHealthFor(health.inboxes, email);
  const domainHealth = getHealthFor(health.domains, domain && domain.id ? domain.id : domainName);
  const sentToday = Number(inbox && (inbox.sentToday || inbox.alreadySentToday) || 0);

  if (!email || !senderDomain) reasons.push('invalid_sender_email');
  if (!domain) reasons.push('missing_sender_domain_record');
  if (inbox && inbox.status && inbox.status !== 'active') reasons.push('inbox_not_active');
  if (policy.protectedSenderDomains.includes(senderDomain)) reasons.push('protected_sender_domain');
  if (domainName && senderDomain && domainName !== senderDomain) reasons.push('sender_domain_mismatch');

  addDomainAuthReasons(domain, reasons);
  addMetricReasons(inboxHealth, policy, reasons, warnings);
  addMetricReasons(domainHealth, policy, reasons, warnings);

  const limitResult = resolveInboxDailyLimit(inbox, policy, now);
  warnings.push(...limitResult.warnings);

  const availableSlots = Math.max(0, limitResult.limit - sentToday);
  if (availableSlots <= 0) reasons.push('inbox_daily_quota_used');

  return {
    ok: reasons.length === 0,
    reasons: uniqueStrings(reasons),
    warnings: uniqueStrings(warnings),
    dailyLimit: limitResult.limit,
    availableSlots,
  };
}

function validateOutboundCampaign(campaign) {
  const reasons = [];
  if (!campaign || typeof campaign !== 'object') {
    return { ok: false, reasons: ['campaign_missing'] };
  }

  const isApproved = campaign.approved === true || campaign.status === 'approved';
  const optOutUrl = campaign.optOutUrl || campaign.unsubscribeUrl;

  if (!isApproved) reasons.push('campaign_not_approved');
  if (!hasText(campaign.subject)) reasons.push('campaign_subject_missing');
  if (!hasText(campaign.body)) reasons.push('campaign_body_missing');
  if (!hasText(optOutUrl)) reasons.push('campaign_opt_out_missing');
  if (campaign.requiresLandingPage !== false && !hasText(campaign.landingPageUrl)) {
    reasons.push('campaign_landing_page_missing');
  }
  if (Array.isArray(campaign.attachments) && campaign.attachments.length > 0) {
    reasons.push('attachments_not_allowed_for_scale');
  }

  return { ok: reasons.length === 0, reasons };
}

function isLeadEligible(lead, suppressionSet = new Set(), seenLeadKeys = new Set()) {
  const reasons = [];
  if (!lead || typeof lead !== 'object') {
    return { ok: false, reasons: ['lead_missing'] };
  }

  const email = normaliseEmail(lead.email);
  const website = normaliseDomainName(lead.website || lead.domain);
  const leadKey = email || website || String(lead.id || '');

  if (!hasText(lead.companyName)) reasons.push('company_name_missing');
  if (!hasText(lead.website) && !hasText(lead.source)) reasons.push('lead_source_missing');
  if (!hasText(lead.relevanceReason)) reasons.push('relevance_reason_missing');
  if (lead.optedOut || lead.suppressed || lead.bounced) reasons.push('lead_suppressed');
  if (suppressionSet.has(email) || suppressionSet.has(website) || suppressionSet.has(String(lead.id || ''))) {
    reasons.push('lead_on_suppression_list');
  }
  if (leadKey && seenLeadKeys.has(leadKey)) reasons.push('duplicate_lead');
  if (leadKey && !reasons.includes('duplicate_lead')) seenLeadKeys.add(leadKey);

  return { ok: reasons.length === 0, reasons: uniqueStrings(reasons) };
}

function resolveInboxDailyLimit(inbox, policy = DEFAULT_OUTBOUND_POLICY, now = new Date()) {
  const requested = Number(inbox && inbox.dailyLimit) || policy.defaultInboxDailyLimit;
  const warnings = [];
  let limit = Math.min(requested, policy.maxDailyPerInbox);

  if (requested > policy.maxDailyPerInbox) {
    warnings.push('daily_limit_capped_to_policy');
  }

  if (inbox && inbox.rampUpStartedAt) {
    const ageDays = Math.floor((normaliseDate(now).getTime() - normaliseDate(inbox.rampUpStartedAt).getTime()) / 86400000);
    const rampLimit = rampUpLimitForAge(ageDays);
    limit = Math.min(limit, rampLimit);
    warnings.push(`ramp_up_limit_${rampLimit}`);
  }

  return { limit: Math.max(0, limit), warnings: uniqueStrings(warnings) };
}

function mergePolicy(policy = {}) {
  return {
    ...DEFAULT_OUTBOUND_POLICY,
    ...policy,
    sendWindow: {
      ...DEFAULT_OUTBOUND_POLICY.sendWindow,
      ...(policy.sendWindow || {}),
    },
    protectedSenderDomains: [
      ...new Set([
        ...DEFAULT_OUTBOUND_POLICY.protectedSenderDomains,
        ...((policy.protectedSenderDomains || []).map(normaliseDomainName)),
      ]),
    ],
  };
}

function evaluateSendWindow(date, policy) {
  if (policy.weekdaysOnly && !isBusinessDay(date, policy)) {
    return { open: false, reason: 'outside_business_days' };
  }
  if (!isInsideSendWindow(date, policy)) {
    return { open: false, reason: 'outside_send_window' };
  }
  return { open: true, reason: null };
}

function isInsideSendWindow(date, policy) {
  const parts = getZonedParts(date, policy.sendWindow.timeZone);
  const current = Number(parts.hour) * 60 + Number(parts.minute);
  const start = parseClock(policy.sendWindow.start);
  const end = parseClock(policy.sendWindow.end);
  return current >= start && current <= end;
}

function isBusinessDay(date, policy) {
  const weekday = getZonedParts(date, policy.sendWindow.timeZone).weekday;
  return weekday !== 'Sat' && weekday !== 'Sun';
}

function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: parts.weekday,
    hour: parts.hour,
    minute: parts.minute,
  };
}

function parseClock(value) {
  const [hours, minutes] = String(value || '00:00').split(':').map((part) => Number(part));
  return hours * 60 + minutes;
}

function resolveInboxDomain(inbox, domainById) {
  if (!inbox) return null;
  const explicit = inbox.domainId && domainById.get(String(inbox.domainId));
  if (explicit) return explicit;

  const domainName = normaliseDomainName(inbox.domain || emailDomain(inbox.email));
  if (!domainName) return null;

  for (const domain of domainById.values()) {
    if (normaliseDomainName(domain.name) === domainName) return domain;
  }

  return { id: domainName, name: domainName, spf: 'missing', dkim: 'missing', dmarc: 'missing' };
}

function addDomainAuthReasons(domain, reasons) {
  if (!domain) return;
  const status = domain.status || 'active';
  const spf = normaliseAuthStatus(domain.spf || domain.spfStatus);
  const dkim = normaliseAuthStatus(domain.dkim || domain.dkimStatus);
  const dmarc = normaliseAuthStatus(domain.dmarc || domain.dmarcStatus);

  if (status !== 'active') reasons.push('sender_domain_not_active');
  if (spf !== 'pass') reasons.push('spf_failed');
  if (dkim !== 'pass') reasons.push('dkim_failed');
  if (dmarc !== 'pass') reasons.push('dmarc_failed');
}

function addMetricReasons(metrics, policy, reasons, warnings) {
  if (!metrics) return;
  const bounceRate = Number(metrics.bounceRate || 0);
  const complaintRate = Number(metrics.complaintRate || 0);
  const seedSpamPlacements = Number(metrics.seedSpamPlacements || metrics.spamPlacements || 0);
  const smtpRateLimited = Boolean(metrics.smtpRateLimited);
  const providerWarning = Boolean(metrics.providerWarning);

  if (bounceRate > policy.hardBounceRateLimit) reasons.push('bounce_rate_high');
  if (complaintRate >= policy.complaintRateHardLimit) reasons.push('complaint_rate_hard_stop');
  if (complaintRate >= policy.complaintRateWarning) warnings.push('complaint_rate_warning');
  if (seedSpamPlacements > policy.seedSpamPlacementLimit) reasons.push('seed_inbox_spam_placement');
  if (smtpRateLimited) reasons.push('smtp_rate_limited');
  if (providerWarning) reasons.push('provider_warning');
}

function pickNextInbox(candidates) {
  const available = candidates
    .filter((candidate) => candidate.availableSlots > 0)
    .sort((a, b) => {
      if (a.planned !== b.planned) return a.planned - b.planned;
      return a.nextAvailableAt.getTime() - b.nextAvailableAt.getTime();
    });

  return available[0] || null;
}

function createSuppressionSet(values) {
  const set = new Set();
  if (!Array.isArray(values)) return set;
  for (const value of values) {
    if (typeof value === 'string') {
      set.add(normaliseEmail(value) || normaliseDomainName(value) || value);
    } else if (value && typeof value === 'object') {
      if (value.email) set.add(normaliseEmail(value.email));
      if (value.domain) set.add(normaliseDomainName(value.domain));
      if (value.leadId) set.add(String(value.leadId));
    }
  }
  return set;
}

function rampUpLimitForAge(ageDays) {
  if (ageDays < 14) return 0;
  if (ageDays < 21) return 5;
  if (ageDays < 28) return 10;
  if (ageDays < 35) return 15;
  if (ageDays < 56) return 20;
  return 25;
}

function getHealthFor(collection, key) {
  if (!collection || !key) return null;
  if (collection instanceof Map) return collection.get(key) || null;
  return collection[key] || null;
}

function normaliseDate(value) {
  if (value instanceof Date) return value;
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function normaliseAuthStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function normaliseEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function emailDomain(email) {
  const normalised = normaliseEmail(email);
  const atIndex = normalised.lastIndexOf('@');
  return atIndex >= 0 ? normalised.slice(atIndex + 1) : '';
}

function normaliseDomainName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

module.exports = {
  DEFAULT_OUTBOUND_POLICY,
  createOutboundDryRunPlan,
  createOutboundEnginePlan: createOutboundDryRunPlan,
  evaluateInboxReadiness,
  isLeadEligible,
  resolveInboxDailyLimit,
  validateOutboundCampaign,
};
