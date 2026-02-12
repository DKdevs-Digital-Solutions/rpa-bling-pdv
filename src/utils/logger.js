const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

// ===== Logger "inteligente" =====
// - Emite logs estruturados (JSON)
// - Mantém buffer em memória para dashboard
// - Persiste em arquivo (jsonl) para auditoria
// - Suporta SSE para atualizações ao vivo

const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), "logs");
const MAX_IN_MEMORY = Number(process.env.LOG_MAX_IN_MEMORY || 3000);

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function todayKey() {
  const d = new Date();
  const y = String(d.getUTCFullYear());
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

let writeStream = null;
let streamKey = null;

function getWriteStream() {
  ensureDir(LOG_DIR);
  const key = todayKey();
  if (!writeStream || streamKey !== key) {
    try {
      writeStream?.end?.();
    } catch (_) {}
    streamKey = key;
    const file = path.join(LOG_DIR, `events-${key}.jsonl`);
    writeStream = fs.createWriteStream(file, { flags: "a" });
  }
  return writeStream;
}

// Buffer global (multi-conta / multi-job)
const buffer = [];
const sseClients = new Set();

function pushEvent(evt) {
  buffer.push(evt);
  if (buffer.length > MAX_IN_MEMORY) buffer.splice(0, buffer.length - MAX_IN_MEMORY);

  // persistência best-effort
  try {
    getWriteStream().write(JSON.stringify(evt) + "\n");
  } catch (_) {}

  // broadcast SSE best-effort
  const line = `data: ${JSON.stringify(evt)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(line);
    } catch (_) {
      sseClients.delete(res);
    }
  }
}

function makeEvent({ level, msg, accountId, jobId, step, meta, durationMs, reqId }) {
  return {
    ts: new Date().toISOString(),
    level,
    msg,
    accountId: accountId ?? "default",
    jobId: jobId ?? null,
    step: step ?? null,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    reqId: reqId ?? null,
    meta: meta ?? null,
  };
}

function createLogger(ctx = {}) {
  const base = { ...ctx };

  const api = {
    with(extra) {
      return createLogger({ ...base, ...extra });
    },
    event(level, msg, extra = {}) {
      pushEvent(makeEvent({ level, msg, ...base, ...extra }));
    },
    info(msg, extra) {
      api.event("info", msg, extra);
    },
    progress(msg, extra) {
      api.event("progress", msg, extra);
    },
    success(msg, extra) {
      api.event("success", msg, extra);
    },
    warn(msg, extra) {
      api.event("warn", msg, extra);
    },
    error(msg, extra) {
      api.event("error", msg, extra);
    },
    async span(step, fn, extra = {}) {
      const started = Date.now();
      api.progress(`Iniciando: ${step}`, { step, ...extra });
      try {
        const result = await fn();
        api.success(`Finalizado: ${step}`, { step, durationMs: Date.now() - started, ...extra });
        return result;
      } catch (e) {
        api.error(`Falha: ${step}`, {
          step,
          durationMs: Date.now() - started,
          meta: {
            error: e?.message,
            ...(e?.response?.data ? { responseData: e.response.data } : {}),
          },
          ...extra,
        });
        throw e;
      }
    },
  };

  return api;
}

function requestLoggerMiddleware() {
  return (req, res, next) => {
    const reqId = req.headers["x-request-id"] || randomUUID();
    req.reqId = reqId;

    const logger = createLogger({ reqId });
    req.logger = logger;

    const started = Date.now();
    logger.info(`HTTP ${req.method} ${req.originalUrl}`, {
      meta: {
        ip: req.ip,
        ua: req.headers["user-agent"],
      },
    });

    res.on("finish", () => {
      logger.info(`HTTP ${req.method} ${req.originalUrl} -> ${res.statusCode}`, {
        durationMs: Date.now() - started,
        meta: { statusCode: res.statusCode },
      });
    });

    res.setHeader("x-request-id", reqId);
    next();
  };
}

function queryEvents({ accountId, jobId, since, limit }) {
  let items = buffer;
  if (accountId) items = items.filter(e => String(e.accountId) === String(accountId));
  if (jobId) items = items.filter(e => String(e.jobId) === String(jobId));
  if (since) items = items.filter(e => e.ts > since);
  const lim = Math.min(Math.max(Number(limit || 200), 1), 2000);
  return items.slice(-lim);
}

function attachSse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write(`event: hello\n`);
  res.write(`data: {"ok":true}\n\n`);
  sseClients.add(res);
  res.on("close", () => sseClients.delete(res));
}

module.exports = {
  createLogger,
  requestLoggerMiddleware,
  queryEvents,
  attachSse,
};
