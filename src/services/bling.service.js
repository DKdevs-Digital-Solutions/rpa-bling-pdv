const axios = require("axios");
const { waitTurn } = require("../utils/blingLimiter");

const { BLING_API_BASE, getAccountConfig } = require("../config");
const { getValidAccessToken } = require("./oauth.service");

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function isTooManyRequests(err) {
  const status = err?.response?.status;
  const type = err?.response?.data?.error?.type;
  return status === 429 || type === "TOO_MANY_REQUESTS";
}

/**
 * Wrapper central para garantir:
 * - rate limit via waitTurn()
 * - retry em 429/TOO_MANY_REQUESTS
 */
async function blingRequest(config, { maxRetries = 3, accountId = "default" } = {}) {
  let attempt = 0;

  while (true) {
    attempt += 1;

    // garante espaçamento entre chamadas
    await waitTurn();

    try {
      const token = await getValidAccessToken(accountId);
      const resp = await axios({
        baseURL: BLING_API_BASE,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(config.method && config.method.toLowerCase() !== "get"
            ? { "Content-Type": "application/json" }
            : {}),
          ...(config.headers || {}),
        },
        ...config,
      });

      return resp;
    } catch (e) {
      const status = e?.response?.status;
      const data = e?.response?.data;

      if (isTooManyRequests(e) && attempt < maxRetries) {
        console.warn(
          `[BLING][RATE LIMIT] ${config.method?.toUpperCase() || "GET"} ${
            config.url
          } -> 429/TOO_MANY_REQUESTS (tentativa ${attempt}/${maxRetries}). Vou aguardar e tentar de novo.`
        );

        // como você quer 5s entre etapas, reaproveitamos waitTurn() na próxima volta.
        // mas pra garantir folga extra em 429, podemos esperar +5s aqui também:
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      console.error(
        `[BLING][${config.method?.toUpperCase() || "GET"}] ${config.url} falhou`,
        status,
        JSON.stringify(data || e.message, null, 2)
      );
      throw e;
    }
  }
}

async function blingGet(path, params, accountId) {
  return blingRequest(
    {
      method: "get",
      url: path,
      params,
    },
    { maxRetries: 3, accountId }
  );
}

async function blingPatch(path, body, accountId) {
  return blingRequest(
    {
      method: "patch",
      url: path,
      data: body || {},
    },
    { maxRetries: 3, accountId }
  );
}

async function listContasReceberAbertasERecebidas(accountId = "default") {
  const cfg = getAccountConfig(accountId);

  const dataInicial =
    cfg.lookback_days && cfg.lookback_days > 0
      ? isoDaysAgo(cfg.lookback_days)
      : cfg.data_inicial;

  const params = {
    "situacoes[]": [1, 2],
    idFormaPagamento: cfg.forma_pagamento_id,
    dataInicial,
  };

  console.log(
    `[BLING] Buscando contas receber: conta=${accountId} forma=${cfg.forma_pagamento_id} dataInicial=${dataInicial} situacoes=1,2`
  );

  const resp = await blingGet("/contas/receber", params, accountId);
  return resp.data?.data || [];
}

async function findPedidoVendaIdByNumero(numero, accountId = "default") {
  console.log(`[BLING] Buscando pedido por numero=${numero}`);
  const resp = await blingGet("/pedidos/vendas", { numero }, accountId);
  const id = resp.data?.data?.[0]?.id || null;
  console.log(`[BLING] Resultado pedido numero=${numero} -> id=${id}`);
  return id;
}

async function getPedidoVendaById(pedidoId, accountId = "default") {
  const resp = await blingGet(`/pedidos/vendas/${pedidoId}`, {}, accountId);
  return resp.data?.data || null;
}

// tenta extrair o ID da situação em formatos diferentes
function extractSituacaoId(pedido) {
  if (!pedido) return null;

  // casos comuns
  if (typeof pedido?.situacao === "number") return pedido.situacao;
  if (typeof pedido?.situacao === "string")
    return Number(pedido.situacao) || pedido.situacao;

  if (pedido?.situacao?.id) return pedido.situacao.id;
  if (pedido?.idSituacao) return pedido.idSituacao;

  return null;
}

async function getPedidoSituacaoId(pedidoId, accountId = "default") {
  const pedido = await getPedidoVendaById(pedidoId, accountId);
  const situacaoId = extractSituacaoId(pedido);
  console.log(`[BLING] Pedido ${pedidoId} situação atual=${situacaoId}`);
  return situacaoId;
}

async function setSituacaoPedido(pedidoId, situacaoId, accountId = "default") {
  console.log(`[BLING] PATCH pedido=${pedidoId} -> situacao=${situacaoId}`);
  await blingPatch(
    `/pedidos/vendas/${pedidoId}/situacoes/${situacaoId}?lancarContasFinanceiras=false`,
    {},
    accountId
  );
}

async function marcarPedidoComoPago(pedidoId, accountId = "default") {
    const cfg = getAccountConfig(accountId);
  if (!cfg.situacao_pedido_pago_id) {
    throw new Error(`SITUACAO_PEDIDO_PAGO_ID não configurado para a conta ${accountId}`);
  }
  await setSituacaoPedido(pedidoId, cfg.situacao_pedido_pago_id, accountId);
}


module.exports = {
  listContasReceberAbertasERecebidas,
  findPedidoVendaIdByNumero,
  getPedidoSituacaoId,
  setSituacaoPedido,
  marcarPedidoComoPago,
};
