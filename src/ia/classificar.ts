import { ChatBedrockConverse } from "@langchain/aws";
import { z } from "zod";
import { logger } from "../shared/logger.js";
import { contextoAtual } from "../shared/contexto.js";

// Núcleo reaproveitável de "texto livre + lista de candidatos rotulados →
// candidato escolhido via IA" — extraído de classificarFluxo.ts (issue #8)
// pra servir também outros cenários que precisam do mesmo formato de
// problema (ex: qual campo atualizar num fluxo de dados, normalizar
// parentesco em texto livre pra um valor de lista fechada). Cada chamador
// mantém seu PRÓPRIO guard de NODE_ENV=test/mock (mesmo padrão de
// ia/extrair.ts e ia/reescrever.ts) — este módulo não decide isso, só faz a
// chamada real quando invocado.
const modelo = new ChatBedrockConverse({
  model: process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-haiku-20240307-v1:0",
  region: process.env.AWS_REGION ?? "us-east-1",
});

export interface ResultadoClassificacaoGenerica {
  // undefined = a IA não achou nenhum candidato bater com confiança, ou a
  // chamada falhou — chamador decide o que fazer (handoff, manter texto
  // original, etc), este módulo nunca "chuta" um candidato errado.
  escolhaId: string | undefined;
  viaIA: boolean;
}

// `sistema` já vem PRONTO do chamador (papel + lista de candidatos + regras
// — cada domínio tem seu próprio texto/tom, não dá pra generalizar isso sem
// perder qualidade do prompt). `ids` é só a lista de ids válidos pro enum
// de saída estruturada (tem que bater com o que o `sistema` descreveu).
export async function classificarEntreOpcoes(mensagem: string, sistema: string, ids: string[]): Promise<ResultadoClassificacaoGenerica> {
  try {
    if (ids.length === 0) return { escolhaId: undefined, viaIA: false };
    const Schema = z.object({
      escolhaId: z.enum(["nenhum", ...ids]).describe('id do candidato que melhor atende, ou "nenhum" se não bater com confiança em nenhum'),
    });
    const comSaidaEstruturada = modelo.withStructuredOutput(Schema);
    const resultado = await comSaidaEstruturada.invoke([
      { role: "system", content: sistema },
      { role: "user", content: mensagem },
    ]);
    return { escolhaId: resultado.escolhaId === "nenhum" ? undefined : resultado.escolhaId, viaIA: true };
  } catch (err) {
    logger.error({ ...contextoAtual(), err }, "[classificar] falha ao classificar, tratando como não identificado");
    return { escolhaId: undefined, viaIA: false };
  }
}

export interface ResultadoClassificacaoMultipla {
  // TODOS os candidatos plausíveis — 0 (nenhum bate), 1 (claro) ou vários
  // (ambíguo, chamador decide o que fazer, ex: orquestrador/graph.ts pede
  // desambiguação). Diferente de classificarEntreOpcoes, que força 1 só.
  ids: string[];
  viaIA: boolean;
}

// Mesma ideia de classificarEntreOpcoes, mas devolve TODOS os candidatos
// plausíveis em vez de forçar uma escolha única — usado quando o chamador
// precisa saber se o relato é ambíguo entre vários candidatos (issue #28),
// não só "qual é o melhor".
export async function classificarMultiploEntreOpcoes(mensagem: string, sistema: string, ids: string[]): Promise<ResultadoClassificacaoMultipla> {
  try {
    if (ids.length === 0) return { ids: [], viaIA: false };
    const Schema = z.object({
      idsPlausiveis: z
        .array(z.enum(ids as [string, ...string[]]))
        .describe(
          "ids de TODOS os candidatos que plausivelmente atendem ao relato — lista vazia se nenhum bater com confiança, 1 item se for claro, vários se o relato for genuinamente ambíguo entre mais de um. Nunca inventa id fora da lista."
        ),
    });
    const comSaidaEstruturada = modelo.withStructuredOutput(Schema);
    const resultado = await comSaidaEstruturada.invoke([
      { role: "system", content: sistema },
      { role: "user", content: mensagem },
    ]);
    return { ids: resultado.idsPlausiveis, viaIA: true };
  } catch (err) {
    logger.error({ ...contextoAtual(), err }, "[classificar] falha ao classificar (múltiplo), tratando como não identificado");
    return { ids: [], viaIA: false };
  }
}
