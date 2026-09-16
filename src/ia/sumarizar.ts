import { ChatBedrockConverse } from "@langchain/aws";
import { AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import { logger } from "../shared/logger.js";
import { contextoAtual } from "../shared/contexto.js";

// Mesma config de modelo/região dos outros módulos de IA (ia/classificar.ts,
// ia/desambiguar.ts) — instância própria, repo pequeno não justifica factory.
const modelo = new ChatBedrockConverse({
  model: process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-haiku-20240307-v1:0",
  region: process.env.AWS_REGION ?? "us-east-1",
});

// Absorve instabilidade passageira do Bedrock (throttle, timeout de rede)
// antes de cair no fallback (issue #46, mesmo padrão dos outros módulos).
const TENTATIVAS_RETRY_IA = 3;

const SchemaResumo = z.object({
  resumo: z
    .string()
    .describe(
      "resumo curto e objetivo do relato até agora, preservando os fatos relevantes pra identificar que tipo de atendimento a pessoa precisa — sem perder detalhes que ajudem a classificação"
    ),
});

const SISTEMA = `Você resume o relato de alguém buscando atendimento na Defensoria Pública do RJ.
Regras: preserve os fatos relevantes pra identificar que tipo de caso é (pessoas envolvidas, situação, o que a pessoa quer) — resumo curto e objetivo, sem invenção de informação nova.`;

export interface ResultadoResumo {
  resumo: string;
  // false = a IA falhou (ou é teste) e o texto original foi mantido como
  // "resumo" — sinaliza pro chamador se realmente comprimiu ou não.
  viaIA: boolean;
  // ausente quando viaIA:false (não teve chamada de verdade, não gastou nada).
  tokensEntrada?: number;
  tokensSaida?: number;
  tokensTotal?: number;
}

// Issue #47 — sumariza o relato acumulado do orquestrador (orquestrador/graph.ts)
// quando a desambiguação passa de um limite de rodadas, evitando reenviar o
// histórico bruto inteiro (que só cresce) em toda chamada de classificação/
// desambiguação daí em diante.
//
// Se a IA falhar, mantém o texto original (nunca perde contexto por causa
// de uma falha de resumo) — mesmo princípio de reescreverPergunta/extrairCamposLivre.
//
// NODE_ENV=test pula a chamada de verdade (mesmo padrão do resto do repo) —
// MOCK_SUMARIZACAO_RESUMO permite simular uma compressão de verdade nos
// testes (senão o texto original é devolvido sem encolher, o que é seguro
// mas não testa o efeito de "ficar menor").
export async function sumarizarRelato(textoAcumulado: string): Promise<ResultadoResumo> {
  if (process.env.NODE_ENV === "test") {
    return { resumo: process.env.MOCK_SUMARIZACAO_RESUMO ?? textoAcumulado, viaIA: false };
  }
  try {
    const comSaidaEstruturada = modelo.withStructuredOutput(SchemaResumo, { includeRaw: true }).withRetry({ stopAfterAttempt: TENTATIVAS_RETRY_IA });
    const resultado = await comSaidaEstruturada.invoke([
      { role: "system", content: SISTEMA },
      { role: "user", content: textoAcumulado },
    ]);
    const uso = resultado.raw instanceof AIMessage ? resultado.raw.usage_metadata : undefined;
    return {
      resumo: resultado.parsed.resumo,
      viaIA: true,
      tokensEntrada: uso?.input_tokens,
      tokensSaida: uso?.output_tokens,
      tokensTotal: uso?.total_tokens,
    };
  } catch (err) {
    logger.error({ ...contextoAtual(), err }, "[sumarizar] falha ao sumarizar, mantendo texto original");
    return { resumo: textoAcumulado, viaIA: false };
  }
}
