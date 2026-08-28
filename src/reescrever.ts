import { ChatBedrockConverse } from "@langchain/aws";
import { AIMessage } from "@langchain/core/messages";
import { z } from "zod";

// Reescreve o TEXTO de uma pergunta (deixa mais natural) sem mudar O QUE é
// perguntado — o campo/ordem continuam 100% determinísticos no grafo, só a
// frase muda. Mesma ideia de "reescrita de pergunta" do app principal
// (maria-ia-back-end), sem o cache de hit/miss por enquanto (adicionar se o
// custo/latência incomodar de verdade).
const modelo = new ChatBedrockConverse({
  model: process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-haiku-20240307-v1:0",
  region: process.env.AWS_REGION ?? "us-east-1",
});

const SchemaReescrita = z.object({
  pergunta: z.string().describe("a pergunta reescrita, curta e natural, em português do Brasil"),
});

const SISTEMA = `Você reescreve perguntas de um formulário jurídico da Defensoria Pública do RJ.
Regras: mantenha o MESMO significado — nunca invente informação nova, nunca mude o que está sendo pedido.
Tom acolhedor, claro, direto. Português do Brasil com emoji (se for possível). Uma frase só, terminada em "?".`;

export interface ResultadoReescrita {
  texto: string;
  // false = a IA falhou e caiu no texto original (objetivoBase) — sinaliza
  // pro chamador (graph.ts -> log estruturado em app.ts) se essa pergunta
  // específica saiu reescrita ou não, sem precisar comparar string.
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
// em app.ts) — sem isso a suíte de testes fica lenta (2-6s por pergunta,
// Bedrock real), gasta dinheiro à toa a cada `pnpm test`, E vira frágil
// (texto reescrito varia entre execuções, quebra assert de texto fixo).
// Testar a reescrita de verdade fica pra um teste isolado que força
// NODE_ENV != "test" de propósito (ver test/reescrever.test.ts).
export async function reescreverPergunta(campo: string, objetivoBase: string): Promise<ResultadoReescrita> {
  if (process.env.NODE_ENV === "test") {
    return { texto: objetivoBase, viaIA: false };
  }
  try {
    // includeRaw:true devolve { raw, parsed } em vez de só o objeto parseado
    // — raw é a AIMessage crua, com usage_metadata (tokens de entrada/saída/
    // total). Sem isso não tem como saber quanto essa chamada custou.
    const comSaidaEstruturada = modelo.withStructuredOutput(SchemaReescrita, { includeRaw: true });
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
    console.error(`[reescrever] falha ao reescrever "${campo}", usando texto original:`, err);
    return { texto: objetivoBase, viaIA: false };
  }
}
