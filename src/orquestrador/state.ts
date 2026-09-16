import { Annotation } from "@langchain/langgraph";
import { AnnotationTokensAcumulados } from "../shared/tokensAcumulados.js";

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
  // Tokens gastos com IA NESTA rodada (leg entre 2 pausas do grafo) — não é
  // acumulado entre rodadas (isso é escopo da issue #35, total por chat).
  // `classificar` sempre roda 1x por rodada e escreve aqui primeiro;
  // `prepararPerguntaDesambiguacao`, quando roda na mesma rodada, SOMA em
  // cima em vez de sobrescrever (issue #34).
  tokensGastosRodada: Annotation<number | undefined>,
  // Soma de TODOS os tokens gastos com IA NESTA CONVERSA do orquestrador
  // (todas as rodadas de classificação/desambiguação, não só a última) —
  // ver shared/tokensAcumulados.ts. Repassado como
  // dadosConhecidos.tokensGastosTotal quando a desambiguação resolve pra 1
  // fluxo (rotas/orquestrador.ts) — vira o PONTO DE PARTIDA do acumulador
  // do fluxo escolhido, não perde o gasto de antes de identificar (issue #35).
  tokensGastosTotalConversa: AnnotationTokensAcumulados(),
});
