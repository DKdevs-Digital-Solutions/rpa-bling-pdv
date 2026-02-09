require("dotenv").config();

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Variável ${name} não é um JSON válido. Dica: use aspas duplas e JSON puro. Erro: ${e.message}`
    );
  }
}

function normalizeAccounts(rawAccounts) {
  const list = Array.isArray(rawAccounts) ? rawAccounts : [];
  const normalized = list
    .filter(Boolean)
    .map((a, idx) => ({
      id: String(a.id || a.accountId || `account${idx + 1}`),
      client_id: a.client_id || a.clientId || a.clientID,
      client_secret: a.client_secret || a.clientSecret,
      redirect_uri: a.redirect_uri || a.redirectUri,
      // seed opcional
      access_token: a.access_token,
      refresh_token: a.refresh_token,
      expires_at: a.expires_at ? Number(a.expires_at) : 0,
    }));

  return normalized;
}

// Multi-conta via JSON no .env
// Ex.: BLING_ACCOUNTS=[{"id":"loja1","client_id":"...","client_secret":"...","redirect_uri":"..."}, ...]
const BLING_ACCOUNTS = normalizeAccounts(parseJsonEnv("BLING_ACCOUNTS", null));

// Backwards compatibility: se não existir BLING_ACCOUNTS, cria uma conta "default" usando as variáveis antigas.
function buildLegacyDefaultAccount() {
  const client_id = process.env.BLING_CLIENT_ID;
  const client_secret = process.env.BLING_CLIENT_SECRET;
  const redirect_uri = process.env.BLING_REDIRECT_URI;

  // Headless seed (opcional)
  const access_token = process.env.BLING_ACCESS_TOKEN;
  const refresh_token = process.env.BLING_REFRESH_TOKEN;
  const expires_at = process.env.BLING_EXPIRES_AT ? Number(process.env.BLING_EXPIRES_AT) : 0;

  if (!client_id && !client_secret && !redirect_uri && !access_token && !refresh_token) return null;

  return {
    id: "default",
    client_id,
    client_secret,
    redirect_uri,
    access_token,
    refresh_token,
    expires_at,
  };
}

const LEGACY_DEFAULT = buildLegacyDefaultAccount();
const EFFECTIVE_ACCOUNTS = BLING_ACCOUNTS.length ? BLING_ACCOUNTS : (LEGACY_DEFAULT ? [LEGACY_DEFAULT] : []);

function getAccount(accountId = "default") {
  const id = String(accountId);
  const acc = EFFECTIVE_ACCOUNTS.find(a => a.id === id);
  if (!acc) return null;
  return acc;
}

module.exports = {
  PORT: Number(process.env.PORT || 3000),

  // Multi-conta
  BLING_ACCOUNTS: EFFECTIVE_ACCOUNTS,
  getAccount,

  // Mantido por compatibilidade (use BLING_ACCOUNTS no novo formato)
  BLING_CLIENT_ID: process.env.BLING_CLIENT_ID,
  BLING_CLIENT_SECRET: process.env.BLING_CLIENT_SECRET,
  BLING_REDIRECT_URI: process.env.BLING_REDIRECT_URI,

  BLING_AUTH_URL: process.env.BLING_AUTH_URL,
  BLING_TOKEN_URL: process.env.BLING_TOKEN_URL,
  BLING_API_BASE: process.env.BLING_API_BASE,

  // Paths (opcional)
  TOKENS_PATH: process.env.TOKENS_PATH,
  STATE_PATH: process.env.STATE_PATH,
  OAUTH_STATE_PATH: process.env.OAUTH_STATE_PATH,

  FORMA_PAGAMENTO_ID: process.env.FORMA_PAGAMENTO_ID,
  DATA_INICIAL: process.env.DATA_INICIAL,
  SITUACAO_PEDIDO_PAGO_ID: process.env.SITUACAO_PEDIDO_PAGO_ID,

  POLL_INTERVAL_SECONDS: Number(process.env.POLL_INTERVAL_SECONDS || 0),

  // Cache / controle local (MVP)
  STATE_TTL_HOURS: Number(process.env.STATE_TTL_HOURS || 24),
  STATE_MAX_ITEMS: Number(process.env.STATE_MAX_ITEMS || 50000),

  // Janela dinâmica (opcional)
  LOOKBACK_DAYS: Number(process.env.LOOKBACK_DAYS || 0),
};
