import { Annotation } from "@langchain/langgraph";

export type PessoaPresaStateType = typeof PessoaPresaState.State;

export interface DadosApenado {
  encontrado: boolean;
  idSeap?: number;
  idPessoa?: number;
  nome?: string;
  situacao?: string;
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
  rg: Annotation<string | undefined>,
  dadosApenado: Annotation<DadosApenado | undefined>,
  tentativasRg: Annotation<number | undefined>,
  querTentarNovamente: Annotation<boolean | undefined>,
  confirmaNome: Annotation<boolean | undefined>,
  statusFinal: Annotation<"concluido" | "handoff_humano" | undefined>,
  // texto já reescrito pela IA, gerado 1x num nó separado ANTES do nó que
  // pausa em interrupt() — ver comentário em prepararPerguntaParentesco em
  // graph.ts sobre por que não dá pra chamar a IA dentro do próprio nó que
  // pausa (reexecuta o "antes do interrupt" a cada resume).
  perguntaParentescoTexto: Annotation<string | undefined>,
  // true = perguntaParentescoTexto veio da IA; false = a IA falhou e caiu no
  // texto fixo original (ver reescrever.ts) — log estruturado usa isso.
  perguntaParentescoViaIA: Annotation<boolean | undefined>,
  perguntaParentescoTokensTotal: Annotation<number | undefined>,
});
