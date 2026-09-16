import { Annotation } from "@langchain/langgraph";
import type { DadosApenado, DadosProcesso } from "../../shared/types.js";
import { AnnotationTokensAcumulados } from "../../shared/tokensAcumulados.js";

export type PessoaPresaStateType = typeof PessoaPresaState.State;

export const PessoaPresaState = Annotation.Root({
  parentesco: Annotation<string | undefined>,
  temProcesso: Annotation<boolean | undefined>,
  numeroProcesso: Annotation<string | undefined>,
  dadosProcesso: Annotation<DadosProcesso | undefined>,
  rg: Annotation<string | undefined>,
  dadosApenado: Annotation<DadosApenado | undefined>,
  tentativasRg: Annotation<number | undefined>,
  querTentarNovamente: Annotation<boolean | undefined>,
  // true quando a resposta de "quer tentar de novo?" já veio como um RG
  // digitado direto (em vez de "Sim"/"Não") — issue #54, achado ao vivo
  // (pessoa pula a confirmação e já manda o RG novo). Nesse caso `rg` já
  // foi atualizado com esse valor e o roteamento pula prepararPerguntaRg
  // (não pergunta "qual o RG?" de novo, a pessoa já respondeu).
  digitouRgDireto: Annotation<boolean | undefined>,
  confirmaNome: Annotation<boolean | undefined>,
  statusFinal: Annotation<"concluido" | "handoff_humano" | undefined>,
  // só preenchido quando statusFinal:"handoff_humano" — os caminhos que
  // levam pro mesmo nó naoConfirmado (nome não confirmado / RG esgotou as 3
  // tentativas) hoje caem indistinguíveis, e os desfechos sem número de
  // processo (issue #49) e com origem de processo não suportada (issue #51)
  // são motivos à parte; isso dá pro atendente/Tykhe saber o motivo sem
  // adivinhar.
  motivoHandoff: Annotation<
    "nome_nao_confirmado" | "rg_nao_encontrado" | "sem_numero_processo" | "origem_processo_nao_suportada" | undefined
  >,
  // texto final específico do desfecho — sobrescreve o texto genérico
  // fluxo.mensagemConcluido/mensagemHandoff (ver
  // rotas/atendimentos.ts::montarRespostaAtendimento), mesmo padrão de
  // fluxos/violenciaDomestica/state.ts. Só o desfecho "sem número de
  // processo" (issue #49) usa isso hoje — os demais continuam com o texto
  // genérico (comportamento inalterado).
  mensagemFinal: Annotation<string | undefined>,
  // texto já reescrito pela IA da PRÓXIMA pergunta a pausar, gerado 1x num nó
  // "preparar" SEPARADO logo antes do nó que pausa em interrupt() — ver
  // prepararPergunta() em ia/reescrever.ts pra saber por que não dá pra
  // chamar a IA dentro do próprio nó que pausa (reexecuta o "antes do
  // interrupt" a cada resume). Compartilhado entre TODAS as perguntas — só
  // uma fica pendente por vez, não precisa de 1 campo por pergunta (o valor
  // é sempre "a reescrita da pergunta que está prestes a pausar agora").
  perguntaAtualTexto: Annotation<string | undefined>,
  // true = perguntaAtualTexto veio da IA; false = a IA falhou e caiu no
  // texto fixo original (ver ia/reescrever.ts) — log estruturado usa isso.
  perguntaAtualViaIA: Annotation<boolean | undefined>,
  perguntaAtualTokensTotal: Annotation<number | undefined>,
  // Soma de TODOS os tokens gastos com IA nesta conversa (issue #35) — ver
  // shared/tokensAcumulados.ts.
  tokensGastosTotal: AnnotationTokensAcumulados(),
});
