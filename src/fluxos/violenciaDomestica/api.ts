// Shape do campo `metadados` da resposta HTTP pra esse fluxo especificamente
// — mesmo padrão de fluxos/pessoaPresa/api.ts.
import type { DadosPessoa, DadosProcesso } from "../../shared/types.js";

export interface MetadadosViolenciaDomestica {
  ehVitima?: boolean;
  temProcesso?: boolean;
  numeroProcesso?: string;
  dadosProcesso?: DadosProcesso;
  temRegistroOcorrencia?: boolean;
  dadosPessoa?: DadosPessoa;
  tipoEncaminhamento?: string;
  motivoHandoff?: string;
}

export const metadadosSchemaViolenciaDomestica = {
  type: "object",
  properties: {
    ehVitima: { type: "boolean" },
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
    temRegistroOcorrencia: { type: "boolean" },
    dadosPessoa: {
      type: "object",
      properties: {
        encontrado: { type: "boolean" },
        idPessoa: { type: "number" },
        nome: { type: "string" },
        nomeSocial: { type: "string" },
        genero: { type: "string" },
        endereco: { type: "string" },
        enderecoDetalhado: {
          type: "object",
          properties: {
            logradouro: { type: "string" },
            numero: { type: "string" },
            complemento: { type: "string" },
            bairro: { type: "string" },
            municipio: { type: "string" },
            uf: { type: "string" },
            cep: { type: "string" },
          },
        },
      },
    },
    tipoEncaminhamento: { type: "string", enum: ["nudem", "defensoria_vitima_juizado", "urgente_juizado"] },
    motivoHandoff: { type: "string", enum: ["nao_e_vitima"] },
  },
} as const;

export function extrairMetadadosViolenciaDomestica(values: Record<string, unknown>): MetadadosViolenciaDomestica {
  const v = values as {
    ehVitima?: boolean;
    temProcesso?: boolean;
    numeroProcesso?: string;
    dadosProcesso?: DadosProcesso;
    temRegistroOcorrencia?: boolean;
    dadosPessoa?: DadosPessoa;
    tipoEncaminhamento?: string;
    motivoHandoff?: string;
  };
  return {
    ehVitima: v.ehVitima,
    temProcesso: v.temProcesso,
    numeroProcesso: v.numeroProcesso,
    dadosProcesso: v.dadosProcesso,
    temRegistroOcorrencia: v.temRegistroOcorrencia,
    dadosPessoa: v.dadosPessoa,
    ...(v.tipoEncaminhamento ? { tipoEncaminhamento: v.tipoEncaminhamento } : {}),
    ...(v.motivoHandoff ? { motivoHandoff: v.motivoHandoff } : {}),
  };
}

// Cada desfecho do grafo (graph.ts) seta um destes como mensagemFinal no
// state — rotas/atendimentos.ts usa esse campo em vez do texto genérico
// abaixo (ver montarRespostaAtendimento). Textos ainda não validados com o
// time jurídico — revisar fraseado antes de produção.
export const MENSAGEM_NAO_VITIMA =
  "Esse atendimento é destinado apenas para quem é vítima da violência. Vou encaminhar você para um atendente humano.";
export const MENSAGEM_NUDEM =
  "Como você ainda não tem Boletim de Ocorrência e mora na capital, vou encaminhar seu caso para o NUDEM.";
export const MENSAGEM_DEFENSORIA_VITIMA_JUIZADO =
  "Como você ainda não tem Boletim de Ocorrência, vou encaminhar seu caso para a Defensoria pela Vítima, junto ao Juizado de Violência Doméstica da sua região.";
export const MENSAGEM_URGENTE_JUIZADO =
  "Como você já tem Boletim de Ocorrência, vou encaminhar seu atendimento com urgência para o Juizado de Violência Doméstica competente — sem necessidade de agendamento.";

// Fallback genérico exigido pelo contrato FluxoConfig (fluxos/index.ts) —
// todo desfecho real deste fluxo seta mensagemFinal (acima), então isso só
// entraria em jogo num estado inesperado/bug.
export const MENSAGEM_CONCLUIDO = "Vou seguir com o encaminhamento do seu atendimento.";
export const MENSAGEM_HANDOFF = "Vou encaminhar seu atendimento para um atendente humano.";
