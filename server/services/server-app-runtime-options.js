const foundationOptions = require('./server-app-runtime-foundation-options');
const featureOptions = require('./server-app-runtime-feature-options');
const uiContentOptions = require('./server-app-runtime-ui-content-options');

module.exports = {
  ...foundationOptions,
  ...featureOptions,
  ...uiContentOptions,
};
