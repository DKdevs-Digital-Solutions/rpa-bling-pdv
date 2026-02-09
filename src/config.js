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

function toNumberOrUndefined(v) {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeAccountConfig(a) {
  const cfg = (a && typeof a.config === "object" && a.config) ? a.config : {};

  const flowRaw = a.flow ?? a.FLOW ?? cfg.flow ?? cfg.FLOW;
  const flow =
    Array.isArray(flowRaw) ? flowRaw.map((x) => Number(x)).filter((x) => Number.isFinite(x)) : undefined;

  return {
    // IDs variam por conta — defina aqui por conta (recomendado)
    forma_pagamento_id:
      toNumberOrUndefined(a.forma_pagamento_id ?? a.formaPagamentoId ?? a.FORMA_PAGAMENTO_ID ?? cfg.forma_pagamento_id ?? cfg.formaPagamentoId ?? cfg.FORMA_PAGAMENTO_ID),

    situacao_pedido_pago_id:
      toNumberOrUndefined(a.situacao_pedido_pago_id ?? a.situacaoPedidoPagoId ?? a.SITUACAO_PEDIDO_PAGO_ID ?? cfg.situacao_pedido_pago_id ?? cfg.situacaoPedidoPagoId ?? cfg.SITUACAO_PEDIDO_PAGO_ID),

    // Fluxo de situação do pedido (também varia por conta)
    start_situacao:
      toNumberOrUndefined(a.start_situacao ?? a.startSituacao ?? a.START_SITUACAO ?? cfg.start_situacao ?? cfg.startSituacao ?? cfg.START_SITUACAO),

    flow, // array de IDs de situação em ordem

    final_situacao_id:
      toNumberOrUndefined(a.final_situacao_id ?? a.finalSituacaoId ?? a.FINAL_SITUACAO_ID ?? cfg.final_situacao_id ?? cfg.finalSituacaoId ?? cfg.FINAL_SITUACAO_ID),

    // opcional: data inicial por conta
    data_inicial: (a.data_inicial ?? a.dataInicial ?? a.DATA_INICIAL ?? cfg.data_inicial ?? cfg.dataInicial ?? cfg.DATA_INICIAL),
    lookback_days: toNumberOrUndefined(a.lookback_days ?? a.lookbackDays ?? a.LOOKBACK_DAYS ?? cfg.lookback_days ?? cfg.lookbackDays ?? cfg.LOOKBACK_DAYS),
  };
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

      // config por conta (IDs e fluxo)
      config: normalizeAccountConfig(a),
    }));

  return normalized;
}

// Multi-conta via JSON no .env
// Ex.: BLING_ACCOUNTS=[{"id":"loja1","client_id":"...","client_secret":"...","redirect_uri":"...","config":{"forma_pagamento_id":123,"start_situacao":6,"flow":[723333,89199]}}, ...]
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
    config: normalizeAccountConfig({}),
  };
}

const LEGACY_DEFAULT = buildLegacyDefaultAccount();
const EFFECTIVE_ACCOUNTS = BLING_ACCOUNTS.length
  ? BLING_ACCOUNTS
  : (LEGACY_DEFAULT ? [LEGACY_DEFAULT] : []);

function getAccount(accountId = "default") {
  const id = String(accountId);
  const acc = EFFECTIVE_ACCOUNTS.find((a) => a.id === id);
  if (!acc) return null;
  return acc;
}

function getAccountConfig(accountId = "default") {
  const acc = getAccount(accountId);
  const per = acc?.config || {};

  // Defaults globais (mantidos por compatibilidade)
  const globalForma = toNumberOrUndefined(process.env.FORMA_PAGAMENTO_ID);
  const globalSituPago = toNumberOrUndefined(process.env.SITUACAO_PEDIDO_PAGO_ID);
  const globalDataInicial = process.env.DATA_INICIAL;
  const globalLookback = toNumberOrUndefined(process.env.LOOKBACK_DAYS);

  const globalStart = toNumberOrUndefined(process.env.START_SITUACAO);
  const globalFlowRaw = parseJsonEnv("FLOW", null);
  const globalFlow = Array.isArray(globalFlowRaw)
    ? globalFlowRaw.map((x) => Number(x)).filter((x) => Number.isFinite(x))
    : undefined;
  const globalFinal = toNumberOrUndefined(process.env.FINAL_SITUACAO_ID);

  const flow = per.flow ?? globalFlow ?? [723333, 89199];
  const final_situacao_id = per.final_situacao_id ?? globalFinal ?? flow[flow.length - 1];

  return {
    forma_pagamento_id: per.forma_pagamento_id ?? globalForma,
    situacao_pedido_pago_id: per.situacao_pedido_pago_id ?? globalSituPago,
    data_inicial: per.data_inicial ?? globalDataInicial,
    lookback_days: per.lookback_days ?? globalLookback ?? 0,

    start_situacao: per.start_situacao ?? globalStart ?? 6,
    flow,
    final_situacao_id,
  };
}

module.exports = {
  PORT: Number(process.env.PORT || 3000),

  // Multi-conta
  BLING_ACCOUNTS: EFFECTIVE_ACCOUNTS,
  getAccount,
  getAccountConfig,

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

  // Compat: globais (preferir config por conta dentro de BLING_ACCOUNTS)
  FORMA_PAGAMENTO_ID: process.env.FORMA_PAGAMENTO_ID,
  DATA_INICIAL: process.env.DATA_INICIAL,
  SITUACAO_PEDIDO_PAGO_ID: process.env.SITUACAO_PEDIDO_PAGO_ID,

  // POLL
  POLL_INTERVAL_SECONDS: Number(process.env.POLL_INTERVAL_SECONDS || 0),

  // Cache / controle local (MVP)
  STATE_TTL_HOURS: Number(process.env.STATE_TTL_HOURS || 24),
  STATE_MAX_ITEMS: Number(process.env.STATE_MAX_ITEMS || 50000),

  // Janela dinâmica (opcional)
  LOOKBACK_DAYS: Number(process.env.LOOKBACK_DAYS || 0),
};
