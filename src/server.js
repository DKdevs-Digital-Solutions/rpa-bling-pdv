const app = require("./app");
const { PORT, POLL_INTERVAL_SECONDS } = require("./config");
const { syncOnce } = require("./services/sync.service");
const { seedTokensFromEnvIfMissing, getTokens } = require("./services/tokenStore");
const { buildAuthUrl } = require("./services/oauth.service");

const seedResult = seedTokensFromEnvIfMissing();
if (seedResult?.seeded) {
  console.log("tokens.json criado a partir do .env (modo headless).");
}

app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
  console.log(`OAuth: GET  http://localhost:${PORT}/auth/start`);
  console.log(`Sync:  POST http://localhost:${PORT}/sync`);

  const t = getTokens();
  if (!t?.access_token && !t?.refresh_token) {
    console.log("Sem tokens ainda. Autorize aqui:", buildAuthUrl());
  }
});

let warned = false;

if (POLL_INTERVAL_SECONDS > 0) {
  setInterval(async () => {
    try {
      const t = getTokens();
      if (!t?.access_token && !t?.refresh_token) {
        if (!warned) {
          console.log("Aguardando tokens (tokens.json ou BLING_REFRESH_TOKEN no .env).");
          warned = true;
        }
        return;
      }
      warned = false;
      await syncOnce();
    } catch (e) {
      console.error("Polling error:", e?.response?.data || e.message);
    }
  }, POLL_INTERVAL_SECONDS * 1000);
}
