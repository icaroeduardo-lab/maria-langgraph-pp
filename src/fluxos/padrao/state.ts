import { Annotation } from "@langchain/langgraph";

export type PadraoStateType = typeof PadraoState.State;

// Estado mínimo — esse grafo nunca pausa (sem interrupt), conclui no
// primeiro invoke. Só precisa dos 2 campos que montarRespostaAtendimento
// (rotas/atendimentos.ts) sempre lê de qualquer fluxo.
export const PadraoState = Annotation.Root({
  statusFinal: Annotation<"concluido" | undefined>,
  mensagemFinal: Annotation<string | undefined>,
});
