const crypto = require('node:crypto');
const path = require('node:path');

const REVIEW_STAGES = Object.freeze(['D14', 'D28', 'D56']);
const REVIEW_REPORT_MAX_AGE_MS = 30 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const ALLOWED_OUTCOMES = new Set(['won', 'neutral', 'lost', 'insufficient_data']);
const ALLOWED_DECISIONS = new Set(['hold', 'iterate', 'expand', 'consolidate', 'revert']);
const ALLOWED_INDEXATION_STATUSES = new Set(['indexed', 'not_indexed', 'unknown', 'not_inspected']);

function normalizeText(value) {
  return String(value || '').trim();
}

function validDateTime(value) {
  return Boolean(normalizeText(value)) && Number.isFinite(new Date(value).getTime());
}

function validDateOnly(value) {
  const match = normalizeText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isSafeRelativePath(value) {
  const normalized = normalizeText(value);
  if (!normalized || path.isAbsolute(normalized)) return false;
  return !normalized.split(/[\\/]+/).includes('..');
}

function amsterdamDateOnly(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function digestExperimentMemory(memoryContent) {
  return crypto.createHash('sha256').update(String(memoryContent || '')).digest('hex');
}

function extractExperimentPaths(details) {
  const paths = [];
  const pattern = /(?:URL|source|supported URL)\s+`(\/[^`]+)`/gi;
  let match;
  while ((match = pattern.exec(details))) paths.push(match[1].replace(/\/+$/, '') || '/');
  return [...new Set(paths)];
}

function parseExperimentReviewSchedule(memoryContent, now = new Date()) {
  const lines = String(memoryContent || '').split(/\r?\n/);
  const lineDates = [];
  const experiments = [];
  let sectionDate = null;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^##\s+(\d{4}-\d{2}-\d{2}(?:T[^\s]+)?)/);
    if (heading) {
      sectionDate = heading[1].includes('T') ? amsterdamDateOnly(heading[1]) : heading[1];
    }
    lineDates[index] = sectionDate;
    const match = lines[index].match(/^- Experiment\s+`([^`]+)`:\s*(.*)$/);
    if (!match) continue;
    const reviewMatch = match[2].match(/\breviews?\s+(\d{4}-\d{2}-\d{2}),\s*(\d{4}-\d{2}-\d{2})\s+and\s+(\d{4}-\d{2}-\d{2})\b/i);
    if (!reviewMatch || !reviewMatch.slice(1).every(validDateOnly)) continue;
    experiments.push({
      experimentId: match[1],
      paths: extractExperimentPaths(match[2]),
      lineIndex: index,
      stages: REVIEW_STAGES.map((stage, stageIndex) => ({
        stage,
        dueAt: reviewMatch[stageIndex + 1],
      })),
    });
  }

  const completed = [];
  const completedKeys = new Set();
  for (const experiment of experiments) {
    for (let index = experiment.lineIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (
        !/\b(?:due|overdue)\b.*\b(?:reviews?|experiment outcome)\b/i.test(line)
        && !/\breached\s+D(?:14|28|56)\b/i.test(line)
      ) continue;
      const identifiesExperiment = line.includes(`\`${experiment.experimentId}\``)
        || experiment.paths.some((pathName) => line.includes(`\`${pathName}\``));
      if (!identifiesExperiment) continue;
      const completedAt = lineDates[index];
      if (!validDateOnly(completedAt)) continue;
      const explicitStages = new Set(
        [...line.matchAll(/\bD(14|28|56)\b/gi)].map((match) => `D${match[1]}`)
      );
      const eligible = experiment.stages.filter((item) => (
        item.dueAt <= completedAt && (explicitStages.size === 0 || explicitStages.has(item.stage))
      ));
      const completedStage = eligible.at(-1);
      if (!completedStage) continue;
      const key = `${experiment.experimentId}:${completedStage.stage}`;
      if (completedKeys.has(key)) continue;
      completedKeys.add(key);
      completed.push({
        experimentId: experiment.experimentId,
        stage: completedStage.stage,
        dueAt: completedStage.dueAt,
        completedAt,
        evidenceLine: index + 1,
      });
    }
  }

  const today = amsterdamDateOnly(now);
  const due = experiments.flatMap((experiment) => experiment.stages.map((item) => ({
    experimentId: experiment.experimentId,
    paths: experiment.paths,
    ...item,
  }))).filter((item) => (
    today && item.dueAt <= today && !completedKeys.has(`${item.experimentId}:${item.stage}`)
  )).sort((left, right) => (
    left.dueAt.localeCompare(right.dueAt)
      || left.experimentId.localeCompare(right.experimentId)
      || REVIEW_STAGES.indexOf(left.stage) - REVIEW_STAGES.indexOf(right.stage)
  ));

  return {
    experiments,
    completed,
    due,
    today,
  };
}

function validateMetrics(review, label, errors) {
  const metrics = review.metrics;
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
    errors.push(`${label}.metrics ontbreekt.`);
    return;
  }
  for (const field of ['nonBrandedClicks', 'nonBrandedImpressions']) {
    if (!Number.isFinite(Number(metrics[field])) || Number(metrics[field]) < 0) {
      errors.push(`${label}.metrics.${field} moet een niet-negatief getal zijn.`);
    }
  }
  if (
    metrics.averagePosition !== null
    && metrics.averagePosition !== undefined
    && (!Number.isFinite(Number(metrics.averagePosition)) || Number(metrics.averagePosition) < 0)
  ) {
    errors.push(`${label}.metrics.averagePosition moet een niet-negatief getal of null zijn.`);
  }
  if (normalizeText(metrics.baselineComparison).length < 20) {
    errors.push(`${label}.metrics.baselineComparison mist een concrete vergelijking.`);
  }
}

function validateExperimentReviewEvidence({
  memoryContent,
  evidence = {},
  report = {},
  reportPath = null,
  now = new Date(),
} = {}) {
  const errors = [];
  const nowTime = now.getTime();
  const evidenceTime = new Date(evidence.generatedAt).getTime();
  const reportTime = new Date(report.generatedAt).getTime();
  if (Number(evidence.schemaVersion) !== 1) errors.push('schemaVersion moet 1 zijn.');
  if (!validDateTime(evidence.generatedAt)) errors.push('generatedAt ontbreekt of is ongeldig.');
  if (
    validDateTime(evidence.generatedAt)
    && (evidenceTime > nowTime + CLOCK_SKEW_MS || nowTime - evidenceTime > REVIEW_REPORT_MAX_AGE_MS)
  ) {
    errors.push('generatedAt valt buiten het verse reviewvenster van 30 minuten.');
  }
  if (report.status !== 'ready') errors.push('Het gekoppelde GSC-rapport is niet ready.');
  if (!validDateTime(report.generatedAt)) errors.push('Het gekoppelde GSC-rapport mist generatedAt.');
  if (
    validDateTime(report.generatedAt)
    && (reportTime > nowTime + CLOCK_SKEW_MS || nowTime - reportTime > REVIEW_REPORT_MAX_AGE_MS)
  ) {
    errors.push('Het gekoppelde GSC-rapport is ouder dan 30 minuten of ligt in de toekomst.');
  }
  if (validDateTime(evidence.generatedAt) && validDateTime(report.generatedAt) && evidenceTime < reportTime) {
    errors.push('generatedAt van het reviewbewijs ligt voor het gekoppelde GSC-rapport.');
  }
  if (normalizeText(evidence?.sourceReport?.generatedAt) !== normalizeText(report.generatedAt)) {
    errors.push('sourceReport.generatedAt wijkt af van het actuele GSC-rapport.');
  }
  if (!isSafeRelativePath(evidence?.sourceReport?.path)) {
    errors.push('sourceReport.path moet een veilig relatief repopad zijn.');
  } else if (reportPath && normalizeText(evidence.sourceReport.path) !== normalizeText(reportPath)) {
    errors.push('sourceReport.path wijkt af van het werkelijk ingelezen GSC-rapport.');
  }
  const actualMemoryDigest = digestExperimentMemory(memoryContent);
  if (normalizeText(evidence.memoryDigest) !== actualMemoryDigest) {
    errors.push('memoryDigest wijkt af van de actuele automation memory.');
  }

  const schedule = parseExperimentReviewSchedule(memoryContent, now);
  const dueByKey = new Map(schedule.due.map((item) => [`${item.experimentId}:${item.stage}`, item]));
  const reviews = Array.isArray(evidence.reviews) ? evidence.reviews : [];
  if (!Array.isArray(evidence.reviews)) errors.push('reviews moet een array zijn.');
  const seen = new Set();
  for (let index = 0; index < reviews.length; index += 1) {
    const review = reviews[index] || {};
    const label = `reviews[${index}]`;
    const key = `${normalizeText(review.experimentId)}:${normalizeText(review.stage)}`;
    if (seen.has(key)) errors.push(`${label} is dubbel: ${key}.`);
    seen.add(key);
    const dueReview = dueByKey.get(key);
    if (!dueReview) errors.push(`${label} is niet exact nu verschuldigd: ${key}.`);
    if (dueReview && normalizeText(review.dueAt) !== dueReview.dueAt) {
      errors.push(`${label}.dueAt wijkt af van de memoryplanning.`);
    }
    if (!ALLOWED_OUTCOMES.has(normalizeText(review.outcome))) errors.push(`${label}.outcome is ongeldig.`);
    if (!ALLOWED_DECISIONS.has(normalizeText(review.decision))) errors.push(`${label}.decision is ongeldig.`);
    if (!ALLOWED_INDEXATION_STATUSES.has(normalizeText(review.indexationStatus))) {
      errors.push(`${label}.indexationStatus is ongeldig.`);
    }
    validateMetrics(review, label, errors);
    if (normalizeText(review.evidence).length < 40) errors.push(`${label}.evidence mist controleerbaar reviewbewijs.`);
    if (normalizeText(review.nextAction).length < 20) errors.push(`${label}.nextAction is te vaag.`);
  }
  for (const key of dueByKey.keys()) {
    if (!seen.has(key)) errors.push(`Verschuldigde review ontbreekt: ${key}.`);
  }

  return {
    status: errors.length ? 'blocked' : 'ready',
    errors,
    summary: {
      memoryDigest: actualMemoryDigest,
      sourceReportGeneratedAt: normalizeText(report.generatedAt) || null,
      experimentCount: schedule.experiments.length,
      completedCount: schedule.completed.length,
      dueCount: schedule.due.length,
      reviewKeys: schedule.due.map((item) => `${item.experimentId}:${item.stage}`),
    },
  };
}

module.exports = {
  ALLOWED_DECISIONS,
  ALLOWED_INDEXATION_STATUSES,
  ALLOWED_OUTCOMES,
  REVIEW_REPORT_MAX_AGE_MS,
  REVIEW_STAGES,
  digestExperimentMemory,
  parseExperimentReviewSchedule,
  validateExperimentReviewEvidence,
};
