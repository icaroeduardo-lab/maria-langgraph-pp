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

export interface EnderecoDetalhado {
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  // usado pra decidir capital x outras cidades no fluxo violenciaDomestica
  // (ver fluxos/violenciaDomestica/graph.ts) — comparado contra "Rio de Janeiro".
  municipio?: string;
  uf?: string;
  cep?: string;
}

export interface DadosPessoa {
  encontrado: boolean;
  idPessoa?: number;
  nome?: string;
  nomeSocial?: string;
  genero?: string;
  endereco?: string;
  enderecoDetalhado?: EnderecoDetalhado;
}
