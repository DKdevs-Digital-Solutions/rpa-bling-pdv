const axios = require("axios");
const { waitTurn } = require("../utils/blingLimiter");

const { BLING_API_BASE, getAccountConfig } = require("../config");
const { getValidAccessToken } = require("./oauth.service");

// IMPORTANTE:
// Usar data em fuso LOCAL (não UTC) para evitar "perder" itens na virada do dia
// quando o servidor/contêiner está em UTC e o negócio opera em BRT.
// Datas no fuso de negócio (por padrão BRT = -180 minutos).
// Isso evita "perder" itens na virada do dia quando o servidor/contêiner está em UTC.
function businessISODate(d = new Date()) {
  const offsetMin = Number(process.env.BUSINESS_TZ_OFFSET_MINUTES ?? -180); // BRT default
  const shifted = new Date(d.getTime() + offsetMin * 60 * 1000);
  // usamos getters UTC porque já fizemos o shift manual
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return businessISODate(d);
}

function isoToday() {
  return businessISODate(new Date());
}

function isoStartOfDay(dateStr) {
  return `${dateStr} 00:00:00`;
}

function isoEndOfDay(dateStr) {
  return `${dateStr} 23:59:59`;
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

  // Requisito do projeto: últimos 7 dias contando com hoje (janela móvel).
  const lookback = (cfg.lookback_days && cfg.lookback_days > 0) ? cfg.lookback_days : 7;
  const daysAgo = Math.max(0, lookback - 1);

  // Importante:
  // - O Bling possui diferentes filtros por período. Na prática, para "data de emissão",
  //   os filtros geralmente seguem o padrão *Inicial/*Final.
  // - Para não perder títulos emitidos HOJE, usamos janela fechada (início e fim do dia).
  const baseInicial = cfg.data_inicial || isoDaysAgo(daysAgo);
  const baseFinal = cfg.data_final || isoToday();

  const filterField = (cfg.date_filter_field || "emissao").toLowerCase(); // emissao | vencimento | alteracao

  const params = {
    "situacoes[]": [1, 2],               // 1 = em aberto, 2 = recebida (paga)
    idFormaPagamento: cfg.forma_pagamento_id, // PIX
  };

  if (filterField === "vencimento") {
    // Alguns ambientes usam dataInicial/dataFinal como vencimento.
    params.dataInicial = baseInicial;
    params.dataFinal = baseFinal;
  } else if (filterField === "alteracao") {
    // Para casos onde o período deve considerar alterações
    params.dataAlteracaoInicial = isoStartOfDay(baseInicial);
    params.dataAlteracaoFinal = isoEndOfDay(baseFinal);
  } else {
    // Padrão do projeto: filtrar por EMISSÃO (para pegar o que foi gerado hoje).
    params.dataEmissaoInicial = isoStartOfDay(baseInicial);
    params.dataEmissaoFinal = isoEndOfDay(baseFinal);
  }

  console.log(
    `[BLING] Buscando contas receber: conta=${accountId} forma=${cfg.forma_pagamento_id} ` +
    `periodo=${baseInicial}..${baseFinal} campo=${filterField} situacoes=1,2`
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
