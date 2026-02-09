const path = require("path");
const { readJsonSafe, writeJsonSafe } = require("../utils/jsonStore");
const { OAUTH_STATE_PATH } = require("../config");

const FILE = OAUTH_STATE_PATH
  ? path.resolve(process.cwd(), OAUTH_STATE_PATH)
  : path.join(process.cwd(), "oauth-state.json");

function getAll() {
  return readJsonSafe(FILE, { map: {} });
}

function saveState(state, accountId) {
  const all = getAll();
  all.map = all.map || {};
  all.map[String(state)] = { accountId: String(accountId || "default"), createdAt: Date.now() };
  writeJsonSafe(FILE, all);
}

function getState(state) {
  const all = getAll();
  return all?.map?.[String(state)] || null;
}

function clearState(state) {
  const all = getAll();
  if (all?.map && state) delete all.map[String(state)];
  writeJsonSafe(FILE, all);
}

module.exports = { saveState, getState, clearState };
