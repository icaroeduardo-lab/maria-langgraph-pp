import { StateGraph, START, END } from "@langchain/langgraph";
import { type PadraoStateType, PadraoState } from "./state.js";
import { criarCheckpointer } from "../../shared/checkpointer.js";
import { MENSAGEM_CONCLUIDO } from "./api.js";

// Grafo compartilhado por QUALQUER fluxo planejado sem grafo próprio ainda
// (ver fluxos/index.ts::buscarFluxo e issue #21) — 1 nó só, sem interrupt(),
// conclui já na primeira chamada (POST /atendimentos). Reaproveitado por
// vários flowId diferentes ao mesmo tempo: isolamento de conversa é por
// chatId/thread_id (checkpointer), não por qual FluxoConfig.grafo aponta pra
// cá — múltiplos flowId planejados compartilhando este mesmo grafo não
// misturam estado entre si.
async function concluirComMensagemPadrao(): Promise<Partial<PadraoStateType>> {
  return { statusFinal: "concluido", mensagemFinal: MENSAGEM_CONCLUIDO };
}

const grafo = new StateGraph(PadraoState)
  .addNode("concluir", concluirComMensagemPadrao)
  .addEdge(START, "concluir")
  .addEdge("concluir", END)
  .compile({ checkpointer: await criarCheckpointer() });

export { grafo };
