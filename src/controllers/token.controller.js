const { getValidAccessToken } = require("../services/oauth.service");
const { getTokens } = require("../services/tokenStore");

async function getToken(req, res) {
  const accountId = String(req.query.account || "default");

  try {
    const accessToken = await getValidAccessToken(accountId);
    const tokens = getTokens(accountId);

    return res.json({
      ok: true,
      accountId,
      access_token: accessToken,
      expires_at: tokens?.expires_at || null,
      needs_reauth: Boolean(tokens?.needs_reauth),
      oauth_error: tokens?.oauth_error || null,
    });
  } catch (e) {
    const tokens = getTokens(accountId);
    return res.status(500).json({
      ok: false,
      accountId,
      error: e?.response?.data || e.message,
      needs_reauth: Boolean(tokens?.needs_reauth),
      oauth_error: tokens?.oauth_error || null,
      authorize_url: tokens?.authorize_url || `/auth/start?account=${encodeURIComponent(accountId)}`,
    });
  }
}

module.exports = { getToken };
