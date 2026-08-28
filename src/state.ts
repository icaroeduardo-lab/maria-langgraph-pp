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
});
