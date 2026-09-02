// Shape do campo `metadados` da resposta HTTP pra esse fluxo especificamente
// (schema Swagger + extrator a partir do `values` do grafo) — cada fluxo tem
// o seu, plugado em rotas/atendimentos.ts via registrarRotasAtendimento().
import type { DadosApenado, DadosProcesso } from "../../shared/types.js";

export interface MetadadosPessoaPresa {
  parentesco?: string;
  temProcesso?: boolean;
  numeroProcesso?: string;
  dadosProcesso?: DadosProcesso;
  rg?: string;
  dadosApenado?: DadosApenado;
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
        encontrado: { type: "boolean" },
        id: { type: "number" },
        origem: { type: "string" },
        instancia: { type: "number" },
        nomeAssunto: { type: "string" },
        nomeOrgaoJulgador: { type: "string" },
        movimentos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              titulo: { type: "string" },
              data: { type: "string" },
              descricao: { type: "string" },
              traducao: { type: "string" },
            },
          },
        },
      },
    },
    rg: { type: "string" },
    dadosApenado: {
      type: "object",
      properties: {
        encontrado: { type: "boolean" },
        idSeap: { type: "number" },
        idPessoa: { type: "number" },
        nome: { type: "string" },
        situacao: { type: "string" },
      },
    },
    motivoHandoff: { type: "string", enum: ["nome_nao_confirmado", "rg_nao_encontrado"] },
  },
} as const;

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
    dadosProcesso: v.dadosProcesso,
    rg: v.rg,
    dadosApenado: v.dadosApenado,
    ...(v.motivoHandoff ? { motivoHandoff: v.motivoHandoff } : {}),
  };
}

export const MENSAGEM_CONCLUIDO =
  "Show! Já confirmei os dados da pessoa presa. Vou seguir com o encaminhamento a partir daqui.";
export const MENSAGEM_HANDOFF =
  "Não consegui confirmar os dados da pessoa presa. Vou encaminhar seu atendimento pra equipe verificar com mais calma.";
