(function (global) {
  'use strict';

  function sortExtraSettingsItems(items) {
    const source = Array.isArray(items) ? items.filter(Boolean) : [];
    return source.filter((item) => item.unlocked === true)
      .concat(source.filter((item) => item.unlocked !== true));
  }

  const api = { sortExtraSettingsItems };
  global.SoftoraPremiumExtraModules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
