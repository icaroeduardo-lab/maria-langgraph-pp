import { StateGraph, START, END } from "@langchain/langgraph";
import { type PadraoStateType, PadraoState } from "./state.js";
import { criarCheckpointer } from "../../shared/checkpointer.js";
import { contextoAtual } from "../../shared/contexto.js";
import { buscarFluxoPlanejadoPorId } from "../../shared/fluxosPlanejadosDb.js";
import { MENSAGEM_CONCLUIDO } from "./api.js";

// Grafo compartilhado por QUALQUER fluxo planejado sem grafo próprio ainda
// (ver fluxos/index.ts::buscarFluxo e issue #21) — 1 nó só, sem interrupt(),
// conclui já na primeira chamada (POST /atendimentos). Reaproveitado por
// vários flowId diferentes ao mesmo tempo: isolamento de conversa é por
// chatId/thread_id (checkpointer), não por qual FluxoConfig.grafo aponta pra
// cá — múltiplos flowId planejados compartilhando este mesmo grafo não
// misturam estado entre si.
//
// Issue #22 — algumas categorias são redirecionamento PERMANENTE (ex:
// reclamação trabalhista, LOAS), não "em construção". contextoAtual() lê o
// fluxoId do config do run atual (mesmo mecanismo de shared/contexto.ts,
// já usado em verde.ts/reescrever.ts/extrair.ts) — sem isso este grafo
// compartilhado não teria como saber qual categoria está rodando.
async function concluirComMensagemPadrao(): Promise<Partial<PadraoStateType>> {
  const { fluxoId } = contextoAtual();
  const planejado = fluxoId ? await buscarFluxoPlanejadoPorId(fluxoId) : undefined;
  return { statusFinal: "concluido", mensagemFinal: planejado?.mensagemFixa ?? MENSAGEM_CONCLUIDO };
}

const grafo = new StateGraph(PadraoState)
  .addNode("concluir", concluirComMensagemPadrao)
  .addEdge(START, "concluir")
  .addEdge("concluir", END)
  .compile({ checkpointer: await criarCheckpointer() });

export { grafo };
