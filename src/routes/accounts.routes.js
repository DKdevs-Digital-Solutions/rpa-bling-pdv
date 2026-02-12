const express = require("express");

const router = express.Router();

// Retorna lista segura de contas do BLING_ACCOUNTS (sem segredos)
router.get("/", (req, res) => {
  try {
    const raw = process.env.BLING_ACCOUNTS || "[]";
    const accounts = JSON.parse(raw);

    const safe = (Array.isArray(accounts) ? accounts : []).map((a) => ({
      id: a.id,
      // extras não sensíveis (opcional)
      config: a.config
        ? {
            forma_pagamento_id: a.config.forma_pagamento_id,
            start_situacao: a.config.start_situacao,
            final_situacao_id: a.config.final_situacao_id,
            flow: a.config.flow,
          }
        : undefined,
    }));

    res.json({ ok: true, accounts: safe });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Invalid BLING_ACCOUNTS format" });
  }
});

module.exports = router;
