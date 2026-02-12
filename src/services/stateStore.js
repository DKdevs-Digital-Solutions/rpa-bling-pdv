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
  const state = readJsonSafe(stateFileFor(accountId), {
    // { [idConta]: timestampMs }
    processedContaIds: {},
    lastSyncAt: null,
    pendingPedidos: {},
    // controle de rotação diária do cache
    cacheDate: null,
  });

  // Limpa o cache de contas já processadas todo dia à 00:00 (dia mudou).
  // Objetivo: permitir reprocessamento diário e evitar crescimento indefinido.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (state.cacheDate !== today) {
    state.cacheDate = today;
    state.processedContaIds = {};
    // Mantemos pendingPedidos: se o fluxo estiver em andamento, não queremos perder.
  }

  return state;
}

function saveState(accountId, state) {
  writeJsonSafe(stateFileFor(accountId), state);
}

module.exports = { getState, saveState };
