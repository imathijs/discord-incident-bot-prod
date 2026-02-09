const path = require('node:path');
const { JsonStore } = require('./infrastructure/persistence/JsonStore');

function createState(config) {
  const autoDeleteHours = Number(config.autoDeleteHours) || 0;
  const autoDeleteMs = autoDeleteHours > 0 ? autoDeleteHours * 60 * 60 * 1000 : 0;
  const dataDir = path.join(__dirname, '..', 'data');
  const store = new JsonStore({
    dataDir,
    initialCounter: config.incidentCounter
  });

  return {
    store,
    autoDeleteMs
  };
}

module.exports = { createState };
