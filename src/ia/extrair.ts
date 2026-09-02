import { ChatBedrockConverse } from "@langchain/aws";
import { z } from "zod";
import { logger } from "../shared/logger.js";
import { contextoAtual } from "../shared/contexto.js";

// Mesma config de modelo/região de ia/reescrever.ts (instância própria, não
// compartilhada — cada módulo é independente, repo pequeno não justifica
// extrair um factory só pra isso).
const modelo = new ChatBedrockConverse({
  model: process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-haiku-20240307-v1:0",
  region: process.env.AWS_REGION ?? "us-east-1",
});

const SchemaExtracao = z.object({
  temProcesso: z.boolean().optional().describe("true se a pessoa mencionou ter processo, false se mencionou não ter, ausente se não falou nada sobre isso"),
  numeroProcesso: z.string().optional().describe("número do processo, só os dígitos/formato como foi informado, ausente se não mencionado"),
  rg: z.string().optional().describe("RG da pessoa presa, só os dígitos, ausente se não mencionado"),
  parentesco: z.string().optional().describe("parentesco de quem está falando com a pessoa presa (ex: esposa, mãe, irmão), ausente se não mencionado"),
});

const SISTEMA = `Você extrai dados estruturados do relato livre de alguém buscando informação sobre uma pessoa presa, pra Defensoria Pública do RJ.
Regras: extraia APENAS o que foi dito explicitamente — nunca invente, nunca infira além do texto. Campo não mencionado fica ausente (não force um valor).
"temProcesso" só é true/false se a pessoa falou EXPLICITAMENTE sobre ter ou não processo — não deduza da presença/ausência de "numeroProcesso" no texto.`;

export interface CamposExtraidos {
  temProcesso?: boolean;
  numeroProcesso?: string;
  rg?: string;
  parentesco?: string;
  viaIA: boolean;
}

// Mesmo padrão de guard de ia/reescrever.ts::reescreverPergunta — defesa em
// profundidade. O guard PRINCIPAL de custo/uso é o roteamento condicional no
// START do grafo (fluxos/pessoaPresa/graph.ts), que nem entra no ramo de
// extração se a flag estiver desligada; este aqui garante que mesmo uma
// chamada direta a essa função (ex: engano futuro) não gasta Bedrock à toa
// em teste.
export async function extrairCamposLivre(texto: string): Promise<CamposExtraidos> {
  if (process.env.NODE_ENV === "test" || process.env.EXTRACAO_LIVRE_IA !== "true") {
    return { viaIA: false };
  }
  try {
    const comSaidaEstruturada = modelo.withStructuredOutput(SchemaExtracao);
    const resultado = await comSaidaEstruturada.invoke([
      { role: "system", content: SISTEMA },
      { role: "user", content: texto },
    ]);
    return { ...resultado, viaIA: true };
  } catch (err) {
    logger.error({ ...contextoAtual(), err }, "[extrair] falha ao extrair campos, seguindo sem nada extraído");
    return { viaIA: false };
  }
}
