import { Annotation } from "@langchain/langgraph";
import type { DadosPessoa } from "../../shared/types.js";
import { AnnotationTokensGastos } from "../../shared/tokensAcumulados.js";

export type IdentificarAssistidoStateType = typeof IdentificarAssistidoState.State;

// Issue #171 — extraído de fluxos/violenciaDomestica/graph.ts (era pedirCpf
// + consultarPessoa + retry, direto no grafo do fluxo). Mesmos nomes de
// campo do state de violência doméstica de propósito — LangGraph compartilha
// canal automaticamente entre grafo pai e subgrafo quando o nome bate, sem
// precisar de nó de "tradução" no meio.
export const IdentificarAssistidoState = Annotation.Root({
  // vem pronto no `dadosConhecidos` do POST /atendimentos (contrato Tykhe)
  // quando o fluxo pai já sabe o CPF — bypass evita perguntar de novo.
  cpf: Annotation<string | undefined>,
  dadosPessoa: Annotation<DadosPessoa | undefined>,
  tentativasCpf: Annotation<number | undefined>,
  querTentarNovamenteCpf: Annotation<boolean | undefined>,
  digitouCpfDireto: Annotation<boolean | undefined>,
  perguntaAtualTexto: Annotation<string | undefined>,
  perguntaAtualViaIA: Annotation<boolean | undefined>,
  perguntaAtualTokensTotal: Annotation<number | undefined>,
  tokensGastos: AnnotationTokensGastos(),
});
