import type { GrafoAtendimento } from "../rotas/atendimentos.js";
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
  grafo: GrafoAtendimento;
  metadadosSchema: object;
  extrairMetadados: (values: Record<string, unknown>) => object;
  mensagemConcluido: string;
  mensagemHandoff: string;
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
    grafo: grafoPessoaPresa as unknown as GrafoAtendimento,
    metadadosSchema: metadadosSchemaPessoaPresa,
    extrairMetadados: extrairMetadadosPessoaPresa,
    mensagemConcluido: MENSAGEM_CONCLUIDO_PESSOA_PRESA,
    mensagemHandoff: MENSAGEM_HANDOFF_PESSOA_PRESA,
  },
  [ID_VIOLENCIA_DOMESTICA]: {
    nome: "violencia-domestica",
    grafo: grafoViolenciaDomestica as unknown as GrafoAtendimento,
    metadadosSchema: metadadosSchemaViolenciaDomestica,
    extrairMetadados: extrairMetadadosViolenciaDomestica,
    mensagemConcluido: MENSAGEM_CONCLUIDO_VD,
    mensagemHandoff: MENSAGEM_HANDOFF_VD,
  },
};

export function buscarFluxo(fluxoId: string): FluxoConfig | undefined {
  return fluxosPorId[fluxoId];
}
