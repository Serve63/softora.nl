((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraMomentumHistory = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const TIME_ZONE = 'Europe/Amsterdam';
  const MONTH_STATE_PREFIX = 'softora_live_momentum_month_v2_';
  const MAX_MONTHS = 120;

  function clampDay(value, lastDay) {
    const day = Number(value);
    return Number.isInteger(day) && day >= 1 && day <= lastDay ? day : null;
  }

  function uniqueDays(values, lastDay) {
    return Array.from(new Set((Array.isArray(values) ? values : [])
      .map((value) => clampDay(value, lastDay))
      .filter(Boolean)))
      .sort((left, right) => left - right);
  }

  function getDaysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function parsePeriodKey(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isInteger(year) || month < 1 || month > 12) return null;
    return { key: `${match[1]}-${match[2]}`, year, month, lastDay: getDaysInMonth(year, month) };
  }

  function getAmsterdamDateParts(date = new Date()) {
    return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]));
  }

  function monthLabel(period) {
    const label = new Intl.DateTimeFormat('nl-NL', {
      timeZone: 'UTC',
      month: 'short',
      year: 'numeric'
    }).format(new Date(Date.UTC(period.year, period.month - 1, 1))).replace('.', '');
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function normalizeGoal(goal, period) {
    const evidenceDays = uniqueDays([
      ...(goal?.touchedDays || []),
      ...(goal?.trackedDays || []),
      ...(goal?.doneDays || []),
      ...(goal?.emptyDays || [])
    ], period.lastDay);
    const explicitStart = clampDay(goal?.activeFromDay, period.lastDay);
    const explicitEnd = clampDay(goal?.activeUntilDay, period.lastDay);
    const activeFromDay = explicitStart || evidenceDays[0] || null;
    return {
      activeFromDay,
      activeUntilDay: explicitEnd || period.lastDay,
      doneDays: uniqueDays(goal?.doneDays, period.lastDay)
    };
  }

  function parseSnapshot(rawValue, expectedPeriodKey) {
    try {
      const value = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
      const period = parsePeriodKey(value?.period || expectedPeriodKey);
      if (!period || period.key !== expectedPeriodKey || !Array.isArray(value?.goals)) return null;
      const goals = [...value.goals, ...(Array.isArray(value.retiredGoals) ? value.retiredGoals : [])]
        .map((goal) => normalizeGoal(goal, period))
        .filter((goal) => goal.activeFromDay);
      return { period, goals };
    } catch (_error) {
      return null;
    }
  }

  function readSnapshots(values = {}) {
    return Object.keys(values || {})
      .filter((key) => key.startsWith(MONTH_STATE_PREFIX))
      .map((key) => {
        const periodKey = key.slice(MONTH_STATE_PREFIX.length);
        return parseSnapshot(values[key], periodKey);
      })
      .filter(Boolean)
      .sort((left, right) => left.period.key.localeCompare(right.period.key))
      .slice(-MAX_MONTHS);
  }

  function scoreDay(snapshot, day) {
    const activeGoals = snapshot.goals.filter((goal) => (
      goal.activeFromDay <= day && goal.activeUntilDay >= day
    ));
    if (!activeGoals.length) return null;
    const completed = activeGoals.filter((goal) => goal.doneDays.includes(day)).length;
    return {
      day,
      completed,
      total: activeGoals.length,
      score: (completed / activeGoals.length) * 100
    };
  }

  function getFirstTrackedDate(snapshots) {
    for (const snapshot of snapshots) {
      const firstDay = snapshot.goals.reduce((minimum, goal) => (
        minimum === null || goal.activeFromDay < minimum ? goal.activeFromDay : minimum
      ), null);
      if (firstDay !== null) return { ...snapshot.period, day: firstDay };
    }
    return null;
  }

  function buildMonthlyAverages(values = {}, now = new Date()) {
    const snapshots = readSnapshots(values);
    const firstTrackedDate = getFirstTrackedDate(snapshots);
    if (!firstTrackedDate) return { startDate: null, months: [] };

    const today = getAmsterdamDateParts(now);
    const todayKey = `${String(today.year).padStart(4, '0')}-${String(today.month).padStart(2, '0')}`;
    const months = snapshots
      .filter((snapshot) => snapshot.period.key >= firstTrackedDate.key && snapshot.period.key <= todayKey)
      .map((snapshot) => {
        const startDay = snapshot.period.key === firstTrackedDate.key ? firstTrackedDate.day : 1;
        const endDay = snapshot.period.key === todayKey ? Math.min(today.day, snapshot.period.lastDay) : snapshot.period.lastDay;
        const days = [];
        for (let day = startDay; day <= endDay; day += 1) {
          const score = scoreDay(snapshot, day);
          if (score) days.push(score);
        }
        const average = days.length
          ? days.reduce((total, entry) => total + entry.score, 0) / days.length
          : null;
        return {
          key: snapshot.period.key,
          label: monthLabel(snapshot.period),
          average,
          dayCount: days.length,
          startDay,
          endDay,
          isCurrent: snapshot.period.key === todayKey,
          days
        };
      });

    return {
      startDate: `${firstTrackedDate.key}-${String(firstTrackedDate.day).padStart(2, '0')}`,
      months
    };
  }

  function formatAverage(value) {
    if (!Number.isFinite(value)) return '—';
    return `${Number(value.toFixed(2)).toLocaleString('nl-NL', { maximumFractionDigits: 2 })}%`;
  }

  return {
    TIME_ZONE,
    MONTH_STATE_PREFIX,
    MAX_MONTHS,
    buildMonthlyAverages,
    formatAverage,
    getAmsterdamDateParts,
    parseSnapshot,
    readSnapshots,
    scoreDay
  };
});
