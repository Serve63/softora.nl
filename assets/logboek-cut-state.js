(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LogboekCutState = api;
})(typeof window === 'object' ? window : globalThis, () => {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  function dateKey(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const part = (name) => parts.find(p => p.type === name).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function weekday(date) { return days[new Date(`${date}T12:00:00Z`).getUTCDay()]; }
  function setKey(order, set) { return `${order}:${set}`; }
  function done(session, order, set) { return session?.checks?.[setKey(order, set)]?.done === true; }
  function progress(session) {
    let total = 0, completed = 0;
    for (const row of session?.exercises || []) {
      for (let i = 0; i < row.sets; i++) { total++; if (done(session, row.order, i)) completed++; }
    }
    return { total, completed, percent: total ? Math.round(100 * completed / total) : 0 };
  }
  return { dateKey, weekday, setKey, done, progress };
});
