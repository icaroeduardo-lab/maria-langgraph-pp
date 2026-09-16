// Shape do campo `metadados` da resposta HTTP pra esse fluxo especificamente
// (schema Swagger + extrator a partir do `values` do grafo) — cada fluxo tem
// o seu, plugado em rotas/atendimentos.ts via registrarRotasAtendimento().
import type { DadosApenado, DadosProcesso } from "../../shared/types.js";

// Recortes de DadosProcesso/DadosApenado — só os campos que outro sistema
// vai consumir de verdade (payload de encaminhamento do fluxo prisional:
// Origem do Processo, Nome, idProcesso, RG, Situação, Tipo de preso, Regime,
// idPessoa, idSeap). Decisão 2026-09-09: dadosProcesso/dadosApenado
// COMPLETOS (movimentos, instancia, nomeAssunto, nomeOrgaoJulgador,
// encontrado) tinham campo demais expostos sem necessidade — corta aqui,
// não no tipo interno (DadosProcesso/DadosApenado seguem completos pra
// quem usa dentro do grafo).
export interface DadosProcessoResumo {
  id?: number;
  origem?: string;
}

export interface DadosApenadoResumo {
  idSeap?: number;
  idPessoa?: number;
  nome?: string;
  situacao?: string;
  tipoPreso?: string;
  regime?: string;
}

export interface MetadadosPessoaPresa {
  parentesco?: string;
  temProcesso?: boolean;
  numeroProcesso?: string;
  dadosProcesso?: DadosProcessoResumo;
  rg?: string;
  dadosApenado?: DadosApenadoResumo;
  motivoHandoff?: string;
}

// Schema JSON (não Zod) — @fastify/swagger dynamic mode lê isso direto dos
// options de cada rota pra montar o /docs. Espelha a interface acima à mão
// (não tem geração automática TS→JSON Schema aqui, repo pequeno/experimental).
export const metadadosSchemaPessoaPresa = {
  type: "object",
  properties: {
    parentesco: { type: "string" },
    temProcesso: { type: "boolean" },
    numeroProcesso: { type: "string" },
    dadosProcesso: {
      type: "object",
      properties: {
        id: { type: "number" },
        origem: { type: "string" },
      },
    },
    rg: { type: "string" },
    dadosApenado: {
      type: "object",
      properties: {
        idSeap: { type: "number" },
        idPessoa: { type: "number" },
        nome: { type: "string" },
        situacao: { type: "string" },
        tipoPreso: { type: "string" },
        regime: { type: "string" },
      },
    },
    motivoHandoff: { type: "string", enum: ["nome_nao_confirmado", "rg_nao_encontrado", "sem_numero_processo"] },
  },
} as const;

function resumirDadosProcesso(d: DadosProcesso | undefined): DadosProcessoResumo | undefined {
  if (!d) return undefined;
  return { id: d.id, origem: d.origem };
}

function resumirDadosApenado(d: DadosApenado | undefined): DadosApenadoResumo | undefined {
  if (!d) return undefined;
  return { idSeap: d.idSeap, idPessoa: d.idPessoa, nome: d.nome, situacao: d.situacao, tipoPreso: d.tipoPreso, regime: d.regime };
}

export function extrairMetadadosPessoaPresa(values: Record<string, unknown>): MetadadosPessoaPresa {
  const v = values as {
    parentesco?: string;
    temProcesso?: boolean;
    numeroProcesso?: string;
    dadosProcesso?: DadosProcesso;
    rg?: string;
    dadosApenado?: DadosApenado;
    motivoHandoff?: string;
  };
  return {
    parentesco: v.parentesco,
    temProcesso: v.temProcesso,
    numeroProcesso: v.numeroProcesso,
    dadosProcesso: resumirDadosProcesso(v.dadosProcesso),
    rg: v.rg,
    dadosApenado: resumirDadosApenado(v.dadosApenado),
    ...(v.motivoHandoff ? { motivoHandoff: v.motivoHandoff } : {}),
  };
}

export const MENSAGEM_CONCLUIDO =
  "Show! Já confirmei os dados da pessoa presa. Vou seguir com o encaminhamento a partir daqui.";
export const MENSAGEM_HANDOFF =
  "Não consegui confirmar os dados da pessoa presa. Vou encaminhar seu atendimento pra equipe verificar com mais calma.";
// Issue #49 — diferente do MENSAGEM_HANDOFF genérico acima (que soa como
// "não consegui confirmar"), aqui os dados FORAM confirmados (RG, nome,
// parentesco) — só falta o número do processo, que só um atendente
// consegue levantar. Setado como mensagemFinal (não usa o texto genérico).
export const MENSAGEM_HANDOFF_SEM_NUMERO_PROCESSO =
  "Já confirmei os dados da pessoa presa, mas como você não tem o número do processo, vou encaminhar seu atendimento pra equipe localizar isso e dar continuidade.";
