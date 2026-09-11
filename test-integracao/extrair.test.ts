import { test } from "node:test";
import assert from "node:assert/strict";
import { extrairCamposLivre } from "../src/ia/extrair.js";

// Mesmo padrão de test-integracao/reescrever.test.ts — chama o Bedrock de
// VERDADE, por isso vive fora do glob do `pnpm test` padrão. Roda com
// `pnpm test:integracao`, precisa de credencial AWS válida e gasta 1
// chamada real.
test("extrairCamposLivre extrai rg e parentesco de um relato livre real", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalExtracaoIa = process.env.EXTRACAO_LIVRE_IA;
  process.env.NODE_ENV = "development";
  process.env.EXTRACAO_LIVRE_IA = "true";
  try {
    const resultado = await extrairCamposLivre(
      "Meu marido José da Silva tá preso, o RG dele é 12345678, temos processo aberto sim, é o numero 0000088-95.2026.8.19.0010, e eu sou esposa dele"
    );
    assert.equal(resultado.viaIA, true, "esperava a IA responder com sucesso (credencial AWS configurada)");
    assert.equal(resultado.temProcesso, true);
    assert.equal(resultado.rg, "12345678");
    assert.match(resultado.parentesco ?? "", /esposa/i);
    assert.match(resultado.numeroProcesso ?? "", /0000088-95\.2026\.8\.19\.0010/);
    assert.ok(resultado.tokensTotal !== undefined && resultado.tokensTotal > 0, "esperava usage_metadata com tokens (issue #34)");
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.EXTRACAO_LIVRE_IA = originalExtracaoIa;
  }
});

test("extrairCamposLivre não força campo não mencionado", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalExtracaoIa = process.env.EXTRACAO_LIVRE_IA;
  process.env.NODE_ENV = "development";
  process.env.EXTRACAO_LIVRE_IA = "true";
  try {
    const resultado = await extrairCamposLivre("Sou irmã da pessoa presa");
    assert.equal(resultado.viaIA, true);
    assert.match(resultado.parentesco ?? "", /irm/i);
    assert.equal(resultado.rg, undefined, "RG não foi mencionado, não deveria vir preenchido");
    assert.equal(resultado.numeroProcesso, undefined, "número do processo não foi mencionado, não deveria vir preenchido");
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.EXTRACAO_LIVRE_IA = originalExtracaoIa;
  }
});
