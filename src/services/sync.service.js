const { getState, saveState } = require("./stateStore");
const { STATE_TTL_HOURS, STATE_MAX_ITEMS } = require("../config");
const {
  listContasReceberAbertasERecebidas,
  findPedidoVendaIdByNumero,
  getPedidoSituacaoId,
  setSituacaoPedido,
} = require("./bling.service");

// ====== LOCK (evita concorrência de sync) ======
let isRunning = false;

// ====== DELAY ENTRE REQUISIÇÕES ======
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
const REQUEST_DELAY_MS = 5000; // 5 segundos

// ====== FLOW: 6 -> 9 -> 15 -> 89414 -> 89199 ======
const START_SITUACAO = 6;
const FLOW = [723333, 89199];

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
}

function logSuccess(msg) {
  console.log(`${LOG_COLORS.green}[✓ SUCCESS]${LOG_COLORS.reset} ${msg}`);
}

function logWarning(msg) {
  console.log(`${LOG_COLORS.yellow}[⚠ WARNING]${LOG_COLORS.reset} ${msg}`);
}

function logError(msg) {
  console.log(`${LOG_COLORS.red}[✗ ERROR]${LOG_COLORS.reset} ${msg}`);
}

function logProgress(msg) {
  console.log(`${LOG_COLORS.magenta}[→ PROGRESS]${LOG_COLORS.reset} ${msg}`);
}

function logSeparator() {
  console.log(`${LOG_COLORS.blue}${'='.repeat(80)}${LOG_COLORS.reset}`);
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

function flowIndexOf(situacao) {
  return FLOW.indexOf(Number(situacao));
}

function nextStepIndexFromSituacao(situacaoAtual) {
  const idx = flowIndexOf(situacaoAtual);
  if (idx >= 0) return idx + 1;
  return 0;
}

async function syncOnce() {
  if (isRunning) {
    logWarning("Já existe um sync em execução. Ignorando esta chamada.");
    return { skipped: true, reason: "sync_already_running" };
  }

  isRunning = true;

  try {
    const startedAt = Date.now();
    logSeparator();
    logInfo(`🚀 INICIANDO SINCRONIZAÇÃO em ${new Date().toISOString()}`);
    logSeparator();

    const state = getState();
    state.processedContaIds = pruneProcessed(state.processedContaIds || {});
    state.pendingPedidos = pruneByTtl(state.pendingPedidos || {}, STATE_TTL_HOURS);

    // ====== BUSCAR CONTAS A RECEBER ======
    logProgress("Buscando contas a receber (situações 1 e 2)...");
    const contas = await listContasReceberAbertasERecebidas();
    logInfo(`📋 Total de contas encontradas: ${contas.length}`);

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
        continue;
      }

      // ====== FILTRO 2: NÃO PROCESSAR NOVAMENTE ======
      if (state.processedContaIds[contaId]) {
        skips.jaProcessada++;
        continue;
      }

      logSeparator();
      logInfo(`📝 Processando Conta ID: ${contaId}`);

      const origem = conta.origem;
      if (!origem) {
        logWarning(`Conta ${contaId}: SEM ORIGEM - pulando`);
        skips.semOrigem++;
        state.processedContaIds[contaId] = Date.now();
        actions.push({ contaId, status: "skip", motivo: "Sem origem" });
        saveState(state);
        continue;
      }

      if (origem.tipoOrigem !== "venda") {
        logWarning(`Conta ${contaId}: Origem não é 'venda' (${origem.tipoOrigem}) - pulando`);
        skips.origemNaoVenda++;
        state.processedContaIds[contaId] = Date.now();
        actions.push({ contaId, status: "skip", motivo: `origem.tipoOrigem=${origem.tipoOrigem}` });
        saveState(state);
        continue;
      }

      if (!origem.numero) {
        logWarning(`Conta ${contaId}: SEM número do pedido - pulando`);
        skips.semNumero++;
        state.processedContaIds[contaId] = Date.now();
        actions.push({ contaId, status: "skip", motivo: "Sem origem.numero" });
        saveState(state);
        continue;
      }

      const numeroPedido = String(origem.numero).trim();
      logInfo(`🔍 Conta ${contaId} → Buscando Pedido #${numeroPedido}`);

      const pedidoId = await findPedidoVendaIdByNumero(numeroPedido);
      if (!pedidoId) {
        logError(`Pedido #${numeroPedido} NÃO ENCONTRADO no Bling`);
        skips.pedidoNaoEncontrado++;
        actions.push({ contaId, numeroPedido, status: "falha", motivo: "Pedido não encontrado pelo numero" });
        continue;
      }

      logSuccess(`✓ Pedido encontrado: ID ${pedidoId}`);

      const pendKey = String(pedidoId);

      // ===== CASO 1: PEDIDO JÁ ESTÁ PENDENTE (CONTINUAR FLUXO) =====
      if (state.pendingPedidos[pendKey]) {
        skips.pendentesProcessados++;
        processedInThisRun++;

        logProgress(`🔄 Pedido ${pedidoId} JÁ ESTÁ em processamento - continuando fluxo...`);

        try {
          const situacaoAtual = await getPedidoSituacaoId(pedidoId);
          logInfo(`📊 Situação atual do pedido: ${situacaoAtual}`);

          // Se já chegou no final
          if (Number(situacaoAtual) === 89199) {
            logSuccess(`🎉 Pedido ${pedidoId} JÁ ESTÁ na situação final 89199!`);
            delete state.pendingPedidos[pendKey];
            state.processedContaIds[contaId] = Date.now();
            actions.push({ contaId, numeroPedido, pedidoId, status: "ok", via: "pendente->89199" });
            saveState(state);
            continue;
          }

          const computedNext = nextStepIndexFromSituacao(situacaoAtual);
          const currentStep = state.pendingPedidos[pendKey].stepIndex ?? 0;
          const stepIndex = Math.max(currentStep, computedNext);

          // Se já passou de todas as etapas, força 89199
          if (stepIndex >= FLOW.length) {
            logWarning(`⚡ Forçando situação final 89199 para pedido ${pedidoId}`);
            logProgress(`⏳ Aguardando ${REQUEST_DELAY_MS / 1000}s antes de aplicar...`);
            await sleep(REQUEST_DELAY_MS);

            await setSituacaoPedido(pedidoId, 89199);
            logSuccess(`✓ Pedido ${pedidoId} → situação 89199 aplicada!`);

            delete state.pendingPedidos[pendKey];
            state.processedContaIds[contaId] = Date.now();
            actions.push({ contaId, numeroPedido, pedidoId, status: "ok", via: "pendente->force89199" });
            saveState(state);
            continue;
          }

          const nextSituacao = FLOW[stepIndex];
          const flowPosition = `${stepIndex + 1}/${FLOW.length}`;
          logProgress(`➡️  Pedido ${pedidoId}: ${situacaoAtual} → ${nextSituacao} (passo ${flowPosition})`);

          state.pendingPedidos[pendKey].stepIndex = stepIndex;
          state.pendingPedidos[pendKey].ts = Date.now();
          saveState(state);

          logProgress(`⏳ Aguardando ${REQUEST_DELAY_MS / 1000}s antes de aplicar situação ${nextSituacao}...`);
          await sleep(REQUEST_DELAY_MS);

          await setSituacaoPedido(pedidoId, nextSituacao);
          logSuccess(`✓ Situação ${nextSituacao} aplicada ao pedido ${pedidoId}`);

          state.pendingPedidos[pendKey].stepIndex = stepIndex + 1;
          state.pendingPedidos[pendKey].ts = Date.now();
          saveState(state);

          if (nextSituacao === 89199) {
            logSuccess(`🎉 FLUXO COMPLETO! Pedido ${pedidoId} chegou à situação final 89199`);
            delete state.pendingPedidos[pendKey];
            state.processedContaIds[contaId] = Date.now();
            actions.push({ contaId, numeroPedido, pedidoId, status: "ok", via: "pendente->89199" });
            saveState(state);
          } else {
            actions.push({ contaId, numeroPedido, pedidoId, status: "pendente", applied: nextSituacao });
          }

          continue;
        } catch (e) {
          const status = e?.response?.status;
          const body = e?.response?.data || { message: e.message };
          logError(`FALHA ao processar pedido pendente ${pedidoId} (HTTP ${status})`);
          console.error(JSON.stringify(body, null, 2));
          actions.push({ contaId, numeroPedido, pedidoId, status: "falha", motivo: body });
          continue;
        }
      }

      // ===== CASO 2: NOVO PEDIDO - INICIAR FLUXO (SOMENTE SE SITUAÇÃO = 6) =====
      try {
        const situacaoAtual = await getPedidoSituacaoId(pedidoId);
        logInfo(`📊 Situação atual do pedido ${pedidoId}: ${situacaoAtual}`);

        if (Number(situacaoAtual) !== START_SITUACAO) {
          logWarning(`⚠️  Pedido ${pedidoId} não está na situação inicial ${START_SITUACAO} (atual: ${situacaoAtual}) - NÃO INICIARÁ fluxo`);
          skips.naoIniciaNao6++;
          state.processedContaIds[contaId] = Date.now();
          actions.push({
            contaId,
            numeroPedido,
            pedidoId,
            status: "skip",
            motivo: `Não inicia fluxo: situacaoAtual=${situacaoAtual} (precisa ser 6)`,
          });
          saveState(state);
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
        saveState(state);

        const first = FLOW[0];
        logProgress(`⏳ Aguardando ${REQUEST_DELAY_MS / 1000}s antes de aplicar primeira situação (${first})...`);
        await sleep(REQUEST_DELAY_MS);

        await setSituacaoPedido(pedidoId, first);
        logSuccess(`✓ Primeira situação ${first} aplicada ao pedido ${pedidoId} (passo 1/${FLOW.length})`);

        state.pendingPedidos[pendKey].stepIndex = 1;
        state.pendingPedidos[pendKey].ts = Date.now();
        saveState(state);

        actions.push({ contaId, numeroPedido, pedidoId, status: "pendente", applied: first });
      } catch (e) {
        const status = e?.response?.status;
        const body = e?.response?.data || { message: e.message };
        logError(`FALHA ao iniciar fluxo para pedido ${pedidoId} (HTTP ${status})`);
        console.error(JSON.stringify(body, null, 2));
        actions.push({ contaId, numeroPedido, pedidoId, status: "falha", motivo: body });
      }

      logProgress(`⏳ Aguardando ${REQUEST_DELAY_MS / 1000}s antes de processar próxima conta...`);
      await sleep(REQUEST_DELAY_MS);
    }

    state.lastSyncAt = new Date().toISOString();
    state.processedContaIds = pruneProcessed(state.processedContaIds);
    state.pendingPedidos = pruneByTtl(state.pendingPedidos, STATE_TTL_HOURS);
    saveState(state);

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

    return {
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
    isRunning = false;
  }
}

module.exports = { syncOnce };