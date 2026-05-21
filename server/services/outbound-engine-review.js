'use strict';

function createDryRunReview(input = {}) {
  const plan = input.plan && typeof input.plan === 'object' ? input.plan : {};
  const jobs = Array.isArray(plan.jobs) ? plan.jobs : [];
  const approvedJobIds = new Set(Array.isArray(input.approvedJobIds) ? input.approvedJobIds : []);
  const rejectedJobIds = new Set(Array.isArray(input.rejectedJobIds) ? input.rejectedJobIds : []);
  const reviewer = String(input.reviewer || '').trim();
  const now = normaliseDate(input.now);
  const items = jobs.map((job) => createReviewItem(job, approvedJobIds, rejectedJobIds));
  const approvedJobs = items.filter((item) => item.status === 'approved').length;
  const rejectedJobs = items.filter((item) => item.status === 'rejected').length;
  const pendingJobs = items.filter((item) => item.status === 'pending').length;
  const blockers = [];

  if (!jobs.length) blockers.push('no_dry_run_jobs');
  if (!reviewer) blockers.push('reviewer_missing');
  if (pendingJobs > 0) blockers.push('dry_run_jobs_pending_review');
  if (rejectedJobs > 0) blockers.push('dry_run_jobs_rejected');

  return {
    ok: blockers.length === 0,
    dryRun: true,
    canSendRealMail: false,
    reviewer,
    reviewedAt: now.toISOString(),
    items,
    approvalEvent: blockers.length === 0
      ? createApprovalEvent(reviewer, now)
      : null,
    summary: {
      totalJobs: jobs.length,
      approvedJobs,
      rejectedJobs,
      pendingJobs,
      blockers,
      canSendRealMail: false,
    },
  };
}

function createReviewItem(job, approvedJobIds, rejectedJobIds) {
  const id = String(job.id || '');
  const status = rejectedJobIds.has(id) ? 'rejected' : approvedJobIds.has(id) ? 'approved' : 'pending';

  return {
    id,
    status,
    requiresHumanApproval: true,
    preview: {
      senderEmail: job.senderEmail || '',
      senderDomain: job.senderDomain || '',
      leadId: job.leadId || null,
      leadEmail: job.leadEmail || '',
      campaignId: job.campaignId || null,
      scheduledAt: job.scheduledAt || null,
    },
    safetyChecks: Array.isArray(job.safetyChecks) ? job.safetyChecks : [],
  };
}

function createApprovalEvent(reviewer, now) {
  return {
    type: 'operation_connected',
    createdAt: now.toISOString(),
    payload: {
      name: 'dryRunReviewedByHuman',
      connected: true,
      reviewer,
    },
  };
}

function normaliseDate(value) {
  if (value instanceof Date) return value;
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

module.exports = {
  createDryRunReview,
};
