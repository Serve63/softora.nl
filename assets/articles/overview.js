(() => {
  'use strict';
  const cards = Array.from(document.querySelectorAll('.article-card'));
  const filters = Array.from(document.querySelectorAll('[data-filter]'));
  const search = document.getElementById('article-search');
  const count = document.getElementById('result-count');
  const more = document.getElementById('load-more');
  const empty = document.getElementById('empty-state');
  const batchSize = 8;
  let activeFilter = 'all';
  let limit = batchSize;

  function normalize(value) {
    return value.toLocaleLowerCase('nl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function render() {
    const words = normalize(search.value).split(/\s+/).filter(Boolean);
    const matches = cards.filter((card) => {
      const categoryMatches = activeFilter === 'all' || card.dataset.category === activeFilter;
      return categoryMatches && words.every((word) => normalize(card.dataset.search).includes(word));
    });
    const visible = matches.slice(0, limit);
    const visibleSet = new Set(visible);
    cards.forEach((card) => { card.hidden = !visibleSet.has(card); });
    count.textContent = matches.length === 0 ? '0 artikelen' :
      visible.length + ' van ' + matches.length + (matches.length === 1 ? ' artikel' : ' artikelen');
    empty.hidden = matches.length !== 0;
    more.hidden = visible.length >= matches.length;
    filters.forEach((filter) => {
      const selected = filter.dataset.filter === activeFilter;
      filter.classList.toggle('active', selected);
      filter.setAttribute('aria-pressed', String(selected));
    });
    return matches;
  }

  filters.forEach((filter) => {
    filter.addEventListener('click', () => {
      activeFilter = filter.dataset.filter;
      limit = batchSize;
      render();
    });
  });
  search.addEventListener('input', () => { limit = batchSize; render(); });
  document.querySelector('.search').addEventListener('submit', (event) => event.preventDefault());
  more.addEventListener('click', () => {
    const previousLimit = limit;
    limit += batchSize;
    const matches = render();
    const firstNewLink = matches[previousLimit]?.querySelector('.article-copy a');
    if (firstNewLink) firstNewLink.focus({ preventScroll: true });
  });
  document.getElementById('reset-filters').addEventListener('click', () => {
    search.value = '';
    activeFilter = 'all';
    limit = batchSize;
    render();
    search.focus();
  });

  render();
})();
