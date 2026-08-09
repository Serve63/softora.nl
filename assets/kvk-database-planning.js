(function initKvkPlanningViewport(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', () => api.mount(root), { once: true });
    } else {
      api.mount(root);
    }
  }
})(typeof window === 'object' ? window : null, function createKvkPlanningViewport() {
  'use strict';

  function planningViewportState(list) {
    const children = Array.from(list?.children || []);
    const hasLocations = children.some((child) => !child?.classList?.contains?.('location-empty'));
    if (!hasLocations) return 'loading';
    const scrollTop = Math.max(0, Number(list?.scrollTop) || 0);
    const clientHeight = Math.max(0, Number(list?.clientHeight) || 0);
    const scrollHeight = Math.max(0, Number(list?.scrollHeight) || 0);
    return scrollTop + clientHeight >= scrollHeight - 2 ? 'end' : 'more';
  }

  function planningViewportLabel(state) {
    if (state === 'end') return 'Einde planning bereikt';
    if (state === 'more') return 'Meer locaties hieronder';
    return 'Planning wordt geladen';
  }

  function mount(browserWindow) {
    const document = browserWindow?.document;
    const list = document?.getElementById('location-list');
    const status = document?.getElementById('planning-scroll-status');
    const label = document?.getElementById('planning-scroll-status-label');
    if (!list || !status || !label) return null;

    const update = () => {
      const state = planningViewportState(list);
      status.dataset.state = state;
      label.textContent = planningViewportLabel(state);
      return state;
    };

    list.addEventListener('scroll', update, { passive: true });
    browserWindow.addEventListener?.('resize', update);
    const Observer = browserWindow.MutationObserver;
    const observer = typeof Observer === 'function' ? new Observer(update) : null;
    observer?.observe(list, { childList: true });
    update();

    return {
      update,
      destroy() {
        list.removeEventListener?.('scroll', update);
        browserWindow.removeEventListener?.('resize', update);
        observer?.disconnect();
      },
    };
  }

  return { mount, planningViewportLabel, planningViewportState };
});
