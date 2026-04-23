const express = require("express");
const { BLING_ACCOUNTS } = require("../config");
const { getTokens } = require("../services/tokenStore");

const router = express.Router();

// Retorna lista segura das contas do BLING_ACCOUNTS (sem segredos), junto com o estado OAuth persistido.
router.get("/", (req, res) => {
  try {
    const accounts = Array.isArray(BLING_ACCOUNTS) ? BLING_ACCOUNTS : [];

    const safe = accounts.map((a) => {
      const tokens = getTokens(a.id) || {};
      return {
        id: a.id,
        redirect_uri: a.redirect_uri,
        config: a.config
          ? {
              forma_pagamento_id: a.config.forma_pagamento_id,
              start_situacao: a.config.start_situacao,
              final_situacao_id: a.config.final_situacao_id,
              flow: a.config.flow,
            }
          : undefined,
        oauth: {
          has_access_token: Boolean(tokens.access_token),
          has_refresh_token: Boolean(tokens.refresh_token),
          expires_at: tokens.expires_at || null,
          needs_reauth: Boolean(tokens.needs_reauth),
          oauth_error: tokens.oauth_error || null,
          authorize_url: tokens.authorize_url || `/auth/start?account=${encodeURIComponent(a.id)}`,
        },
      };
    });

    res.json({ ok: true, accounts: safe });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Invalid BLING_ACCOUNTS format" });
  }
});

module.exports = router;
