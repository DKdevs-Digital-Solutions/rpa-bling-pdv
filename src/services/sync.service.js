const { getState, saveState } = require("./stateStore");
const { STATE_TTL_HOURS, STATE_MAX_ITEMS, getAccountConfig } = require("../config");
const {
  listContasReceberAbertasERecebidas,
  findPedidoVendaIdByNumero,
  getPedidoSituacaoId,
  setSituacaoPedido,
} = require("./bling.service");
const { createLogger } = require("../utils/logger");
const { randomUUID } = require("crypto");

// ====== LOCK (evita concorrência de sync) ======
const isRunningByAccount = new Map();

// logger por conta (usado pelos helpers de log abaixo)
const loggerByAccount = new Map();
function getLogger(accountId) {
  return loggerByAccount.get(String(accountId));
}

// ====== DELAY ENTRE REQUISIÇÕES ======
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
const REQUEST_DELAY_MS = 5000; // 5 segundos

// ====== FLOW (por conta) ======
// Configure por conta via BLING_ACCOUNTS[].config: { start_situacao, flow, final_situacao_id }

// ====== LOGS COLORIDOS PARA MELHOR VISUALIZAÇÃO ======
const LOG_COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function logInfo(msg) {
  console.log(`${LOG_COLORS.cyan}[INFO]${LOG_COLORS.reset} ${msg}`);
  const l = getLogger("default");
  l?.info(msg);
}

function logSuccess(msg) {
  console.log(`${LOG_COLORS.green}[✓ SUCCESS]${LOG_COLORS.reset} ${msg}`);
  const l = getLogger("default");
  l?.success(msg);
}

function logWarning(msg) {
  console.log(`${LOG_COLORS.yellow}[⚠ WARNING]${LOG_COLORS.reset} ${msg}`);
  const l = getLogger("default");
  l?.warn(msg);
}

function logError(msg) {
  console.log(`${LOG_COLORS.red}[✗ ERROR]${LOG_COLORS.reset} ${msg}`);
  const l = getLogger("default");
  l?.error(msg);
}

function logProgress(msg) {
  console.log(`${LOG_COLORS.magenta}[→ PROGRESS]${LOG_COLORS.reset} ${msg}`);
  const l = getLogger("default");
  l?.progress(msg);
}

function logSeparator() {
  console.log(`${LOG_COLORS.blue}${'='.repeat(80)}${LOG_COLORS.reset}`);
}

// ====== AUDIT EVENTS (para dashboard do cliente) ======
// Eventos estruturados para auditoria por loja/conta.
// Tudo vai em meta.type para o dashboard conseguir montar tabelas.
function auditEvent(level, msg, meta = {}, step = "audit") {
  const l = getLogger("default");
  if (!l) return;
  const safeMeta = meta && typeof meta === "object" ? meta : { value: meta };
  l.event(level, msg, { step, meta: safeMeta });
}

function auditPayable(meta) {
  const level = meta?.result === "processed" ? "success"
    : meta?.result === "pending" ? "progress"
    : meta?.result === "fail" ? "error"
    : meta?.result === "skip" ? "warn"
    : "info";
  auditEvent(level, `Conta ${meta?.contaId} → ${meta?.result}`, { type: "PAYABLE_RESULT", ...meta });
}

function auditOrder(meta) {
  const level = meta?.result === "processed" ? "success"
    : meta?.result === "pending" ? "progress"
    : meta?.result === "fail" ? "error"
    : meta?.result === "skip" ? "warn"
    : "info";
  auditEvent(level, `Pedido ${meta?.pedidoId || meta?.numeroPedido || ""} → ${meta?.result}`, { type: "ORDER_RESULT", ...meta });
}

function pruneByTtl(mapObj, ttlHours) {
  const obj = mapObj || {};
  const now = Date.now();
  const ttlMs = ttlHours * 60 * 60 * 1000;

  for (const [k, v] of Object.entries(obj)) {
    const ts = typeof v === "number" ? v : v?.ts;
    if (!ts || now - ts > ttlMs) delete obj[k];
  }
  return obj;
}

function pruneProcessed(processedContaIds) {
  const now = Date.now();
  const ttlMs = STATE_TTL_HOURS * 60 * 60 * 1000;

  processedContaIds = processedContaIds || {};

  for (const [id, ts] of Object.entries(processedContaIds)) {
    if (!ts || now - ts > ttlMs) delete processedContaIds[id];
  }

  const entries = Object.entries(processedContaIds);
  if (entries.length <= STATE_MAX_ITEMS) return processedContaIds;

  entries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
  const sliced = entries.slice(0, STATE_MAX_ITEMS);

  const compact = {};
  for (const [id, ts] of sliced) compact[id] = ts;
  return compact;
}

function flowIndexOf(flow, situacao) {
  return (flow || []).indexOf(Number(situacao));
}

function nextStepIndexFromSituacao(flow, situacaoAtual) {
  const idx = flowIndexOf(flow, situacaoAtual);
  if (idx >= 0) return idx + 1;
  return 0;
}

async function syncOnce(accountId = "default") {
  const key = String(accountId);
  if (isRunningByAccount.get(key)) {
    logWarning(`Já existe um sync em execução para '${key}'. Ignorando esta chamada.`);
    return { skipped: true, reason: "sync_already_running", accountId: key };
  }

  isRunningByAccount.set(key, true);

  // contexto de logs (aparece no /logs)
  const jobId = randomUUID();
  const logger = createLogger({ accountId: key, jobId });
  loggerByAccount.set(key, logger);
  // compat: helpers de log deste arquivo usam "default"
  loggerByAccount.set("default", logger);

  try {
    const startedAt = Date.now();
    const cfg = getAccountConfig(key);
    const START_SITUACAO = Number(cfg.start_situacao);
    const FLOW = Array.isArray(cfg.flow) ? cfg.flow.map(Number) : [];
    const FINAL_SITUACAO = Number(cfg.final_situacao_id ?? (FLOW.length ? FLOW[FLOW.length - 1] : NaN));
    if (!Number.isFinite(START_SITUACAO) || !Array.isArray(FLOW) || FLOW.length === 0 || !Number.isFinite(FINAL_SITUACAO)) {
      throw new Error(`Config de fluxo inválida para a conta ${key}. Verifique start_situacao, flow e final_situacao_id.`);
    }

    logSeparator();
    logInfo(`🚀 INICIANDO SINCRONIZAÇÃO em ${new Date().toISOString()}`);
    auditEvent('info', 'Sync iniciado', { type: 'TASK_START', accountId: key, jobId, cfg: { start_situacao: START_SITUACAO, flow: FLOW, final_situacao: FINAL_SITUACAO } }, 'task');
    logSeparator();

    const state = getState(key);
    state.processedContaIds = pruneProcessed(state.processedContaIds || {});
    state.pendingPedidos = pruneByTtl(state.pendingPedidos || {}, STATE_TTL_HOURS);

    // ====== BUSCAR CONTAS A RECEBER ======
    logProgress("Buscando contas a receber (situações 1 e 2)...");
    const contas = await listContasReceberAbertasERecebidas(key);
    logInfo(`📋 Total de contas encontradas: ${contas.length}`);
    auditEvent('info', 'Contas a receber obtidas', { type: 'PAYABLES_FETCHED', total: contas.length }, 'fetch_payables');

    const recebidasCount = contas.filter(c => c.situacao === 2).length;
    logSuccess(`💰 Contas RECEBIDAS (situação=2): ${recebidasCount}`);

    const actions = [];
    const skips = {
      naoRecebida: 0,
      jaProcessada: 0,
      semOrigem: 0,
      origemNaoVenda: 0,
      semNumero: 0,
      pedidoNaoEncontrado: 0,
      naoIniciaNao6: 0,
      pendentesProcessados: 0,
    };

    let processedInThisRun = 0;

    for (const conta of contas) {
      const contaId = String(conta.id);

      // ====== FILTRO 1: SOMENTE RECEBIDAS ======
      if (conta.situacao !== 2) {
        skips.naoRecebida++;
        auditPayable({ accountId: key, contaId, result: 'skip', reason: 'naoRecebida', situacao: conta.situacao });
        continue;
      }

      // ====== FILTRO 2: NÃO PROCESSAR NOVAMENTE ======
      if (state.processedContaIds[contaId]) {
        skips.jaProcessada++;
        auditPayable({ accountId: key, contaId, result: 'skip', reason: 'jaProcessada' });
        continue;
      }

      logSeparator();
      logInfo(`📝 Processando Conta ID: ${contaId}`);

      const origem = conta.origem;
      if (!origem) {
        logWarning(`Conta ${contaId}: SEM ORIGEM - pulando`);
        skips.semOrigem++;
        auditPayable({ accountId: key, contaId, result: 'skip', reason: 'semOrigem' });
        state.processedContaIds[contaId] = Date.now();
        actions.push({ contaId, status: "skip", motivo: "Sem origem" });
        saveState(key, state);
        continue;
      }

      if (origem.tipoOrigem !== "venda") {
        logWarning(`Conta ${contaId}: Origem não é 'venda' (${origem.tipoOrigem}) - pulando`);
        skips.origemNaoVenda++;
        auditPayable({ accountId: key, contaId, result: 'skip', reason: 'origemNaoVenda', origemTipo: origem.tipoOrigem });
        state.processedContaIds[contaId] = Date.now();
        actions.push({ contaId, status: "skip", motivo: `origem.tipoOrigem=${origem.tipoOrigem}` });
        saveState(key, state);
        continue;
      }

      if (!origem.numero) {
        logWarning(`Conta ${contaId}: SEM número do pedido - pulando`);
        skips.semNumero++;
        auditPayable({ accountId: key, contaId, result: 'skip', reason: 'semNumeroPedido' });
        state.processedContaIds[contaId] = Date.now();
        actions.push({ contaId, status: "skip", motivo: "Sem origem.numero" });
        saveState(key, state);
        continue;
      }

      const numeroPedido = String(origem.numero).trim();
      logInfo(`🔍 Conta ${contaId} → Buscando Pedido #${numeroPedido}`);
      auditEvent('info', 'Conta vinculada a numero de pedido', { type: 'PAYABLE_LINK', contaId, numeroPedido }, 'link');

      const pedidoId = await findPedidoVendaIdByNumero(numeroPedido, key);
      if (!pedidoId) {
        logError(`Pedido #${numeroPedido} NÃO ENCONTRADO no Bling`);
        skips.pedidoNaoEncontrado++;
        auditPayable({ accountId: key, contaId, numeroPedido, result: 'fail', reason: 'pedidoNaoEncontrado' });
        actions.push({ contaId, numeroPedido, status: "falha", motivo: "Pedido não encontrado pelo numero" });
        auditPayable({ accountId: key, contaId, numeroPedido, result: "fail", reason: "pedidoNaoEncontrado" });
        continue;
      }

      logSuccess(`✓ Pedido encontrado: ID ${pedidoId}`);
      auditEvent('success', 'Pedido encontrado para conta', { type: 'ORDER_FOUND', contaId, numeroPedido, pedidoId }, 'fetch_order');

      const pendKey = String(pedidoId);

      // ===== CASO 1: PEDIDO JÁ ESTÁ PENDENTE (CONTINUAR FLUXO) =====
      if (state.pendingPedidos[pendKey]) {
        skips.pendentesProcessados++;
        processedInThisRun++;

        logProgress(`🔄 Pedido ${pedidoId} JÁ ESTÁ em processamento - continuando fluxo...`);

        try {
          const situacaoAtual = await getPedidoSituacaoId(pedidoId, key);
          logInfo(`📊 Situação atual do pedido: ${situacaoAtual}`);

          // Se já chegou no final
          if (Number(situacaoAtual) === FINAL_SITUACAO) {
            logSuccess(`🎉 Pedido ${pedidoId} JÁ ESTÁ na situação final ${FINAL_SITUACAO}!`);
            delete state.pendingPedidos[pendKey];
            state.processedContaIds[contaId] = Date.now();
            actions.push({ contaId, numeroPedido, pedidoId, status: "ok", via: "pendente->final" });
            auditPayable({ accountId: key, contaId, numeroPedido, pedidoId, result: "processed", reason: "pendente->final" });
            auditOrder({ accountId: key, contaId, numeroPedido, pedidoId, result: "processed", reason: "pendente->final" });
            saveState(key, state);
            continue;
          }

          const computedNext = nextStepIndexFromSituacao(FLOW, situacaoAtual);
          const currentStep = state.pendingPedidos[pendKey].stepIndex ?? 0;
          const stepIndex = Math.max(currentStep, computedNext);

          // Se já passou de todas as etapas, força situação final
          if (stepIndex >= FLOW.length) {
            logWarning(`⚡ Forçando situação final ${FINAL_SITUACAO} para pedido ${pedidoId}`);
            logProgress(`⏳ Aguardando ${REQUEST_DELAY_MS / 1000}s antes de aplicar...`);
            await sleep(REQUEST_DELAY_MS);

            await setSituacaoPedido(pedidoId, FINAL_SITUACAO, key);
            logSuccess(`✓ Pedido ${pedidoId} → situação ${FINAL_SITUACAO} aplicada!`);
            auditEvent('success', 'Situação final aplicada (forçado)', { type: 'ORDER_STATUS_APPLIED', pedidoId, to: FINAL_SITUACAO, forced: true, contaId, numeroPedido }, 'apply_status');

            delete state.pendingPedidos[pendKey];
            state.processedContaIds[contaId] = Date.now();
            actions.push({ contaId, numeroPedido, pedidoId, status: "ok", via: "pendente->forceFinal" });
            auditPayable({ accountId: key, contaId, numeroPedido, pedidoId, result: "processed", reason: "pendente->forceFinal" });
            auditOrder({ accountId: key, contaId, numeroPedido, pedidoId, result: "processed", reason: "pendente->forceFinal" });
            saveState(key, state);
            continue;
          }

          const nextSituacao = FLOW[stepIndex];
          const flowPosition = `${stepIndex + 1}/${FLOW.length}`;
          logProgress(`➡️  Pedido ${pedidoId}: ${situacaoAtual} → ${nextSituacao} (passo ${flowPosition})`);

          state.pendingPedidos[pendKey].stepIndex = stepIndex;
          state.pendingPedidos[pendKey].ts = Date.now();
          saveState(key, state);

          logProgress(`⏳ Aguardando ${REQUEST_DELAY_MS / 1000}s antes de aplicar situação ${nextSituacao}...`);
          await sleep(REQUEST_DELAY_MS);

          await setSituacaoPedido(pedidoId, nextSituacao, key);
          logSuccess(`✓ Situação ${nextSituacao} aplicada ao pedido ${pedidoId}`);
          auditEvent('success', 'Situação aplicada', { type: 'ORDER_STATUS_APPLIED', pedidoId, from: situacaoAtual, to: nextSituacao, contaId, numeroPedido }, 'apply_status');

          state.pendingPedidos[pendKey].stepIndex = stepIndex + 1;
          state.pendingPedidos[pendKey].ts = Date.now();
          saveState(key, state);

          if (nextSituacao === FINAL_SITUACAO) {
            logSuccess(`🎉 FLUXO COMPLETO! Pedido ${pedidoId} chegou à situação final ${FINAL_SITUACAO}`);
            delete state.pendingPedidos[pendKey];
            state.processedContaIds[contaId] = Date.now();
            actions.push({ contaId, numeroPedido, pedidoId, status: "ok", via: "pendente->final" });
            auditPayable({ accountId: key, contaId, numeroPedido, pedidoId, result: "processed", reason: "pendente->final" });
            auditOrder({ accountId: key, contaId, numeroPedido, pedidoId, result: "processed", reason: "pendente->final" });
            saveState(key, state);
          } else {
            actions.push({ contaId, numeroPedido, pedidoId, status: "pendente", applied: nextSituacao });
            auditPayable({ accountId: key, contaId, numeroPedido, pedidoId, result: "pending", reason: "em_fluxo", applied: nextSituacao });
            auditOrder({ accountId: key, contaId, numeroPedido, pedidoId, result: "pending", reason: "em_fluxo", applied: nextSituacao });
          }

          continue;
        } catch (e) {
          const status = e?.response?.status;
          const body = e?.response?.data || { message: e.message };
          logError(`FALHA ao processar pedido pendente ${pedidoId} (HTTP ${status})`);
          console.error(JSON.stringify(body, null, 2));
          actions.push({ contaId, numeroPedido, pedidoId, status: "falha", motivo: body });
          auditPayable({ accountId: key, contaId, numeroPedido, pedidoId, result: "fail", reason: "erro_http", error: body });
          auditOrder({ accountId: key, contaId, numeroPedido, pedidoId, result: "fail", reason: "erro_http", error: body });
          continue;
        }
      }

      // ===== CASO 2: NOVO PEDIDO - INICIAR FLUXO (SOMENTE SE SITUAÇÃO = 6) =====
      try {
        const situacaoAtual = await getPedidoSituacaoId(pedidoId, key);
        logInfo(`📊 Situação atual do pedido ${pedidoId}: ${situacaoAtual}`);

        if (Number(situacaoAtual) !== START_SITUACAO) {
          // logWarning(`⚠️  Pedido ${pedidoId} não está na situação inicial ${START_SITUACAO} (atual: ${situacaoAtual}) - NÃO INICIARÁ fluxo`);
          skips.naoIniciaNao6++;
          state.processedContaIds[contaId] = Date.now();
          actions.push({
            contaId,
            numeroPedido,
            pedidoId,
            status: "skip",
            motivo: `Não inicia fluxo: situacaoAtual=${situacaoAtual} (precisa ser 6)`,
          });
          auditPayable({ accountId: key, contaId, numeroPedido, pedidoId, result: 'skip', reason: 'naoIniciaFluxo', situacaoAtual });
          auditOrder({ accountId: key, contaId, numeroPedido, pedidoId, result: 'skip', reason: 'naoIniciaFluxo', situacaoAtual });
          saveState(key, state);
          continue;
        }

        processedInThisRun++;
        logSuccess(`🚀 INICIANDO FLUXO para pedido ${pedidoId}: ${START_SITUACAO} → ${FLOW.join(' → ')}`);

        state.pendingPedidos[pendKey] = {
          ts: Date.now(),
          contaId,
          numeroPedido,
          stepIndex: 0,
        };
        saveState(key, state);

        const first = FLOW[0];
        logProgress(`⏳ Aguardando ${REQUEST_DELAY_MS / 1000}s antes de aplicar primeira situação (${first})...`);
        await sleep(REQUEST_DELAY_MS);

        await setSituacaoPedido(pedidoId, first, key);
        logSuccess(`✓ Primeira situação ${first} aplicada ao pedido ${pedidoId} (passo 1/${FLOW.length})`);
        auditEvent('success', 'Primeira situação aplicada', { type: 'ORDER_STATUS_APPLIED', pedidoId, from: START_SITUACAO, to: first, contaId, numeroPedido }, 'apply_status');

        state.pendingPedidos[pendKey].stepIndex = 1;
        state.pendingPedidos[pendKey].ts = Date.now();
        saveState(key, state);

        actions.push({ contaId, numeroPedido, pedidoId, status: "pendente", applied: first });
        auditPayable({ accountId: key, contaId, numeroPedido, pedidoId, result: "pending", reason: "inicio_fluxo", applied: first });
        auditOrder({ accountId: key, contaId, numeroPedido, pedidoId, result: "pending", reason: "inicio_fluxo", applied: first });
      } catch (e) {
        const status = e?.response?.status;
        const body = e?.response?.data || { message: e.message };
        logError(`FALHA ao iniciar fluxo para pedido ${pedidoId} (HTTP ${status})`);
        console.error(JSON.stringify(body, null, 2));
        actions.push({ contaId, numeroPedido, pedidoId, status: "falha", motivo: body });
          auditPayable({ accountId: key, contaId, numeroPedido, pedidoId, result: "fail", reason: "erro_http", error: body });
          auditOrder({ accountId: key, contaId, numeroPedido, pedidoId, result: "fail", reason: "erro_http", error: body });
      }

      logProgress(`⏳ Aguardando ${REQUEST_DELAY_MS / 1000}s antes de processar próxima conta...`);
      await sleep(REQUEST_DELAY_MS);
    }

    state.lastSyncAt = new Date().toISOString();
    state.processedContaIds = pruneProcessed(state.processedContaIds);
    state.pendingPedidos = pruneByTtl(state.pendingPedidos, STATE_TTL_HOURS);
    saveState(key, state);

    const tookMs = Date.now() - startedAt;
    const tookSec = (tookMs / 1000).toFixed(2);

    logSeparator();
    logSuccess(`✅ SINCRONIZAÇÃO FINALIZADA!`);
    logInfo(`⏱️  Tempo total: ${tookSec}s (${tookMs}ms)`);
    logInfo(`📊 Estatísticas:`);
    logInfo(`   - Total de contas lidas: ${contas.length}`);
    logInfo(`   - Contas recebidas (situação=2): ${recebidasCount}`);
    logInfo(`   - Pedidos processados nesta execução: ${processedInThisRun}`);
    logInfo(`   - Total de ações realizadas: ${actions.length}`);
    logInfo(`   - Contas no cache (já processadas): ${Object.keys(state.processedContaIds).length}`);
    logInfo(`   - Pedidos pendentes (em fluxo): ${Object.keys(state.pendingPedidos).length}`);
    
    logInfo(`\n📋 Motivos de pulos (skips):`);
    Object.entries(skips).forEach(([key, value]) => {
      if (value > 0) {
        logInfo(`   - ${key}: ${value}`);
      }
    });
    logSeparator();

    auditEvent('success', 'Sync finalizado', { 
      type: 'TASK_END',
      accountId: key,
      jobId,
      syncedAt: state.lastSyncAt,
      tookMs,
      counts: {
        totalContasLidas: contas.length,
        totalRecebidas: recebidasCount,
        pedidosProcessados: processedInThisRun,
        totalAcoes: actions.length,
        processedSize: Object.keys(state.processedContaIds).length,
        pendingSize: Object.keys(state.pendingPedidos).length,
        skips
      }
    }, 'task');

    return {
      accountId: key,
      jobId,
      syncedAt: state.lastSyncAt,
      tookMs,
      totalContasLidas: contas.length,
      totalRecebidas: recebidasCount,
      pedidosProcessados: processedInThisRun,
      totalAcoes: actions.length,
      processedSize: Object.keys(state.processedContaIds).length,
      pendingSize: Object.keys(state.pendingPedidos).length,
      skips,
      actions,
    };
  } finally {
    isRunningByAccount.delete(key);
    loggerByAccount.delete(key);
    if (loggerByAccount.get("default") === logger) {
      loggerByAccount.delete("default");
    }
  }
}

module.exports = { syncOnce };
