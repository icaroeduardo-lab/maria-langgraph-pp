import { Annotation } from "@langchain/langgraph";

export type ViolenciaDomesticaStateType = typeof ViolenciaDomesticaState.State;

// Esqueleto — fluxo real (perguntas de triagem/risco, dados da vítima, etc)
// ainda não desenhado. Só demonstra que fluxos/<nome>/ suporta um 2º grafo
// lado a lado com pessoaPresa, sem misturar state/nós de um com outro. Ver
// fluxos/violenciaDomestica/graph.ts.
export const ViolenciaDomesticaState = Annotation.Root({
  relato: Annotation<string | undefined>,
  statusFinal: Annotation<"concluido" | undefined>,
  // mesmo padrão compartilhado de pessoaPresa/state.ts — ver ia/reescrever.ts
  perguntaAtualTexto: Annotation<string | undefined>,
  perguntaAtualViaIA: Annotation<boolean | undefined>,
  perguntaAtualTokensTotal: Annotation<number | undefined>,
});
