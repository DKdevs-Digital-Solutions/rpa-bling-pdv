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

function saveAccountMeta(accountId, meta) {
  const id = String(accountId || "default");
  const all = getAllTokens();
  all.accounts = all.accounts || {};
  all.accounts[id] = { ...(all.accounts[id] || {}), ...(meta || {}) };
  writeJsonSafe(TOKENS_FILE, all);
}

function clearOAuthError(accountId) {
  saveAccountMeta(accountId, {
    oauth_error: null,
    oauth_error_at: null,
    needs_reauth: false,
    last_refresh_ok_at: Date.now(),
  });
}

function markOAuthError(accountId, err, extra = {}) {
  const payload = err?.response?.data || err?.message || err || null;
  const type = payload?.error?.type || payload?.type || null;

  saveAccountMeta(accountId, {
    oauth_error: payload,
    oauth_error_at: Date.now(),
    needs_reauth: type === "invalid_grant",
    ...extra,
  });
}

function getEnvSeedAccounts() {
  const accounts = Array.isArray(BLING_ACCOUNTS) ? BLING_ACCOUNTS : [];
  const seededAccounts = {};

  for (const acc of accounts) {
    if (!acc?.access_token && !acc?.refresh_token) continue;
    seededAccounts[String(acc.id)] = {
      access_token: acc.access_token || "",
      refresh_token: acc.refresh_token || "",
      expires_at: acc.expires_at || 0,
    };
  }

  return seededAccounts;
}

// Compat legado: usado no boot atual
function seedTokensFromEnvIfMissing() {
  try {
    if (fs.existsSync(TOKENS_FILE)) return { seeded: false, reason: "tokens.json já existe" };

    const seededAccounts = getEnvSeedAccounts();
    if (!Object.keys(seededAccounts).length) {
      return { seeded: false, reason: "sem tokens no .env" };
    }

    writeJsonSafe(TOKENS_FILE, { accounts: seededAccounts });
    return { seeded: true, accounts: Object.keys(seededAccounts) };
  } catch (e) {
    return { seeded: false, reason: e.message };
  }
}

// Novo comportamento: sincroniza refresh/access do .env para o arquivo persistido.
// Isso resolve o caso de trocar o refresh_token no .env e o app continuar usando o antigo.
function syncTokensFromEnv(options = {}) {
  try {
    const {
      overwriteRefreshToken = true,
      overwriteAccessToken = false,
      overwriteExpiresAt = false,
    } = options;

    const seededAccounts = getEnvSeedAccounts();
    if (!Object.keys(seededAccounts).length) {
      return { synced: false, reason: "sem tokens no .env" };
    }

    const all = getAllTokens();
    all.accounts = all.accounts || {};
    const touched = [];

    for (const [accountId, envTokens] of Object.entries(seededAccounts)) {
      const current = all.accounts[accountId] || {};
      const next = { ...current };
      let changed = false;

      if (overwriteRefreshToken && envTokens.refresh_token && envTokens.refresh_token !== current.refresh_token) {
        next.refresh_token = envTokens.refresh_token;
        next.needs_reauth = false;
        next.oauth_error = null;
        next.oauth_error_at = null;
        changed = true;
      }

      if (overwriteAccessToken && envTokens.access_token && envTokens.access_token !== current.access_token) {
        next.access_token = envTokens.access_token;
        changed = true;
      }

      if (overwriteExpiresAt && envTokens.expires_at && envTokens.expires_at !== current.expires_at) {
        next.expires_at = envTokens.expires_at;
        changed = true;
      }

      if (!current.access_token && envTokens.access_token) {
        next.access_token = envTokens.access_token;
        changed = true;
      }
      if (!current.refresh_token && envTokens.refresh_token) {
        next.refresh_token = envTokens.refresh_token;
        changed = true;
      }
      if (!current.expires_at && envTokens.expires_at) {
        next.expires_at = envTokens.expires_at;
        changed = true;
      }

      if (!all.accounts[accountId]) {
        all.accounts[accountId] = next;
        changed = true;
      } else if (changed) {
        all.accounts[accountId] = next;
      }

      if (changed) touched.push(accountId);
    }

    if (!touched.length) return { synced: false, reason: "nenhum token mudou" };

    writeJsonSafe(TOKENS_FILE, all);
    return { synced: true, accounts: touched };
  } catch (e) {
    return { synced: false, reason: e.message };
  }
}

module.exports = {
  getTokens,
  getAllTokens,
  saveTokens,
  saveAccountMeta,
  clearOAuthError,
  markOAuthError,
  seedTokensFromEnvIfMissing,
  syncTokensFromEnv,
};
