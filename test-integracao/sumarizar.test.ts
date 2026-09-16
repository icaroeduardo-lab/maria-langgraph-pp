import { test } from "node:test";
import assert from "node:assert/strict";
import { sumarizarRelato } from "../src/ia/sumarizar.js";

// Mesmo padrão de test-integracao/classificar.test.ts — chama o Bedrock de
// VERDADE, por isso vive fora do glob do `pnpm test` padrão. Roda com
// `pnpm test:integracao`, precisa de credencial AWS válida e gasta chamadas
// reais.

// Issue #70 — relato longo/redundante de propósito (simula histórico
// acumulado de várias rodadas de desambiguação, cenário real da issue #47),
// diferente da 1ª versão deste teste (4 frases curtas e já diretas) — pedir
// pro Bedrock resumir um texto que já é enxuto não garante encolher de
// forma confiável, o modelo às vezes devolve algo do mesmo tamanho ou
// reformulado com mais palavras. Um relato genuinamente verboso garante que
// qualquer resumo razoável seja menor.
const RELATO = `Meu marido foi preso semana passada, ainda não sei direito o número do processo, não anotei na hora porque estava muito nervosa e não consegui prestar atenção em tudo que os policiais falaram naquele momento.
A gente mora junto tem 8 anos, não somos casados no papel, nunca fizemos questão de casar oficialmente porque nunca vimos necessidade, mas moramos juntos como se fôssemos casados mesmo, dividindo tudo, contas, aluguel, essas coisas do dia a dia.
Ele tá numa unidade em Bangu, falaram que era condenado mas eu não entendi direito a situação, ficou tudo muito confuso na hora, com muita gente falando ao mesmo tempo e eu tentando entender o que estava acontecendo.
Queria saber como acompanhar isso e se posso visitar ele, porque nunca passei por uma situação assim antes e não sei nem por onde começar, se preciso de algum documento, se preciso agendar visita com antecedência.
Também queria saber se existe algum auxílio pra quem fica sem o marido trabalhando em casa, porque ele que ajudava com as contas e agora não sei como vou me virar sozinha com as despesas da casa.
Alguém falou que existe um benefício pra família de pessoa presa mas não sei se é verdade nem como funciona, se precisa de advogado ou se dá pra resolver direto com a defensoria mesmo.`;

test("sumarizarRelato chama o Bedrock de verdade e devolve resumo menor + tokens de uso (issue #47)", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const resultado = await sumarizarRelato(RELATO);
    assert.equal(resultado.viaIA, true, "esperava a IA responder com sucesso (credencial AWS configurada)");
    assert.ok(resultado.resumo.length > 0);
    assert.ok(resultado.resumo.length < RELATO.length, "resumo deveria ser mais curto que o relato original");
    assert.ok(resultado.tokensTotal !== undefined && resultado.tokensTotal > 0, "esperava usage_metadata com tokens (issue #35 precisa contabilizar isso)");
    assert.ok(resultado.tokensEntrada !== undefined && resultado.tokensEntrada > 0, "esperava tokens de entrada (issue #69)");
    assert.ok(resultado.tokensSaida !== undefined && resultado.tokensSaida > 0, "esperava tokens de saída (issue #69)");
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});
