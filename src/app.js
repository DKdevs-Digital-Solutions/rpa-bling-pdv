const express = require("express");
const authRoutes = require("./routes/auth.routes");
const syncRoutes = require("./routes/sync.routes");

const app = express();
app.use(express.json());

app.get("/", (req, res) => res.send("Bling MVP API OK"));

app.use("/auth", authRoutes);
app.use("/sync", syncRoutes);

module.exports = app;
