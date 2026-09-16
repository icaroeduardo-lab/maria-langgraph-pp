import { test } from "node:test";
import assert from "node:assert/strict";
import { reescreverPergunta, prepararPergunta } from "../src/ia/reescrever.js";

// Único teste que chama o Bedrock de VERDADE — por isso vive em
// test-integracao/, FORA do glob do `pnpm test` padrão (test/*.test.ts).
// Roda com `pnpm test:integracao`. Os testes normais (test/graph.test.ts,
// test/server.test.ts) rodam com NODE_ENV=test, que pula a IA (ver
// reescrever.ts) — rápido, determinístico, sem custo, sem depender de
// credencial AWS. Este aqui precisa de AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY
// válidas (não confundir com VERDE_JWT_TOKEN, que é outra credencial) e
// gasta uma chamada de verdade — não roda em CI por padrão a menos que o
// script `test:integracao` seja chamado explicitamente.
test("reescreverPergunta chama o Bedrock de verdade quando NODE_ENV != test e REESCREVER_IA=true", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalReescreverIa = process.env.REESCREVER_IA;
  process.env.NODE_ENV = "development";
  // REESCREVER_IA desligado por padrão desde 2026-08-31 (ver ia/reescrever.ts)
  // — sem isso o early-return nem chega a chamar o Bedrock, viaIA sempre false.
  process.env.REESCREVER_IA = "true";
  try {
    const resultado = await reescreverPergunta("parentesco", "Qual seu parentesco com a pessoa presa?");
    assert.equal(resultado.viaIA, true, "esperava a IA responder com sucesso (credencial AWS configurada)");
    assert.equal(typeof resultado.texto, "string");
    assert.ok(resultado.texto.length > 0);
    assert.ok(resultado.tokensTotal !== undefined && resultado.tokensTotal > 0, "esperava usage_metadata com tokens");
    assert.ok(resultado.tokensEntrada !== undefined && resultado.tokensEntrada > 0, "esperava tokens de entrada (issue #69)");
    assert.ok(resultado.tokensSaida !== undefined && resultado.tokensSaida > 0, "esperava tokens de saída (issue #69)");
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.REESCREVER_IA = originalReescreverIa;
  }
});

// prepararPergunta (helper usado por TODOS os fluxos, ver fluxos/*/graph.ts)
// é quem repassa os deltas pro state — issue #69 discriminou entrada/saída
// aqui, não só dentro de reescreverPergunta.
test("prepararPergunta repassa tokensGastosEntrada/tokensGastosSaida (issue #69)", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalReescreverIa = process.env.REESCREVER_IA;
  process.env.NODE_ENV = "development";
  process.env.REESCREVER_IA = "true";
  try {
    const preparado = await prepararPergunta("parentesco", "Qual seu parentesco com a pessoa presa?");
    assert.equal(preparado.perguntaAtualViaIA, true);
    assert.ok(preparado.tokensGastosTotal > 0);
    assert.ok(preparado.tokensGastosEntrada > 0, "esperava tokensGastosEntrada > 0");
    assert.ok(preparado.tokensGastosSaida > 0, "esperava tokensGastosSaida > 0");
    assert.equal(preparado.tokensGastosEntrada + preparado.tokensGastosSaida, preparado.tokensGastosTotal, "entrada + saída deveria bater com o total");
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.REESCREVER_IA = originalReescreverIa;
  }
});
