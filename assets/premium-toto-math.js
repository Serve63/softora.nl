(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraTotoMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_CONFIG = Object.freeze({
    startBankroll: 10,
    targetBankroll: 100000,
    startDate: '2026-07-26',
    targetDate: '2027-07-26',
    evidenceTarget: 200,
    maxStakePct: 2,
    maxDailyRiskPct: 5,
    maxOpenRiskPct: 8,
    minEdgePoints: 3,
    minExpectedValuePct: 2
  });
  var VALID_STATUSES = new Set(['pending', 'won', 'lost', 'void']);

  function finiteNumber(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function roundMoney(value) {
    return Math.round((finiteNumber(value, 0) + Number.EPSILON) * 100) / 100;
  }

  function roundMetric(value, digits) {
    var power = Math.pow(10, Math.max(0, finiteNumber(digits, 2)));
    return Math.round((finiteNumber(value, 0) + Number.EPSILON) * power) / power;
  }

  function safeText(value, maximumLength) {
    return String(value || '').trim().slice(0, maximumLength);
  }

  function normalizeDate(value, fallback) {
    var normalized = safeText(value, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : fallback;
  }

  function normalizeConfig(value) {
    var source = value && typeof value === 'object' ? value : {};
    var startBankroll = clamp(finiteNumber(source.startBankroll, DEFAULT_CONFIG.startBankroll), 0.01, 1000000);
    var targetBankroll = clamp(
      finiteNumber(source.targetBankroll, DEFAULT_CONFIG.targetBankroll),
      startBankroll,
      1000000000
    );
    return {
      startBankroll: roundMoney(startBankroll),
      targetBankroll: roundMoney(targetBankroll),
      startDate: normalizeDate(source.startDate, DEFAULT_CONFIG.startDate),
      targetDate: normalizeDate(source.targetDate, DEFAULT_CONFIG.targetDate),
      evidenceTarget: Math.round(clamp(finiteNumber(source.evidenceTarget, DEFAULT_CONFIG.evidenceTarget), 30, 10000)),
      maxStakePct: clamp(finiteNumber(source.maxStakePct, DEFAULT_CONFIG.maxStakePct), 0.1, 5),
      maxDailyRiskPct: clamp(finiteNumber(source.maxDailyRiskPct, DEFAULT_CONFIG.maxDailyRiskPct), 0.5, 10),
      maxOpenRiskPct: clamp(finiteNumber(source.maxOpenRiskPct, DEFAULT_CONFIG.maxOpenRiskPct), 0.5, 15),
      minEdgePoints: clamp(finiteNumber(source.minEdgePoints, DEFAULT_CONFIG.minEdgePoints), 0, 25),
      minExpectedValuePct: clamp(
        finiteNumber(source.minExpectedValuePct, DEFAULT_CONFIG.minExpectedValuePct),
        0,
        50
      )
    };
  }

  function normalizeEntry(value, index) {
    var source = value && typeof value === 'object' ? value : {};
    var createdAt = safeText(source.createdAt, 32);
    var status = safeText(source.status, 12).toLowerCase();
    return {
      id: safeText(source.id, 80) || 'legacy-' + String(index + 1),
      createdAt: createdAt && !Number.isNaN(Date.parse(createdAt)) ? createdAt : new Date(0).toISOString(),
      eventDate: normalizeDate(source.eventDate, ''),
      competition: safeText(source.competition, 80),
      event: safeText(source.event, 140),
      market: safeText(source.market, 100),
      selection: safeText(source.selection, 100),
      odds: clamp(finiteNumber(source.odds, 0), 0, 1000),
      closingOdds: source.closingOdds === null || source.closingOdds === ''
        ? null
        : clamp(finiteNumber(source.closingOdds, 0), 0, 1000),
      modelProbability: clamp(finiteNumber(source.modelProbability, 0), 0, 1),
      stake: roundMoney(clamp(finiteNumber(source.stake, 0), 0, 1000000)),
      status: VALID_STATUSES.has(status) ? status : 'pending',
      resolvedAt: safeText(source.resolvedAt, 32),
      note: safeText(source.note, 500)
    };
  }

  function normalizeState(value) {
    var source = value && typeof value === 'object' ? value : {};
    var entries = Array.isArray(source.entries) ? source.entries : [];
    return {
      version: 1,
      config: normalizeConfig(source.config),
      entries: entries.slice(0, 5000).map(normalizeEntry)
    };
  }

  function getEntryProfit(entry) {
    if (!entry || entry.status === 'pending' || entry.status === 'void') return 0;
    if (entry.status === 'won') return roundMoney(entry.stake * (entry.odds - 1));
    if (entry.status === 'lost') return roundMoney(-entry.stake);
    return 0;
  }

  function getEntryExpectedValuePct(entry) {
    if (!entry || entry.odds <= 1 || entry.modelProbability <= 0) return 0;
    return (entry.modelProbability * entry.odds - 1) * 100;
  }

  function getEntryEdgePoints(entry) {
    if (!entry || entry.odds <= 1) return 0;
    return (entry.modelProbability - (1 / entry.odds)) * 100;
  }

  function getEntryClvPct(entry) {
    if (!entry || !entry.closingOdds || entry.closingOdds <= 1 || entry.odds <= 1) return null;
    return ((entry.odds / entry.closingOdds) - 1) * 100;
  }

  function calendarDaysBetween(startDate, targetDate) {
    var start = Date.parse(startDate + 'T00:00:00Z');
    var target = Date.parse(targetDate + 'T00:00:00Z');
    if (!Number.isFinite(start) || !Number.isFinite(target) || target <= start) return 365;
    return Math.max(1, Math.round((target - start) / 86400000));
  }

  function requiredCompoundRate(startValue, targetValue, periods) {
    var start = finiteNumber(startValue, 0);
    var target = finiteNumber(targetValue, 0);
    var safePeriods = Math.max(1, Math.round(finiteNumber(periods, 1)));
    if (start <= 0 || target < start) return 0;
    return Math.pow(target / start, 1 / safePeriods) - 1;
  }

  function getCalibrationError(entries) {
    var groups = Array.from({ length: 10 }, function () {
      return { count: 0, probabilityTotal: 0, outcomeTotal: 0 };
    });
    entries.forEach(function (entry) {
      var groupIndex = Math.min(9, Math.floor(entry.modelProbability * 10));
      groups[groupIndex].count += 1;
      groups[groupIndex].probabilityTotal += entry.modelProbability;
      groups[groupIndex].outcomeTotal += entry.status === 'won' ? 1 : 0;
    });
    if (!entries.length) return null;
    var weightedError = groups.reduce(function (total, group) {
      if (!group.count) return total;
      var forecast = group.probabilityTotal / group.count;
      var outcome = group.outcomeTotal / group.count;
      return total + (Math.abs(forecast - outcome) * group.count);
    }, 0);
    return weightedError / entries.length;
  }

  function computeCalibrationBins(rawState) {
    var state = normalizeState(rawState);
    var groups = Array.from({ length: 5 }, function (_unused, index) {
      return {
        label: String(index * 20) + '–' + String((index + 1) * 20) + '%',
        count: 0,
        probabilityTotal: 0,
        outcomeTotal: 0
      };
    });
    state.entries
      .filter(function (entry) { return entry.status === 'won' || entry.status === 'lost'; })
      .forEach(function (entry) {
        var groupIndex = Math.min(4, Math.floor(entry.modelProbability * 5));
        groups[groupIndex].count += 1;
        groups[groupIndex].probabilityTotal += entry.modelProbability;
        groups[groupIndex].outcomeTotal += entry.status === 'won' ? 1 : 0;
      });
    return groups.map(function (group) {
      return {
        label: group.label,
        count: group.count,
        predictedPct: group.count ? roundMetric((group.probabilityTotal / group.count) * 100, 1) : null,
        observedPct: group.count ? roundMetric((group.outcomeTotal / group.count) * 100, 1) : null
      };
    });
  }

  function cohortKeyForEntry(entry, dimension) {
    if (dimension === 'competition') return entry.competition || 'Onbekende competitie';
    if (dimension === 'odds') {
      if (entry.odds < 1.6) return '1,02–1,59';
      if (entry.odds < 2) return '1,60–1,99';
      if (entry.odds < 3) return '2,00–2,99';
      return '3,00+';
    }
    return entry.market || 'Onbekende markt';
  }

  function computeCohorts(rawState, dimension) {
    var state = normalizeState(rawState);
    var buckets = new Map();
    state.entries
      .filter(function (entry) { return entry.status === 'won' || entry.status === 'lost'; })
      .forEach(function (entry) {
        var key = cohortKeyForEntry(entry, dimension);
        var bucket = buckets.get(key) || {
          label: key,
          count: 0,
          wins: 0,
          staked: 0,
          profit: 0,
          brierTotal: 0,
          clvTotal: 0,
          clvCount: 0
        };
        var outcome = entry.status === 'won' ? 1 : 0;
        var clv = getEntryClvPct(entry);
        bucket.count += 1;
        bucket.wins += outcome;
        bucket.staked += entry.stake;
        bucket.profit += getEntryProfit(entry);
        bucket.brierTotal += Math.pow(entry.modelProbability - outcome, 2);
        if (clv !== null) {
          bucket.clvTotal += clv;
          bucket.clvCount += 1;
        }
        buckets.set(key, bucket);
      });
    return Array.from(buckets.values())
      .map(function (bucket) {
        return {
          label: bucket.label,
          count: bucket.count,
          hitRatePct: roundMetric((bucket.wins / bucket.count) * 100, 1),
          roiPct: bucket.staked ? roundMetric((bucket.profit / bucket.staked) * 100, 1) : 0,
          profit: roundMoney(bucket.profit),
          brierScore: roundMetric(bucket.brierTotal / bucket.count, 3),
          averageClvPct: bucket.clvCount ? roundMetric(bucket.clvTotal / bucket.clvCount, 1) : null
        };
      })
      .sort(function (a, b) {
        return b.count - a.count || b.roiPct - a.roiPct || a.label.localeCompare(b.label);
      });
  }

  function getProofStatus(metrics, config) {
    if (metrics.settledCount < 30) {
      return {
        code: 'unproven',
        label: 'Onbewezen',
        detail: 'Te weinig gesloten voorspellingen voor een serieuze conclusie.'
      };
    }
    if (metrics.settledCount < config.evidenceTarget) {
      return {
        code: 'early',
        label: 'Vroege steekproef',
        detail: 'Interessant voor foutanalyse, nog niet sterk genoeg voor een edge-claim.'
      };
    }
    if (metrics.roiPct <= 0 || metrics.averageClvPct === null || metrics.averageClvPct <= 0) {
      return {
        code: 'no-edge',
        label: 'Geen bewezen edge',
        detail: 'De steekproef is groot genoeg, maar rendement en/of closing-line value overtuigt niet.'
      };
    }
    return {
      code: 'provisional',
      label: 'Voorlopig bewijs',
      detail: 'Positief forward resultaat en closing-line value; onafhankelijke herhaling blijft nodig.'
    };
  }

  function computeMetrics(rawState) {
    var state = normalizeState(rawState);
    var config = state.config;
    var sortedEntries = state.entries.slice().sort(function (a, b) {
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    });
    var settled = sortedEntries.filter(function (entry) {
      return entry.status === 'won' || entry.status === 'lost';
    });
    var pending = sortedEntries.filter(function (entry) { return entry.status === 'pending'; });
    var profit = 0;
    var totalStaked = 0;
    var peak = config.startBankroll;
    var balance = config.startBankroll;
    var maxDrawdown = 0;

    settled.forEach(function (entry) {
      totalStaked += entry.stake;
      profit += getEntryProfit(entry);
      balance = config.startBankroll + profit;
      peak = Math.max(peak, balance);
      if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - balance) / peak);
    });

    var wins = settled.filter(function (entry) { return entry.status === 'won'; }).length;
    var brier = settled.length
      ? settled.reduce(function (total, entry) {
        var outcome = entry.status === 'won' ? 1 : 0;
        return total + Math.pow(entry.modelProbability - outcome, 2);
      }, 0) / settled.length
      : null;
    var clvValues = settled.map(getEntryClvPct).filter(function (value) { return value !== null; });
    var openRisk = pending.reduce(function (total, entry) { return total + entry.stake; }, 0);
    var days = calendarDaysBetween(config.startDate, config.targetDate);
    var requiredDailyRate = requiredCompoundRate(config.startBankroll, config.targetBankroll, days);
    var currentBankroll = roundMoney(config.startBankroll + profit);
    var targetProgress = config.targetBankroll === config.startBankroll
      ? 1
      : clamp(
        (Math.log(Math.max(currentBankroll, 0.01)) - Math.log(config.startBankroll)) /
          (Math.log(config.targetBankroll) - Math.log(config.startBankroll)),
        0,
        1
      );

    var metrics = {
      currentBankroll: currentBankroll,
      availableBankroll: roundMoney(Math.max(0, currentBankroll - openRisk)),
      profit: roundMoney(profit),
      totalStaked: roundMoney(totalStaked),
      openRisk: roundMoney(openRisk),
      settledCount: settled.length,
      pendingCount: pending.length,
      wins: wins,
      losses: settled.length - wins,
      hitRatePct: settled.length ? roundMetric((wins / settled.length) * 100, 1) : null,
      roiPct: totalStaked ? roundMetric((profit / totalStaked) * 100, 1) : 0,
      brierScore: brier === null ? null : roundMetric(brier, 3),
      calibrationErrorPct: brier === null ? null : roundMetric(getCalibrationError(settled) * 100, 1),
      averageClvPct: clvValues.length
        ? roundMetric(clvValues.reduce(function (sum, value) { return sum + value; }, 0) / clvValues.length, 1)
        : null,
      maxDrawdownPct: roundMetric(maxDrawdown * 100, 1),
      requiredDailyGrowthPct: roundMetric(requiredDailyRate * 100, 2),
      requiredThirtyDayGrowthPct: roundMetric((Math.pow(1 + requiredDailyRate, 30) - 1) * 100, 1),
      targetProgressPct: roundMetric(targetProgress * 100, 2),
      evidenceProgressPct: roundMetric(clamp(settled.length / config.evidenceTarget, 0, 1) * 100, 1)
    };
    metrics.proof = getProofStatus(metrics, config);
    return metrics;
  }

  function datePartFromIso(value) {
    var parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : '';
  }

  function getRiskSnapshot(rawState, nowIso) {
    var state = normalizeState(rawState);
    var metrics = computeMetrics(state);
    var today = datePartFromIso(nowIso) || new Date().toISOString().slice(0, 10);
    var dailyRiskUsed = state.entries.reduce(function (total, entry) {
      return datePartFromIso(entry.createdAt) === today && entry.status !== 'void'
        ? total + entry.stake
        : total;
    }, 0);
    var singleCap = metrics.currentBankroll * (state.config.maxStakePct / 100);
    var dailyRemaining = (metrics.currentBankroll * (state.config.maxDailyRiskPct / 100)) - dailyRiskUsed;
    var openRemaining = (metrics.currentBankroll * (state.config.maxOpenRiskPct / 100)) - metrics.openRisk;
    return {
      today: today,
      dailyRiskUsed: roundMoney(dailyRiskUsed),
      singleCap: roundMoney(Math.max(0, singleCap)),
      dailyRemaining: roundMoney(Math.max(0, dailyRemaining)),
      openRemaining: roundMoney(Math.max(0, openRemaining)),
      maxAllowedStake: roundMoney(Math.max(
        0,
        Math.min(singleCap, dailyRemaining, openRemaining, metrics.availableBankroll)
      ))
    };
  }

  function validateDraft(rawDraft, rawState, nowIso) {
    var state = normalizeState(rawState);
    var draft = normalizeEntry(Object.assign({}, rawDraft, {
      id: 'draft',
      createdAt: nowIso || new Date().toISOString(),
      status: 'pending'
    }), 0);
    var errors = [];
    if (!draft.eventDate) errors.push('Kies een wedstrijddatum.');
    if (draft.event.length < 3) errors.push('Vul de wedstrijd of het event in.');
    if (draft.market.length < 2) errors.push('Vul de markt in.');
    if (draft.selection.length < 1) errors.push('Vul de paper-selectie in.');
    if (/(?:\bcombi\b|\bparlay\b|\bacca\b|bet builder)/i.test(draft.market + ' ' + draft.selection)) {
      errors.push('Combi’s en bet builders vallen buiten deze bewijsrails.');
    }
    if (draft.odds <= 1.01 || draft.odds > 50) errors.push('Decimal odds moeten tussen 1,02 en 50 liggen.');
    if (draft.modelProbability < 0.01 || draft.modelProbability > 0.995) {
      errors.push('Modelkans moet tussen 1% en 99,5% liggen.');
    }
    if (draft.stake <= 0) errors.push('Vul een virtuele inzet boven €0 in.');

    var edgePoints = getEntryEdgePoints(draft);
    var expectedValuePct = getEntryExpectedValuePct(draft);
    if (draft.odds > 1.01 && edgePoints < state.config.minEdgePoints) {
      errors.push('De model-edge is lager dan de ingestelde bewijsgrens van ' + state.config.minEdgePoints + ' procentpunt.');
    }
    if (draft.odds > 1.01 && expectedValuePct < state.config.minExpectedValuePct) {
      errors.push('De verwachte waarde is lager dan de ingestelde bewijsgrens van ' + state.config.minExpectedValuePct + '%.');
    }

    var risk = getRiskSnapshot(state, nowIso);
    if (draft.stake > risk.maxAllowedStake + 0.001) {
      errors.push('De virtuele inzet overschrijdt de actieve risicogrens van €' + risk.maxAllowedStake.toFixed(2) + '.');
    }

    var duplicate = state.entries.some(function (entry) {
      return entry.eventDate === draft.eventDate &&
        entry.event.toLowerCase() === draft.event.toLowerCase() &&
        entry.market.toLowerCase() === draft.market.toLowerCase() &&
        entry.selection.toLowerCase() === draft.selection.toLowerCase();
    });
    if (duplicate) errors.push('Deze paper-voorspelling staat al in het forward log.');

    return {
      ok: errors.length === 0,
      errors: errors,
      entry: draft,
      edgePoints: roundMetric(edgePoints, 1),
      expectedValuePct: roundMetric(expectedValuePct, 1),
      impliedProbabilityPct: draft.odds > 1 ? roundMetric((1 / draft.odds) * 100, 1) : 0,
      risk: risk
    };
  }

  return {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    calendarDaysBetween: calendarDaysBetween,
    computeCalibrationBins: computeCalibrationBins,
    computeCohorts: computeCohorts,
    computeMetrics: computeMetrics,
    getEntryClvPct: getEntryClvPct,
    getEntryEdgePoints: getEntryEdgePoints,
    getEntryExpectedValuePct: getEntryExpectedValuePct,
    getEntryProfit: getEntryProfit,
    getRiskSnapshot: getRiskSnapshot,
    normalizeConfig: normalizeConfig,
    normalizeState: normalizeState,
    requiredCompoundRate: requiredCompoundRate,
    roundMoney: roundMoney,
    validateDraft: validateDraft
  };
});
