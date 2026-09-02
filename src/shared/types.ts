// Tipos compartilhados entre fluxos (fluxos/*) e integrações (integracoes/*)
// — não pertencem a um fluxo específico, então não moram dentro de
// fluxos/<nome>/state.ts.

export interface Pergunta {
  pergunta: string;
  tipo: "texto" | "sim_nao" | "opcoes";
  opcoes?: string[];
}

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
