const express = require("express");
const authRoutes = require("./routes/auth.routes");
const syncRoutes = require("./routes/sync.routes");
const logsRoutes = require("./routes/logs.routes");
const { requestLoggerMiddleware } = require("./utils/logger");

const app = express();
app.use(express.json());

// logs inteligentes (nível de request)
app.use(requestLoggerMiddleware());

// página estática do dashboard
app.use(express.static("public"));

app.get("/", (req, res) => res.send("Bling MVP API OK"));

app.use("/auth", authRoutes);
app.use("/sync", syncRoutes);
app.use("/", logsRoutes);

module.exports = app;
