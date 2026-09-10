import type { GrafoAtendimento } from "../rotas/atendimentos.js";
import { fluxosPlanejados, type FluxoPlanejado } from "./catalogo.js";
import { grafo as grafoPessoaPresa } from "./pessoaPresa/graph.js";
import {
  metadadosSchemaPessoaPresa,
  extrairMetadadosPessoaPresa,
  MENSAGEM_CONCLUIDO as MENSAGEM_CONCLUIDO_PESSOA_PRESA,
  MENSAGEM_HANDOFF as MENSAGEM_HANDOFF_PESSOA_PRESA,
} from "./pessoaPresa/api.js";
import { grafo as grafoViolenciaDomestica } from "./violenciaDomestica/graph.js";
import {
  metadadosSchemaViolenciaDomestica,
  extrairMetadadosViolenciaDomestica,
  MENSAGEM_CONCLUIDO as MENSAGEM_CONCLUIDO_VD,
  MENSAGEM_HANDOFF as MENSAGEM_HANDOFF_VD,
} from "./violenciaDomestica/api.js";

export interface FluxoConfig {
  nome: string;
  // usada por ia/classificarFluxo.ts pra escolher o fluxo certo a partir do
  // relato livre (rotas/orquestrador.ts) — texto curto, em pt-BR, descrevendo
  // pra quem/qual situação esse fluxo serve. Cada fluxo novo que for
  // adicionado (ver comentário em ID_PESSOA_PRESA abaixo) só precisa
  // preencher isso pra já entrar na classificação automática.
  descricao: string;
  grafo: GrafoAtendimento;
  metadadosSchema: object;
  extrairMetadados: (values: Record<string, unknown>) => object;
  mensagemConcluido: string;
  mensagemHandoff: string;
  // idCategoriaAssunto do Verde (GET /integra/assunto/categorias) que
  // corresponde a este fluxo, quando existe um — ver issue #19. Ausente
  // quando não há categoria do Verde equivalente (ex: pessoa presa não tem
  // categoria própria no Verde). Usado só pra evitar duplicar esse fluxo em
  // fluxosPlanejados (catalogo.ts) quando o catálogo do Verde for carregado
  // — não afeta classificação nem é exposto pro usuário.
  idCategoriaAssuntoVerde?: number;
}

// Id fixo por fluxo — hoje hardcoded aqui (sem banco ainda), mas já no
// formato que uma linha de tabela teria (uuid). Migrar pra banco depois =
// trocar esse objeto por uma query, o contrato HTTP (/atendimentos/:fluxoId)
// não muda.
export const ID_PESSOA_PRESA = "3df874f2-675a-4c43-9ec7-480f7c702f50";
export const ID_VIOLENCIA_DOMESTICA = "cabb2495-4e12-4f4a-9956-3d20649059bc";

export const fluxosPorId: Record<string, FluxoConfig> = {
  [ID_PESSOA_PRESA]: {
    nome: "pessoa-presa",
    descricao:
      "Alguém (geralmente familiar) buscando informação ou encaminhamento sobre uma pessoa que está presa — situação prisional, processo, número do processo, dados do apenado no sistema penitenciário.",
    grafo: grafoPessoaPresa as unknown as GrafoAtendimento,
    metadadosSchema: metadadosSchemaPessoaPresa,
    extrairMetadados: extrairMetadadosPessoaPresa,
    mensagemConcluido: MENSAGEM_CONCLUIDO_PESSOA_PRESA,
    mensagemHandoff: MENSAGEM_HANDOFF_PESSOA_PRESA,
  },
  [ID_VIOLENCIA_DOMESTICA]: {
    nome: "violencia-domestica",
    descricao:
      "Mulher vítima de violência doméstica buscando ajuda, proteção ou encaminhamento jurídico — relato de agressão física/psicológica, medo do agressor, com ou sem Boletim de Ocorrência já registrado.",
    grafo: grafoViolenciaDomestica as unknown as GrafoAtendimento,
    metadadosSchema: metadadosSchemaViolenciaDomestica,
    extrairMetadados: extrairMetadadosViolenciaDomestica,
    mensagemConcluido: MENSAGEM_CONCLUIDO_VD,
    mensagemHandoff: MENSAGEM_HANDOFF_VD,
    // idCategoriaAssunto real do Verde (GET /assunto/categorias, confirmado
    // ao vivo 2026-09-10) — ver issue #19.
    idCategoriaAssuntoVerde: 10113,
  },
};

export function buscarFluxo(fluxoId: string): FluxoConfig | undefined {
  return fluxosPorId[fluxoId];
}

// Catálogo COMPLETO pra classificação (ia/classificarFluxo.ts, via
// rotas/orquestrador.ts) — implementados (fluxosPorId, com grafo de verdade)
// + planejados (catalogo.ts, só descrição, sem código ainda). A IA pode
// escolher um planejado; o orquestrador detecta que buscarFluxo() não acha
// nada pra esse id e cai em handoff_humano, logando o id/nome pra medir
// demanda de fluxo ainda não implementado.
export function catalogoParaClassificacao(): Array<{ id: string; nome: string; descricao: string }> {
  const implementados = Object.entries(fluxosPorId).map(([id, cfg]) => ({ id, nome: cfg.nome, descricao: cfg.descricao }));
  return [...implementados, ...fluxosPlanejados];
}

export function buscarFluxoPlanejado(fluxoId: string): FluxoPlanejado | undefined {
  return fluxosPlanejados.find((f) => f.id === fluxoId);
}
