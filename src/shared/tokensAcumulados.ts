import { Annotation } from "@langchain/langgraph";

// Canal de acumulador de tokens gastos com IA (issue #35) — padrão
// "increment" do LangGraph: cada nó retorna só o DELTA daquela chamada (0
// quando não gastou nada de verdade), o reducer soma automaticamente entre
// nós e entre invokes separados (persistido no checkpointer). Sem reducer,
// cada retorno SOBRESCREVERIA o total em vez de somar — usado por
// fluxos/pessoaPresa/state.ts, fluxos/violenciaDomestica/state.ts e
// orquestrador/state.ts (tokensGastosTotalConversa).
export function AnnotationTokensAcumulados() {
  return Annotation<number, number>({
    reducer: (atual, incremento) => (atual ?? 0) + incremento,
    default: () => 0,
  });
}
