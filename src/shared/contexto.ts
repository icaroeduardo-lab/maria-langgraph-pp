import { getConfig } from "@langchain/langgraph";

// getConfig() usa AsyncLocalStorage internamente (implementação em
// @langchain/core) — dá pra chamar de QUALQUER lugar durante a execução de
// um nó do grafo (mesmo fundo, dentro de verde.ts/reescrever.ts/extrair.ts)
// sem precisar receber config como parâmetro. Nunca lança — fora de um run
// (ex: log de startup em shared/checkpointer.ts) retorna undefined, os
// campos abaixo saem undefined também.
export function contextoAtual(): { chatId?: string; fluxoId?: string } {
  const configurable = getConfig()?.configurable as { thread_id?: string; fluxoId?: string } | undefined;
  return { chatId: configurable?.thread_id, fluxoId: configurable?.fluxoId };
}
