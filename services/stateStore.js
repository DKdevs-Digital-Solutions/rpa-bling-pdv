const path = require("path");
const { readJsonSafe, writeJsonSafe } = require("../utils/jsonStore");
const { STATE_PATH } = require("../config");

function stateFileFor(accountId = "default") {
  const base = STATE_PATH
    ? path.resolve(process.cwd(), STATE_PATH)
    : path.join(process.cwd(), "state.json");

  // Se STATE_PATH apontar para um arquivo (ex.: ./data/state.json),
  // criamos variantes por conta: state.<accountId>.json
  const dir = path.dirname(base);
  const ext = path.extname(base) || ".json";
  const name = path.basename(base, ext);
  return path.join(dir, `${name}.${String(accountId)}${ext}`);
}

function getState(accountId = "default") {
  return readJsonSafe(stateFileFor(accountId), {
    // { [idConta]: timestampMs }
    processedContaIds: {},
    lastSyncAt: null,
    pendingPedidos: {},
  });
}

function saveState(accountId, state) {
  writeJsonSafe(stateFileFor(accountId), state);
}

module.exports = { getState, saveState };
