let appInstance = null;

function loadApp() {
  if (appInstance) return appInstance;
  const loaded = require('../server');
  appInstance = loaded && (loaded.app || loaded);
  if (typeof appInstance !== 'function') {
    throw new Error('Express app export niet gevonden in server.js');
  }
  return appInstance;
}

const app = loadApp();

module.exports = app;
module.exports.app = app;
module.exports.loadApp = loadApp;
