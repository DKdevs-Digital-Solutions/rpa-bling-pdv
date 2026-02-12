const express = require("express");
const path = require("path");
const { queryEvents, attachSse } = require("../utils/logger");

const router = express.Router();

// Dashboard (HTML)
router.get("/logs", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "logs.html"));
});

// API: últimos eventos (para o dashboard)
router.get("/api/logs", (req, res) => {
  const { accountId, jobId, since, limit } = req.query;
  const events = queryEvents({ accountId, jobId, since, limit });
  res.json({ ok: true, events });
});

// API: stream ao vivo via SSE
router.get("/api/logs/stream", (req, res) => {
  attachSse(res);
});

module.exports = router;
