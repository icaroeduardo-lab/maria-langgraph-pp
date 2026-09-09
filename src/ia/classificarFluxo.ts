import { ChatBedrockConverse } from "@langchain/aws";
import { z } from "zod";
import { logger } from "../shared/logger.js";
import { contextoAtual } from "../shared/contexto.js";

// Mesma config de modelo/região dos outros módulos de IA (ia/reescrever.ts,
// ia/extrair.ts) — instância própria, repo pequeno não justifica factory.
const modelo = new ChatBedrockConverse({
  model: process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-haiku-20240307-v1:0",
  region: process.env.AWS_REGION ?? "us-east-1",
});

export interface FluxoParaClassificar {
  id: string;
  nome: string;
  // ver FluxoConfig.descricao em fluxos/index.ts — cada fluxo novo só
  // precisa preencher isso pra entrar na classificação automaticamente,
  // sem tocar neste arquivo.
  descricao: string;
}

export interface ResultadoClassificacao {
  // undefined = não identificado — a IA achou "nenhum" fluxo bater com
  // confiança, ou a chamada falhou. rotas/orquestrador.ts trata isso como
  // handoff_humano, nunca "chuta" um fluxo errado.
  flowId: string | undefined;
  viaIA: boolean;
}

// Classifica o relato livre num dos fluxos cadastrados — usado só pela rota
// do orquestrador (rotas/orquestrador.ts), que existe ao LADO da criação
// manual (POST /atendimentos com flowId explícito, que continua igual).
//
// Pede pra IA responder "nenhum" em vez de forçar um encaixe (mesmo
// racional de campo opcional em ia/extrair.ts: nunca inventar/forçar) — dá
// pra crescer a lista de fluxos (fluxos/index.ts) sem precisar mexer aqui,
// só preenchendo a descrição de cada um.
export async function classificarFluxo(mensagem: string, fluxos: FluxoParaClassificar[]): Promise<ResultadoClassificacao> {
  // NODE_ENV=test nunca chama Bedrock de verdade — mesmo padrão de
  // ia/reescrever.ts e ia/extrair.ts (suíte rápida, sem custo, sem
  // variabilidade). MOCK_CLASSIFICACAO_FLOWID deixa o teste escolher o
  // resultado (vazio/ausente = "nenhum", igual à IA responder "nenhum").
  if (process.env.NODE_ENV === "test") {
    const mockId = process.env.MOCK_CLASSIFICACAO_FLOWID;
    return { flowId: mockId || undefined, viaIA: false };
  }
  try {
    const ids = fluxos.map((f) => f.id);
    if (ids.length === 0) return { flowId: undefined, viaIA: false };
    const Schema = z.object({
      flowId: z
        .enum(["nenhum", ...ids])
        .describe('id do fluxo que melhor atende ao relato, ou "nenhum" se não bater com confiança em nenhuma descrição'),
    });
    const descricoes = fluxos.map((f) => `- id "${f.id}" (${f.nome}): ${f.descricao}`).join("\n");
    const sistema = `Você tria o relato de alguém buscando atendimento na Defensoria Pública do RJ, escolhendo qual fluxo de atendimento resolve o caso.
Fluxos disponíveis:
${descricoes}
Regras: escolha "nenhum" se o relato não bater CLARAMENTE com nenhuma descrição acima — nunca force um encaixe, nunca invente. Ambiguidade real (ex: pode ser mais de um fluxo) também é "nenhum".`;
    const comSaidaEstruturada = modelo.withStructuredOutput(Schema);
    const resultado = await comSaidaEstruturada.invoke([
      { role: "system", content: sistema },
      { role: "user", content: mensagem },
    ]);
    return { flowId: resultado.flowId === "nenhum" ? undefined : resultado.flowId, viaIA: true };
  } catch (err) {
    logger.error({ ...contextoAtual(), err }, "[classificarFluxo] falha ao classificar, tratando como não identificado");
    return { flowId: undefined, viaIA: false };
  }
}
