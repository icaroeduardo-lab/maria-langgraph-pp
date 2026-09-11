import { test } from "node:test";
import assert from "node:assert/strict";
import { classificarEntreOpcoes, classificarMultiploEntreOpcoes } from "../src/ia/classificar.js";

// Mesmo padrão de test-integracao/reescrever.test.ts — chama o Bedrock de
// VERDADE, por isso vive fora do glob do `pnpm test` padrão. Roda com
// `pnpm test:integracao`, precisa de credencial AWS válida e gasta chamadas
// reais. Diferente de reescrever/extrair, classificar.ts não tem guard de
// NODE_ENV próprio (mora no chamador, ver comentário do módulo) — mas ainda
// assim seta NODE_ENV="development" aqui só por consistência de leitura.

const SISTEMA = `Você escolhe entre candidatos de teste. Responda com o id que melhor combina, ou "nenhum".
Candidatos:
- id "gato": relacionado a gatos, felinos, miar
- id "cachorro": relacionado a cachorros, cães, latir`;

test("classificarEntreOpcoes escolhe o candidato certo e devolve tokens de uso (issue #34)", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const resultado = await classificarEntreOpcoes("meu gato não para de miar a noite toda", SISTEMA, ["gato", "cachorro"]);
    assert.equal(resultado.viaIA, true, "esperava a IA responder com sucesso (credencial AWS configurada)");
    assert.equal(resultado.escolhaId, "gato");
    assert.ok(resultado.tokensTotal !== undefined && resultado.tokensTotal > 0, "esperava usage_metadata com tokens");
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

test("classificarMultiploEntreOpcoes devolve tokens de uso (issue #34)", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const resultado = await classificarMultiploEntreOpcoes("tenho um bichano em casa", SISTEMA, ["gato", "cachorro"]);
    assert.equal(resultado.viaIA, true, "esperava a IA responder com sucesso (credencial AWS configurada)");
    assert.ok(resultado.ids.includes("gato"));
    assert.ok(resultado.tokensTotal !== undefined && resultado.tokensTotal > 0, "esperava usage_metadata com tokens");
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});
