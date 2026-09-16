import { Annotation } from "@langchain/langgraph";
import { AnnotationTokensAcumulados } from "../../shared/tokensAcumulados.js";

export type PadraoStateType = typeof PadraoState.State;

// Estado mínimo — esse grafo nunca pausa (sem interrupt), conclui no
// primeiro invoke. Só precisa dos 2 campos que montarRespostaAtendimento
// (rotas/atendimentos.ts) sempre lê de qualquer fluxo.
export const PadraoState = Annotation.Root({
  statusFinal: Annotation<"concluido" | undefined>,
  mensagemFinal: Annotation<string | undefined>,
  // Achado ao vivo 2026-09-11 (issue #35): a MAIORIA das categorias do
  // catálogo ainda cai aqui (grafo padrão, sem grafo implementado, issue
  // #21) — sem esse campo, o total gasto na classificação/desambiguação do
  // orquestrador (repassado via dadosConhecidos, ver rotas/orquestrador.ts)
  // ficava mudo (LangGraph ignora chave de canal não declarado no state),
  // mostrando 0 mesmo quando gastou tokens de verdade. Este grafo nunca
  // gera delta próprio (não chama IA) — só recebe o seed do orquestrador e
  // repassa adiante.
  tokensGastosTotal: AnnotationTokensAcumulados(),
});
