((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SoftoraMomentumCalendar = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const TIME_ZONE = 'Europe/Amsterdam';
  const STATE_VERSION = 2;
  const MONTH_STATE_PREFIX = 'softora_live_momentum_month_v2_';
  const LEGACY_STATE_KEY = 'softora_live_momentum_state_v1';
  const INITIAL_PERIOD_KEY = '2026-07';
  const INITIAL_START_DAY = 13;
  const monthLabelFormatter = new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric'
  });
  const shortMonthFormatter = new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'UTC',
    month: 'short'
  });

  function getAmsterdamDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    return Object.fromEntries(parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]));
  }

  function getPeriodKey(year, month) {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  }

  function getDaysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function createPeriod({ year, month }) {
    const periodDate = new Date(Date.UTC(year, month - 1, 1));
    const key = getPeriodKey(year, month);
    const label = monthLabelFormatter.format(periodDate);
    const shortLabel = shortMonthFormatter.format(periodDate).replace('.', '');
    return {
      key,
      label: label.charAt(0).toUpperCase() + label.slice(1),
      shortLabel: shortLabel.charAt(0).toUpperCase() + shortLabel.slice(1),
      year,
      month,
      startDay: key === INITIAL_PERIOD_KEY ? INITIAL_START_DAY : 1,
      lastDay: getDaysInMonth(year, month)
    };
  }

  function getCurrentPeriod(date = new Date()) {
    const { year, month } = getAmsterdamDateParts(date);
    return createPeriod({ year, month });
  }

  function getDayForPeriod(period, date = new Date()) {
    const { year, month, day } = getAmsterdamDateParts(date);
    if (year !== period.year || month !== period.month) {
      return null;
    }
    return Number.isInteger(day) && day >= 1 && day <= period.lastDay ? day : null;
  }

  function getMonthStateKey(periodKey) {
    return `${MONTH_STATE_PREFIX}${periodKey}`;
  }

  function findLatestPriorMonthStateKey(values, currentPeriodKey) {
    if (!values || typeof values !== 'object') {
      return null;
    }
    return Object.keys(values)
      .filter((key) => key.startsWith(MONTH_STATE_PREFIX))
      .map((key) => ({ key, periodKey: key.slice(MONTH_STATE_PREFIX.length) }))
      .filter(({ periodKey }) => /^\d{4}-\d{2}$/.test(periodKey) && periodKey < currentPeriodKey)
      .sort((left, right) => right.periodKey.localeCompare(left.periodKey))[0]?.key || null;
  }

  return {
    TIME_ZONE,
    STATE_VERSION,
    MONTH_STATE_PREFIX,
    LEGACY_STATE_KEY,
    INITIAL_PERIOD_KEY,
    INITIAL_START_DAY,
    getAmsterdamDateParts,
    getPeriodKey,
    getDaysInMonth,
    createPeriod,
    getCurrentPeriod,
    getDayForPeriod,
    getMonthStateKey,
    findLatestPriorMonthStateKey
  };
});
