import { ChatBedrockConverse } from "@langchain/aws";
import { AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import { logger } from "../shared/logger.js";
import { contextoAtual } from "../shared/contexto.js";

// Mesma config de modelo/região dos outros módulos de IA (ia/classificar.ts,
// ia/extrair.ts) — instância própria, repo pequeno não justifica factory.
const modelo = new ChatBedrockConverse({
  model: process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-haiku-20240307-v1:0",
  region: process.env.AWS_REGION ?? "us-east-1",
});

export interface CandidatoParaDesambiguar {
  id: string;
  nome: string;
  descricao: string;
}

export interface ResultadoDesambiguacao {
  pergunta: string;
  viaIA: boolean;
  // ausente quando viaIA:false (não teve chamada de verdade, não gastou nada).
  tokensEntrada?: number;
  tokensSaida?: number;
  tokensTotal?: number;
}

const TEXTO_FALLBACK = "Pra te ajudar melhor, qual dessas opções descreve o que você precisa?";

const SchemaPergunta = z.object({
  pergunta: z
    .string()
    .describe("pergunta curta, natural, em português do Brasil, que ajuda a pessoa a escolher entre as opções — sem citar nomes técnicos/internos"),
});

// Gera 1 pergunta que ajuda a distinguir entre candidatos ambíguos (issue
// #28) — usada pelo orquestrador (src/orquestrador/graph.ts) quando o
// relato bate com mais de 1 fluxo plausível. As OPÇÕES em si (nome de cada
// fluxo) não vêm da IA — são montadas deterministicamente pelo chamador, só
// o TEXTO da pergunta é gerado aqui, pra nunca inventar uma opção que não
// existe de verdade no catálogo.
export async function gerarPerguntaDesambiguacao(relato: string, candidatos: CandidatoParaDesambiguar[]): Promise<ResultadoDesambiguacao> {
  // NODE_ENV=test nunca chama Bedrock de verdade — mesmo padrão do resto do
  // repo (suíte rápida, sem custo, sem variabilidade).
  if (process.env.NODE_ENV === "test") return { pergunta: TEXTO_FALLBACK, viaIA: false };
  try {
    const opcoes = candidatos.map((c) => `- ${c.nome}: ${c.descricao}`).join("\n");
    const sistema = `Você ajuda a Defensoria Pública do RJ a esclarecer qual tipo de atendimento uma pessoa precisa, quando o relato dela bate com mais de uma opção.
Opções possíveis:
${opcoes}
Gere 1 pergunta curta, natural, em português, que ajude a pessoa a escolher entre essas opções — foque na diferença prática entre elas, sem citar nomes técnicos/internos.`;
    // includeRaw:true devolve { raw, parsed } em vez de só o objeto
    // parseado — raw é a AIMessage crua, com usage_metadata (issue #34).
    const comSaidaEstruturada = modelo.withStructuredOutput(SchemaPergunta, { includeRaw: true });
    // Converse API exige que a conversa comece com mensagem "user" — nunca
    // só "system" (achado ao vivo 2026-09-11, ValidationException). O relato
    // em si é o conteúdo natural dessa mensagem, não precisa duplicar no
    // system prompt.
    const resultado = await comSaidaEstruturada.invoke([
      { role: "system", content: sistema },
      { role: "user", content: relato },
    ]);
    const uso = resultado.raw instanceof AIMessage ? resultado.raw.usage_metadata : undefined;
    return {
      pergunta: resultado.parsed.pergunta,
      viaIA: true,
      tokensEntrada: uso?.input_tokens,
      tokensSaida: uso?.output_tokens,
      tokensTotal: uso?.total_tokens,
    };
  } catch (err) {
    logger.error({ ...contextoAtual(), err }, "[desambiguar] falha ao gerar pergunta, usando texto genérico");
    return { pergunta: TEXTO_FALLBACK, viaIA: false };
  }
}
