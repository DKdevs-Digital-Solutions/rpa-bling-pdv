const { buildAuthUrl, exchangeCodeForToken, generateState } = require("../services/oauth.service");
const { saveState, getState, clearState } = require("../services/oauthStateStore");

async function start(req, res) {
  const state = generateState();
  saveState(state);
  const url = buildAuthUrl(state);
  res.json({ authorize_url: url, state });
}

async function callback(req, res) {
  const { code, state } = req.query;

  const saved = getState();
  if (!state || !saved?.state || state !== saved.state) {
    return res.status(400).json({
      error: "Invalid state",
      expected: saved?.state,
      received: state
    });
  }
  if (!code) return res.status(400).send("Sem 'code' no callback.");

  try {
    await exchangeCodeForToken(code);
    clearState();
    res.send("OAuth OK. Tokens salvos. Agora use POST /sync");
  } catch (e) {
    res.status(500).json({ error: "Falha no OAuth callback", details: e?.response?.data || e.message });
  }
}

module.exports = { start, callback };
