const express = require("express");
const authRoutes = require("./routes/auth.routes");
const syncRoutes = require("./routes/sync.routes");
const logsRoutes = require("./routes/logs.routes");
const accountsRoutes = require("./routes/accounts.routes");
const { requestLoggerMiddleware } = require("./utils/logger");
const path = require("path");

const app = express();
app.use(express.json());

// logs inteligentes (nível de request)
app.use(requestLoggerMiddleware());

// página estática do dashboard
// IMPORTANTE: em Docker o app roda com cwd = /data (pra persistir tokens/logs),
// então não dá pra depender de caminhos relativos ao process.cwd().
// Usamos caminho absoluto baseado no diretório do código (ex.: /app/src).
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/", (req, res) => res.send("Bling MVP API OK"));

app.use("/auth", authRoutes);
app.use("/sync", syncRoutes);
app.use("/api/accounts", accountsRoutes);
app.use("/", logsRoutes);

module.exports = app;
