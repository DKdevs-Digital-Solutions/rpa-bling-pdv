const { buildAuthUrl, exchangeCodeForToken, generateState } = require("../services/oauth.service");
const { saveState, getState, clearState } = require("../services/oauthStateStore");
const { getAccount } = require("../config");

async function start(req, res) {
  const accountId = String(req.query.account || "default");
  if (!getAccount(accountId)) {
    return res.status(400).json({ error: `Conta '${accountId}' não encontrada em BLING_ACCOUNTS` });
  }
  const state = generateState();
  saveState(state, accountId);
  const url = buildAuthUrl(accountId, state);
  res.json({ authorize_url: url, state, accountId });
}

async function callback(req, res) {
  const { code, state } = req.query;

  const saved = state ? getState(state) : null;
  if (!state || !saved?.accountId) {
    return res.status(400).json({
      error: "Invalid state",
      received: state
    });
  }
  if (!code) return res.status(400).send("Sem 'code' no callback.");

  try {
    await exchangeCodeForToken(saved.accountId, code);
    clearState(state);
    res.send(`OAuth OK para '${saved.accountId}'. Tokens salvos. Agora use POST /sync`);
  } catch (e) {
    res.status(500).json({ error: "Falha no OAuth callback", details: e?.response?.data || e.message });
  }
}

module.exports = { start, callback };
