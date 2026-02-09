const { syncOnce } = require("../services/sync.service");
const { getState } = require("../services/stateStore");
const { BLING_ACCOUNTS, getAccount } = require("../config");

async function sync(req, res) {
  try {
    const accountId = req.body?.accountId || req.query?.accountId;

    if (accountId) {
      const id = String(accountId);
      if (!getAccount(id)) {
        return res.status(400).json({ error: `Conta '${id}' não encontrada em BLING_ACCOUNTS` });
      }
      const result = await syncOnce(id);
      return res.json(result);
    }

    const accounts = (BLING_ACCOUNTS && BLING_ACCOUNTS.length) ? BLING_ACCOUNTS : [{ id: "default" }];
    const results = [];
    for (const acc of accounts) {
      results.push(await syncOnce(acc.id));
    }
    return res.json({ totalAccounts: results.length, results });
  } catch (e) {
    res.status(500).json({ error: "Falha no sync", details: e?.response?.data || e.message });
  }
}

function status(req, res) {
  const accountId = req.query?.accountId;
  if (accountId) {
    const id = String(accountId);
    if (!getAccount(id)) {
      return res.status(400).json({ error: `Conta '${id}' não encontrada em BLING_ACCOUNTS` });
    }
    return res.json({ accountId: id, state: getState(id) });
  }
  const accounts = (BLING_ACCOUNTS && BLING_ACCOUNTS.length) ? BLING_ACCOUNTS : [{ id: "default" }];
  const all = {};
  for (const acc of accounts) {
    all[acc.id] = getState(acc.id);
  }
  res.json({ states: all });
}

module.exports = { sync, status };
