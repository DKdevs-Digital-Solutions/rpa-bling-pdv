const app = require("./app");
const { PORT, POLL_INTERVAL_SECONDS, BLING_ACCOUNTS } = require("./config");
const { syncOnce } = require("./services/sync.service");
const { seedTokensFromEnvIfMissing, getTokens } = require("./services/tokenStore");

const seedResult = seedTokensFromEnvIfMissing();
if (seedResult?.seeded) {
  console.log(
    `tokens.json criado a partir do .env (modo headless). Contas seed: ${(seedResult.accounts || []).join(", ")}`
  );
}

function getAccountIds() {
  return (BLING_ACCOUNTS && BLING_ACCOUNTS.length)
    ? BLING_ACCOUNTS.map(a => String(a.id))
    : ["default"];
}

app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
  console.log(`OAuth: GET  http://localhost:${PORT}/auth/start?account=<id>`);
  console.log(`Sync:  POST http://localhost:${PORT}/sync`);

  const ids = getAccountIds();
  for (const id of ids) {
    const t = getTokens(id);
    if (!t?.access_token && !t?.refresh_token) {
      console.log(
        `Sem tokens para '${id}'. Use /auth/start?account=${encodeURIComponent(id)} para autorizar.`
      );
    }
  }
});

let warned = false;

if (POLL_INTERVAL_SECONDS > 0) {
  setInterval(async () => {
    try {
      const ids = getAccountIds();

      let hasAnyToken = false;
      for (const id of ids) {
        const t = getTokens(id);
        if (t?.access_token || t?.refresh_token) {
          hasAnyToken = true;
          break;
        }
      }

      if (!hasAnyToken) {
        if (!warned) {
          console.log(
            "Aguardando tokens (tokens.json ou refresh_token no BLING_ACCOUNTS do .env)."
          );
          warned = true;
        }
        return;
      }

      warned = false;
      for (const id of ids) {
        const t = getTokens(id);
        if (!t?.access_token && !t?.refresh_token) continue;
        await syncOnce(id);
      }
    } catch (e) {
      console.error("Polling error:", e?.response?.data || e.message);
    }
  }, POLL_INTERVAL_SECONDS * 1000);
}
