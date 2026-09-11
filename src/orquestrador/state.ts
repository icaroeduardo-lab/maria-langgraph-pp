import { Annotation } from "@langchain/langgraph";

export type OrquestradorStateType = typeof OrquestradorState.State;

export interface CandidatoOrquestrador {
  id: string;
  nome: string;
  descricao: string;
}

export const OrquestradorState = Annotation.Root({
  // Relato acumulado — nas rodadas de desambiguação, a resposta da pessoa
  // é concatenada aqui, dando mais contexto pra próxima classificação.
  mensagem: Annotation<string>,
  // undefined = ainda não fez retrieval nenhum (1ª rodada). Definido = já
  // filtrado por uma rodada de classificação anterior — próxima rodada
  // classifica DENTRO desse subconjunto, não busca no catálogo de novo.
  candidatosRestantes: Annotation<CandidatoOrquestrador[] | undefined>,
  rodada: Annotation<number | undefined>,
  flowIdEscolhido: Annotation<string | undefined>,
  statusFinal: Annotation<"identificado" | "nao_identificado" | undefined>,
  perguntaAtualTexto: Annotation<string | undefined>,
});
