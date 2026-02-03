const path = require("path");
const { readJsonSafe, writeJsonSafe } = require("../utils/jsonStore");

const FILE = path.join(process.cwd(), "oauth-state.json");

function saveState(state) {
  writeJsonSafe(FILE, {
    state,
    createdAt: Date.now()
  });
}

function getState() {
  return readJsonSafe(FILE, null);
}

function clearState() {
  writeJsonSafe(FILE, {});
}

module.exports = { saveState, getState, clearState };
