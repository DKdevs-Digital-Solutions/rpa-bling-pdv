const { syncOnce } = require("../services/sync.service");
const { getState } = require("../services/stateStore");

async function sync(req, res) {
  try {
    const result = await syncOnce();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "Falha no sync", details: e?.response?.data || e.message });
  }
}

function status(req, res) {
  res.json({ state: getState() });
}

module.exports = { sync, status };
