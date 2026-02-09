const path = require("path");
const fs = require("fs");
const { readJsonSafe, writeJsonSafe } = require("../utils/jsonStore");
const { TOKENS_PATH, BLING_ACCOUNTS } = require("../config");

const TOKENS_FILE = TOKENS_PATH
  ? path.resolve(process.cwd(), TOKENS_PATH)
  : path.join(process.cwd(), "tokens.json");

function getAllTokens() {
  return readJsonSafe(TOKENS_FILE, { accounts: {} });
}

function getTokens(accountId = "default") {
  const all = getAllTokens();
  return all?.accounts?.[String(accountId)] || null;
}

function saveTokens(accountId, tokens) {
  const id = String(accountId || "default");
  const all = getAllTokens();
  all.accounts = all.accounts || {};
  all.accounts[id] = { ...(all.accounts[id] || {}), ...(tokens || {}) };
  writeJsonSafe(TOKENS_FILE, all);
}

// Se tokens.json não existir, tenta criar a partir do .env (modo headless) para TODAS as contas
function seedTokensFromEnvIfMissing() {
  try {
    if (fs.existsSync(TOKENS_FILE)) return { seeded: false, reason: "tokens.json já existe" };

    const accounts = Array.isArray(BLING_ACCOUNTS) ? BLING_ACCOUNTS : [];
    const seededAccounts = {};

    for (const acc of accounts) {
      // Precisa pelo menos de um access_token OU refresh_token
      if (!acc?.access_token && !acc?.refresh_token) continue;
      seededAccounts[String(acc.id)] = {
        access_token: acc.access_token || "",
        refresh_token: acc.refresh_token || "",
        expires_at: acc.expires_at || 0,
      };
    }

    // Backwards: se não tem BLING_ACCOUNTS mas existe legacy env, o config já cria default.
    if (!Object.keys(seededAccounts).length) {
      return { seeded: false, reason: "sem tokens no .env" };
    }

    writeJsonSafe(TOKENS_FILE, { accounts: seededAccounts });
    return { seeded: true, accounts: Object.keys(seededAccounts) };
  } catch (e) {
    return { seeded: false, reason: e.message };
  }
}

module.exports = { getTokens, getAllTokens, saveTokens, seedTokensFromEnvIfMissing };
