const path = require("path");
const { readJsonSafe, writeJsonSafe } = require("../utils/jsonStore");

const STATE_FILE = path.join(process.cwd(), "state.json");

function getState() {
  return readJsonSafe(STATE_FILE, {
    // { [idConta]: timestampMs }
    processedContaIds: {},
    lastSyncAt: null,
  });
}

function saveState(state) {
  writeJsonSafe(STATE_FILE, state);
}

module.exports = { getState, saveState };
