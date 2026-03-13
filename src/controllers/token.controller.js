const { getValidAccessToken } = require("../services/oauth.service");
const { getTokens } = require("../services/tokenStore");

async function getToken(req, res) {
  try {
    const accountId = String(req.query.account || "default");
    const accessToken = await getValidAccessToken(accountId);
    const tokens = getTokens(accountId);

    return res.json({
      ok: true,
      accountId,
      access_token: accessToken,
      expires_at: tokens?.expires_at || null
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.response?.data || e.message
    });
  }
}

module.exports = { getToken };
