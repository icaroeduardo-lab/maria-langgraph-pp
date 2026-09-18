import { Annotation } from "@langchain/langgraph";

// Issue #92 — substitui os 3 campos soltos (tokensGastosTotal/Entrada/Saida,
// issue #69/#71) por um objeto único. Mesmo padrão "increment" do LangGraph:
// cada nó devolve só o DELTA daquela chamada (0 em cada campo quando não
// gastou nada de verdade), o reducer soma cada chave automaticamente entre
// nós e entre invokes separados (persistido no checkpointer). Sem reducer,
// cada retorno SOBRESCREVERIA o total em vez de somar — usado por
// fluxos/pessoaPresa/state.ts, fluxos/violenciaDomestica/state.ts,
// fluxos/padrao/state.ts e orquestrador/state.ts.
export interface TokensGastos {
  input: number;
  output: number;
  total: number;
}

export function AnnotationTokensGastos() {
  return Annotation<TokensGastos, TokensGastos>({
    reducer: (atual, incremento) => ({
      input: (atual?.input ?? 0) + incremento.input,
      output: (atual?.output ?? 0) + incremento.output,
      total: (atual?.total ?? 0) + incremento.total,
    }),
    default: () => ({ input: 0, output: 0, total: 0 }),
  });
}
