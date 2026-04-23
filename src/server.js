const app = require("./app");
const { PORT, POLL_INTERVAL_SECONDS, BLING_ACCOUNTS } = require("./config");
const { syncOnce } = require("./services/sync.service");
const { getValidAccessToken } = require("./services/oauth.service");
const { seedTokensFromEnvIfMissing, syncTokensFromEnv, getTokens } = require("./services/tokenStore");

const seedResult = seedTokensFromEnvIfMissing();
if (seedResult?.seeded) {
  console.log(
    `tokens.json criado a partir do .env (modo headless). Contas seed: ${(seedResult.accounts || []).join(", ")}`
  );
}

const syncEnvResult = syncTokensFromEnv({
  overwriteRefreshToken: true,
  overwriteAccessToken: false,
  overwriteExpiresAt: false,
});
if (syncEnvResult?.synced) {
  console.log(`tokens.json sincronizado com .env para: ${(syncEnvResult.accounts || []).join(", ")}`);
}

function getAccountIds() {
  return (BLING_ACCOUNTS && BLING_ACCOUNTS.length)
    ? BLING_ACCOUNTS.map(a => String(a.id))
    : ["default"];
}

async function warmupTokens() {
  const ids = getAccountIds();
  for (const id of ids) {
    const t = getTokens(id);
    if (!t?.access_token && !t?.refresh_token) continue;

    try {
      await getValidAccessToken(id);
      console.log(`[OAUTH] Conta '${id}' pronta para sincronizar.`);
    } catch (e) {
      console.error(`[OAUTH] Conta '${id}' não ficou pronta no warmup:`, e?.response?.data || e.message);
    }
  }
}

app.listen(PORT, async () => {
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

  await warmupTokens();
});

let warned = false;
let isPolling = false;

if (POLL_INTERVAL_SECONDS > 0) {
  setInterval(async () => {
    if (isPolling) {
      console.log("Polling anterior ainda em execução. Vou pular este ciclo para evitar concorrência.");
      return;
    }

    isPolling = true;

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

        try {
          await getValidAccessToken(id);
          await syncOnce(id);
        } catch (e) {
          console.error(`[POLL][${id}] erro:`, e?.response?.data || e.message);
        }
      }
    } finally {
      isPolling = false;
    }
  }, POLL_INTERVAL_SECONDS * 1000);
}
