const axios = require("axios");
const {
  BLING_API_BASE,
  FORMA_PAGAMENTO_ID,
  DATA_INICIAL,
  SITUACAO_PEDIDO_PAGO_ID,
  LOOKBACK_DAYS,
} = require("../config");
const { getValidAccessToken } = require("./oauth.service");

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function blingGet(path, params) {
  const token = await getValidAccessToken();
  try {
    const resp = await axios.get(`${BLING_API_BASE}${path}`, {
      params,
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
    return resp;
  } catch (e) {
    console.error(`[BLING][GET] ${path} falhou`, e?.response?.status, JSON.stringify(e?.response?.data || e.message, null, 2));
    throw e;
  }
}

async function blingPatch(path, body) {
  const token = await getValidAccessToken();
  try {
    const resp = await axios.patch(`${BLING_API_BASE}${path}`, body || {}, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    return resp;
  } catch (e) {
    console.error(`[BLING][PATCH] ${path} falhou`, e?.response?.status, JSON.stringify(e?.response?.data || e.message, null, 2));
    throw e;
  }
}

async function listContasReceberAbertasERecebidas() {
  const dataInicial =
    LOOKBACK_DAYS && LOOKBACK_DAYS > 0 ? isoDaysAgo(LOOKBACK_DAYS) : DATA_INICIAL;

  const params = {
    "situacoes[]": [1, 2],
    idFormaPagamento: FORMA_PAGAMENTO_ID,
    dataInicial,
  };

  console.log(
    `[BLING] Buscando contas receber: forma=${FORMA_PAGAMENTO_ID} dataInicial=${dataInicial} situacoes=1,2`
  );

  const resp = await blingGet("/contas/receber", params);
  return resp.data?.data || [];
}

async function findPedidoVendaIdByNumero(numero) {
  console.log(`[BLING] Buscando pedido por numero=${numero}`);
  const resp = await blingGet("/pedidos/vendas", { numero });
  const id = resp.data?.data?.[0]?.id || null;
  console.log(`[BLING] Resultado pedido numero=${numero} -> id=${id}`);
  return id;
}

async function getPedidoVendaById(pedidoId) {
  const resp = await blingGet(`/pedidos/vendas/${pedidoId}`, {});
  return resp.data?.data || null;
}

// tenta extrair o ID da situação em formatos diferentes
function extractSituacaoId(pedido) {
  if (!pedido) return null;

  // casos comuns
  if (typeof pedido?.situacao === "number") return pedido.situacao;
  if (typeof pedido?.situacao === "string") return Number(pedido.situacao) || pedido.situacao;

  if (pedido?.situacao?.id) return pedido.situacao.id;
  if (pedido?.idSituacao) return pedido.idSituacao;

  return null;
}

async function getPedidoSituacaoId(pedidoId) {
  const pedido = await getPedidoVendaById(pedidoId);
  const situacaoId = extractSituacaoId(pedido);
  console.log(`[BLING] Pedido ${pedidoId} situação atual=${situacaoId}`);
  return situacaoId;
}

async function setSituacaoPedido(pedidoId, situacaoId) {
  console.log(`[BLING] PATCH pedido=${pedidoId} -> situacao=${situacaoId}`);
  await blingPatch(`/pedidos/vendas/${pedidoId}/situacoes/${situacaoId}?lancarContasFinanceiras=false`, {});
}

async function marcarPedidoComoPago(pedidoId) {
  await setSituacaoPedido(pedidoId, SITUACAO_PEDIDO_PAGO_ID);
}

module.exports = {
  listContasReceberAbertasERecebidas,
  findPedidoVendaIdByNumero,
  getPedidoSituacaoId,
  setSituacaoPedido,
  marcarPedidoComoPago,
};
