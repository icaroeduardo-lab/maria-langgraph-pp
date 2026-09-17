import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarPerguntaDesambiguacao } from "../src/ia/desambiguar.js";

// Mesmo padrão de test-integracao/reescrever.test.ts — chama o Bedrock de
// VERDADE, por isso vive fora do glob do `pnpm test` padrão. Roda com
// `pnpm test:integracao`, precisa de credencial AWS válida e gasta 1
// chamada real.
test("gerarPerguntaDesambiguacao gera pergunta real e devolve tokens de uso (issue #34)", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const resultado = await gerarPerguntaDesambiguacao("tenho um amigo que está preso, queria visitar ele", [
      { id: "1", nome: "regulamentar visita", descricao: "Direito de visitas: crianças, adolescentes, idosos e pessoas presas" },
      { id: "2", nome: "pessoa-presa", descricao: "Informação ou encaminhamento sobre uma pessoa que está presa" },
    ]);
    assert.equal(resultado.viaIA, true, "esperava a IA responder com sucesso (credencial AWS configurada)");
    assert.equal(typeof resultado.pergunta, "string");
    assert.ok(resultado.pergunta.length > 0);
    assert.ok(resultado.tokensTotal !== undefined && resultado.tokensTotal > 0, "esperava usage_metadata com tokens");
    assert.ok(resultado.tokensEntrada !== undefined && resultado.tokensEntrada > 0, "esperava tokens de entrada (issue #69)");
    assert.ok(resultado.tokensSaida !== undefined && resultado.tokensSaida > 0, "esperava tokens de saída (issue #69)");
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});
