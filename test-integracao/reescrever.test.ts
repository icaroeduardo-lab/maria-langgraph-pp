import { test } from "node:test";
import assert from "node:assert/strict";
import { reescreverPergunta } from "../src/reescrever.js";

// Único teste que chama o Bedrock de VERDADE — por isso vive em
// test-integracao/, FORA do glob do `pnpm test` padrão (test/*.test.ts).
// Roda com `pnpm test:integracao`. Os testes normais (test/graph.test.ts,
// test/server.test.ts) rodam com NODE_ENV=test, que pula a IA (ver
// reescrever.ts) — rápido, determinístico, sem custo, sem depender de
// credencial AWS. Este aqui precisa de AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY
// válidas (não confundir com VERDE_JWT_TOKEN, que é outra credencial) e
// gasta uma chamada de verdade — não roda em CI por padrão a menos que o
// script `test:integracao` seja chamado explicitamente.
test("reescreverPergunta chama o Bedrock de verdade quando NODE_ENV != test", async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const resultado = await reescreverPergunta("parentesco", "Qual seu parentesco com a pessoa presa?");
    assert.equal(resultado.viaIA, true, "esperava a IA responder com sucesso (credencial AWS configurada)");
    assert.equal(typeof resultado.texto, "string");
    assert.ok(resultado.texto.length > 0);
    assert.ok(resultado.tokensTotal !== undefined && resultado.tokensTotal > 0, "esperava usage_metadata com tokens");
  } finally {
    process.env.NODE_ENV = original;
  }
});
