const path = require("path");
const fs = require("fs");
const { readJsonSafe, writeJsonSafe } = require("../utils/jsonStore");
const { BLING_ACCESS_TOKEN, BLING_REFRESH_TOKEN, BLING_EXPIRES_AT } = require("../config");

const TOKENS_FILE = path.join(process.cwd(), "tokens.json");

function getTokens() {
  return readJsonSafe(TOKENS_FILE, null);
}

function saveTokens(tokens) {
  writeJsonSafe(TOKENS_FILE, tokens);
}

// Se tokens.json não existir, tenta criar a partir do .env (modo headless)
function seedTokensFromEnvIfMissing() {
  try {
    if (fs.existsSync(TOKENS_FILE)) return { seeded: false, reason: "tokens.json já existe" };

    // Precisa pelo menos de um access_token OU refresh_token
    if (!BLING_ACCESS_TOKEN && !BLING_REFRESH_TOKEN) {
      return { seeded: false, reason: "sem tokens no .env" };
    }

    const tokens = {
      access_token: BLING_ACCESS_TOKEN || "",
      refresh_token: BLING_REFRESH_TOKEN || "",
      expires_at: BLING_EXPIRES_AT || 0,
    };

    saveTokens(tokens);
    return { seeded: true };
  } catch (e) {
    return { seeded: false, reason: e.message };
  }
}

module.exports = { getTokens, saveTokens, seedTokensFromEnvIfMissing };
