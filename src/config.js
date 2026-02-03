require("dotenv").config();

module.exports = {
  PORT: Number(process.env.PORT || 3000),

  BLING_CLIENT_ID: process.env.BLING_CLIENT_ID,
  BLING_CLIENT_SECRET: process.env.BLING_CLIENT_SECRET,
  BLING_REDIRECT_URI: process.env.BLING_REDIRECT_URI,

  BLING_AUTH_URL: process.env.BLING_AUTH_URL,
  BLING_TOKEN_URL: process.env.BLING_TOKEN_URL,
  BLING_API_BASE: process.env.BLING_API_BASE,

  // Headless seed (opcional)
  BLING_ACCESS_TOKEN: process.env.BLING_ACCESS_TOKEN,
  BLING_REFRESH_TOKEN: process.env.BLING_REFRESH_TOKEN,
  BLING_EXPIRES_AT: process.env.BLING_EXPIRES_AT ? Number(process.env.BLING_EXPIRES_AT) : 0,

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
