import { ChatBedrockConverse } from "@langchain/aws";
import { AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import { logger } from "../shared/logger.js";
import { contextoAtual } from "../shared/contexto.js";

// Reescreve o TEXTO de uma pergunta (deixa mais natural) sem mudar O QUE é
// perguntado — o campo/ordem continuam 100% determinísticos no grafo, só a
// frase muda. Mesma ideia de "reescrita de pergunta" do app principal
// (maria-ia-back-end), sem o cache de hit/miss por enquanto (adicionar se o
// custo/latência incomodar de verdade).
const modelo = new ChatBedrockConverse({
  model: process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-haiku-20240307-v1:0",
  region: process.env.AWS_REGION ?? "us-east-1",
});

// Absorve instabilidade passageira do Bedrock (throttle, timeout de rede)
// antes de cair no texto original (issue #46) — poucas tentativas, não é
// pra mascarar erro real, só evitar que 1 piscada vire fallback.
const TENTATIVAS_RETRY_IA = 3;

const SchemaReescrita = z.object({
  pergunta: z.string().describe("a pergunta reescrita, curta e natural, em português do Brasil"),
});

const SISTEMA = `Você reescreve perguntas de um formulário jurídico da Defensoria Pública do RJ.
Regras: mantenha o MESMO significado — nunca invente informação nova, nunca mude o que está sendo pedido.
Tom acolhedor, claro, direto. Português do Brasil com emoji (se for possível). Uma frase só, terminada em "?".
Preserve a ordem natural das palavras perto de nomes próprios e do termo "pessoa presa" — nunca separe "presa"
do que ela qualifica (ex: NUNCA "Essa é o Fulano presa?"; prefira "Essa pessoa presa é o Fulano?" ou manter a
estrutura original). Reescreva o tom/fraseado, não a ordem das informações.`;

export interface ResultadoReescrita {
  texto: string;
  // false = a IA falhou e caiu no texto original (objetivoBase) — sinaliza
  // pro chamador (fluxos/*/graph.ts -> log estruturado em rotas/atendimentos.ts)
  // se essa pergunta específica saiu reescrita ou não, sem precisar comparar string.
  viaIA: boolean;
  // ausente quando viaIA:false (não teve chamada de verdade, não gastou nada).
  tokensEntrada?: number;
  tokensSaida?: number;
  tokensTotal?: number;
}

// Se a chamada à IA falhar (rede, credencial, throttling), cai no texto
// original (`objetivoBase`) — nunca deixa a pergunta sumir por causa disso.
//
// NODE_ENV=test pula a chamada de verdade (mesmo padrão já usado pro chatId
// em rotas/atendimentos.ts) — sem isso a suíte de testes fica lenta (2-6s por
// pergunta, Bedrock real), gasta dinheiro à toa a cada `pnpm test`, E vira
// frágil (texto reescrito varia entre execuções, quebra assert de texto
// fixo). Testar a reescrita de verdade fica pra um teste isolado que força
// NODE_ENV != "test" de propósito (ver test-integracao/reescrever.test.ts).
//
// REESCREVER_IA desligado por padrão (2026-08-31) — decisão explícita do
// usuário depois de ver reescrita com fraseado estranho ("Essa é o Fulano
// presa?") em produção real. Perguntas fixas por enquanto, sem apagar a
// integração — religar setando REESCREVER_IA=true quando o prompt estiver
// mais confiável.
export async function reescreverPergunta(campo: string, objetivoBase: string): Promise<ResultadoReescrita> {
  if (process.env.NODE_ENV === "test" || process.env.REESCREVER_IA !== "true") {
    return { texto: objetivoBase, viaIA: false };
  }
  try {
    // includeRaw:true devolve { raw, parsed } em vez de só o objeto parseado
    // — raw é a AIMessage crua, com usage_metadata (tokens de entrada/saída/
    // total). Sem isso não tem como saber quanto essa chamada custou.
    const comSaidaEstruturada = modelo.withStructuredOutput(SchemaReescrita, { includeRaw: true }).withRetry({ stopAfterAttempt: TENTATIVAS_RETRY_IA });
    const resultado = await comSaidaEstruturada.invoke([
      { role: "system", content: SISTEMA },
      { role: "user", content: `Campo: ${campo}\nPergunta original: ${objetivoBase}\nReescreva.` },
    ]);
    // raw é BaseMessage no tipo, mas na prática é sempre a AIMessage do
    // modelo — usage_metadata só existe nesse subtipo.
    const uso = resultado.raw instanceof AIMessage ? resultado.raw.usage_metadata : undefined;
    return {
      texto: resultado.parsed.pergunta,
      viaIA: true,
      tokensEntrada: uso?.input_tokens,
      tokensSaida: uso?.output_tokens,
      tokensTotal: uso?.total_tokens,
    };
  } catch (err) {
    logger.error({ ...contextoAtual(), campo, err }, "[reescrever] falha ao reescrever, usando texto original");
    return { texto: objetivoBase, viaIA: false };
  }
}

export interface CamposPerguntaPreparada {
  perguntaAtualTexto: string;
  perguntaAtualViaIA: boolean;
  perguntaAtualTokensTotal: number | undefined;
  // Deltas pros acumuladores do state de cada fluxo (issue #35, entrada/
  // saída discriminados na issue #69) — 0 quando não gastou nada de verdade
  // (viaIA:false). Cada fluxo precisa declarar os 3 campos no próprio
  // Annotation.Root com reducer de soma (ver fluxos/pessoaPresa/state.ts)
  // pra acumular entre chamadas. tokensGastosTotal == entrada + saída
  // sempre (soma dos outros 2, não é um valor independente).
  tokensGastosTotal: number;
  tokensGastosEntrada: number;
  tokensGastosSaida: number;
}

// Helper compartilhado entre TODOS os fluxos (fluxos/*/graph.ts) — cada
// pergunta segue o padrão de 2 nós "preparar" (chama a IA 1x, escreve o
// texto pronto em perguntaAtual*) + "pedir" (só lê o que já foi escrito e
// pausa em interrupt()). Por quê 2 nós, não 1: código ANTES de interrupt()
// no MESMO nó roda de novo toda vez que aquela pausa é retomada (gotcha real
// do LangGraph — "resume" replay o nó do início; interrupt() só para de
// pausar depois de já ter devolvido o valor uma vez). Se a chamada à IA
// tivesse dentro do nó que pausa, ela rodaria de novo (gastando Bedrock à
// toa) em toda resposta.
export async function prepararPergunta(campo: string, textoBase: string): Promise<CamposPerguntaPreparada> {
  const { texto, viaIA, tokensTotal, tokensEntrada, tokensSaida } = await reescreverPergunta(campo, textoBase);
  return {
    perguntaAtualTexto: texto,
    perguntaAtualViaIA: viaIA,
    perguntaAtualTokensTotal: tokensTotal,
    tokensGastosTotal: tokensTotal ?? 0,
    tokensGastosEntrada: tokensEntrada ?? 0,
    tokensGastosSaida: tokensSaida ?? 0,
  };
}
