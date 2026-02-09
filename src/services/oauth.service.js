const axios = require("axios");
const {
  BLING_AUTH_URL,
  BLING_TOKEN_URL,
  getAccount,
} = require("../config");
const { getTokens, saveTokens } = require("./tokenStore");

const crypto = require("crypto");

function generateState() {
  return crypto.randomBytes(16).toString("hex");
}

function buildAuthUrl(accountId, state) {
  const acc = getAccount(accountId);
  if (!acc?.client_id) throw new Error(`Conta '${accountId}' sem client_id no BLING_ACCOUNTS`);
  const redirect = acc.redirect_uri;
  if (!redirect) throw new Error(`Conta '${accountId}' sem redirect_uri no BLING_ACCOUNTS`);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: acc.client_id,
    redirect_uri: redirect,
    state,
  });
  return `${BLING_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForToken(accountId, code) {
  const acc = getAccount(accountId);
  if (!acc?.client_id || !acc?.client_secret) {
    throw new Error(`Conta '${accountId}' sem client_id/client_secret no BLING_ACCOUNTS`);
  }
  const redirect = acc.redirect_uri;
  if (!redirect) throw new Error(`Conta '${accountId}' sem redirect_uri no BLING_ACCOUNTS`);

  const data = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
  });

  const basic = Buffer.from(`${acc.client_id}:${acc.client_secret}`).toString("base64");

  const resp = await axios.post(BLING_TOKEN_URL, data.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basic}`,
    },
  });

  const now = Date.now();
  const expiresIn = resp.data.expires_in ?? 3600;

  const tokens = {
    ...resp.data,
    expires_at: now + expiresIn * 1000 - 30_000,
  };

  saveTokens(accountId, tokens);
  return tokens;
}


async function refreshAccessToken(accountId, refreshToken) {
  const acc = getAccount(accountId);
  if (!acc?.client_id || !acc?.client_secret) {
    throw new Error(`Conta '${accountId}' sem client_id/client_secret no BLING_ACCOUNTS`);
  }
  const data = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const basic = Buffer.from(`${acc.client_id}:${acc.client_secret}`).toString("base64");

  const resp = await axios.post(BLING_TOKEN_URL, data.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basic}`,
    },
  });

  const now = Date.now();
  const expiresIn = resp.data.expires_in ?? 3600;

  const tokens = {
    ...resp.data,
    // se o Bling rotacionar, salva o novo; se não, mantém o antigo
    refresh_token: resp.data.refresh_token || refreshToken,
    expires_at: now + expiresIn * 1000 - 30_000,
  };

  saveTokens(accountId, tokens);
  return tokens;
}


async function getValidAccessToken(accountId = "default") {
  const tokens = getTokens(accountId);
  if (!tokens?.access_token && !tokens?.refresh_token) {
    throw new Error(
      `Sem tokens para '${accountId}': faça OAuth em /auth/start?account=${encodeURIComponent(
        accountId
      )} ou informe refresh_token no BLING_ACCOUNTS`
    );
  }

  if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at) return tokens.access_token;

  if (tokens.refresh_token) {
    const newTokens = await refreshAccessToken(accountId, tokens.refresh_token);
    return newTokens.access_token;
  }

  throw new Error("Sem refresh_token. Informe BLING_REFRESH_TOKEN no .env ou faça OAuth.");
}

module.exports = { buildAuthUrl, generateState, exchangeCodeForToken, getValidAccessToken };
