import { Annotation } from "@langchain/langgraph";

export type PessoaPresaStateType = typeof PessoaPresaState.State;

export interface DadosApenado {
  encontrado: boolean;
  idSeap?: number;
  idPessoa?: number;
  nome?: string;
  situacao?: string;
}

export interface MovimentoProcesso {
  titulo?: string;
  data?: string;
  descricao?: string;
  // explicação em linguagem simples pro cidadão — vem pronta do Verde,
  // não é gerada por nós.
  traducao?: string;
}

export interface DadosProcesso {
  encontrado: boolean;
  id?: number;
  origem?: string;
  instancia?: number;
  nomeAssunto?: string;
  nomeOrgaoJulgador?: string;
  movimentos?: MovimentoProcesso[];
}

export interface Pergunta {
  pergunta: string;
  tipo: "texto" | "sim_nao" | "opcoes";
  opcoes?: string[];
}

export const PessoaPresaState = Annotation.Root({
  parentesco: Annotation<string | undefined>,
  temProcesso: Annotation<boolean | undefined>,
  numeroProcesso: Annotation<string | undefined>,
  dadosProcesso: Annotation<DadosProcesso | undefined>,
  rg: Annotation<string | undefined>,
  dadosApenado: Annotation<DadosApenado | undefined>,
  tentativasRg: Annotation<number | undefined>,
  querTentarNovamente: Annotation<boolean | undefined>,
  confirmaNome: Annotation<boolean | undefined>,
  statusFinal: Annotation<"concluido" | "handoff_humano" | undefined>,
  // só preenchido quando statusFinal:"handoff_humano" — os 2 caminhos que
  // levam pro mesmo nó naoConfirmado (nome não confirmado / RG esgotou as 3
  // tentativas) hoje caem indistinguíveis; isso dá pro atendente/Tykhe saber
  // o motivo sem adivinhar.
  motivoHandoff: Annotation<"nome_nao_confirmado" | "rg_nao_encontrado" | undefined>,
  // texto já reescrito pela IA da PRÓXIMA pergunta a pausar, gerado 1x num nó
  // "preparar" SEPARADO logo antes do nó que pausa em interrupt() — ver
  // prepararPergunta() em graph.ts pra saber por que não dá pra chamar a IA
  // dentro do próprio nó que pausa (reexecuta o "antes do interrupt" a cada
  // resume). Compartilhado entre TODAS as perguntas — só uma fica pendente
  // por vez, não precisa de 1 campo por pergunta (o valor é sempre "a
  // reescrita da pergunta que está prestes a pausar agora").
  perguntaAtualTexto: Annotation<string | undefined>,
  // true = perguntaAtualTexto veio da IA; false = a IA falhou e caiu no
  // texto fixo original (ver reescrever.ts) — log estruturado usa isso.
  perguntaAtualViaIA: Annotation<boolean | undefined>,
  perguntaAtualTokensTotal: Annotation<number | undefined>,
});
