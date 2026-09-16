import { test } from "node:test";
import assert from "node:assert/strict";
import { sumarizarRelato } from "../src/ia/sumarizar.js";

// Mesmo padrão de test-integracao/classificar.test.ts — chama o Bedrock de
// VERDADE, por isso vive fora do glob do `pnpm test` padrão. Roda com
// `pnpm test:integracao`, precisa de credencial AWS válida e gasta chamadas
// reais.

const RELATO = `Meu marido foi preso semana passada, ainda não sei o número do processo.
A gente mora junto tem 8 anos, não somos casados no papel.
Ele tá numa unidade em Bangu, falaram que era condenado mas eu não entendi direito a situação.
Queria saber como acompanhar isso e se posso visitar ele.`;

test("sumarizarRelato chama o Bedrock de verdade e devolve resumo menor + tokens de uso (issue #47)", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const resultado = await sumarizarRelato(RELATO);
    assert.equal(resultado.viaIA, true, "esperava a IA responder com sucesso (credencial AWS configurada)");
    assert.ok(resultado.resumo.length > 0);
    assert.ok(resultado.resumo.length < RELATO.length, "resumo deveria ser mais curto que o relato original");
    assert.ok(resultado.tokensTotal !== undefined && resultado.tokensTotal > 0, "esperava usage_metadata com tokens (issue #35 precisa contabilizar isso)");
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});
