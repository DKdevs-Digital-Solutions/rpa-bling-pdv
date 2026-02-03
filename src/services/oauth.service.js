const axios = require("axios");
const {
  BLING_CLIENT_ID,
  BLING_CLIENT_SECRET,
  BLING_REDIRECT_URI,
  BLING_AUTH_URL,
  BLING_TOKEN_URL,
} = require("../config");
const { getTokens, saveTokens } = require("./tokenStore");

const crypto = require("crypto");

function generateState() {
  return crypto.randomBytes(16).toString("hex");
}

function buildAuthUrl(state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: BLING_CLIENT_ID,
    redirect_uri: BLING_REDIRECT_URI,
    state,
  });
  return `${BLING_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const data = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: BLING_REDIRECT_URI,
  });

  const basic = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString("base64");

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

  saveTokens(tokens);
  return tokens;
}


async function refreshAccessToken(refreshToken) {
  const data = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const basic = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString("base64");

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

  saveTokens(tokens);
  return tokens;
}


async function getValidAccessToken() {
  const tokens = getTokens();
  if (!tokens?.access_token && !tokens?.refresh_token) {
    throw new Error("Sem tokens: faça OAuth em /auth/start ou informe BLING_REFRESH_TOKEN no .env");
  }

  if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at) return tokens.access_token;

  if (tokens.refresh_token) {
    const newTokens = await refreshAccessToken(tokens.refresh_token);
    return newTokens.access_token;
  }

  throw new Error("Sem refresh_token. Informe BLING_REFRESH_TOKEN no .env ou faça OAuth.");
}

module.exports = { buildAuthUrl, generateState, exchangeCodeForToken, getValidAccessToken };
