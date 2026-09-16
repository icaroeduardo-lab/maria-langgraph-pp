import { test } from "node:test";
import assert from "node:assert/strict";
import { Command } from "@langchain/langgraph";
import { grafo } from "./graph.js";
import { ID_PESSOA_PRESA, ID_VIOLENCIA_DOMESTICA } from "../fluxos/index.js";

// Whitebox — inspeciona o STATE diretamente (mensagem/resumoRelato/ultimaResposta),
// diferente de test/orquestrador.test.ts (rota HTTP, caixa-preta). Precisa
// disso pra confirmar issue #47: o texto que VAI pra classificação encolhe
// depois do limite de rodadas, não só o comportamento externo (status/flowId).

let contador = 0;
function novoConfig() {
  contador += 1;
  return { configurable: { thread_id: `teste-orq-graph-${contador}` } };
}

// 2 candidatos que NUNCA convergem pra 1 só — mantém "muitos" rodada após
// rodada, igual ao teste de esgotar limite em test/orquestrador.test.ts.
function comMockAmbiguo<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.env.MOCK_CLASSIFICACAO_FLOWIDS;
  const originalSingular = process.env.MOCK_CLASSIFICACAO_FLOWID;
  process.env.MOCK_CLASSIFICACAO_FLOWIDS = `${ID_PESSOA_PRESA},${ID_VIOLENCIA_DOMESTICA}`;
  delete process.env.MOCK_CLASSIFICACAO_FLOWID;
  return fn().finally(() => {
    process.env.MOCK_CLASSIFICACAO_FLOWIDS = original;
    process.env.MOCK_CLASSIFICACAO_FLOWID = originalSingular;
  });
}

test("histórico curto (< limite de rodadas): não sumariza, resumoRelato continua undefined", async () => {
  await comMockAmbiguo(async () => {
    const config = novoConfig();
    await grafo.invoke({ mensagem: "relato ambíguo" }, config); // 1ª pausa, rodada ainda 0
    const r = await grafo.invoke(new Command({ resume: "resposta 1" }), config); // rodada 0 → 1 (< limite 3)
    const estado = r as { resumoRelato?: string; ultimaResposta?: string; mensagem?: string; rodada?: number };
    assert.equal(estado.rodada, 1);
    assert.equal(estado.resumoRelato, undefined, "abaixo do limite, ainda não deveria ter sumarizado");
    assert.match(estado.mensagem ?? "", /relato ambíguo.*resposta 1/s, "mensagem bruta continua acumulando normalmente");
  });
});

test("histórico longo (atinge limite de rodadas): sumariza, resumoRelato definido e menor que o bruto acumulado", async () => {
  await comMockAmbiguo(async () => {
    const original = process.env.MOCK_SUMARIZACAO_RESUMO;
    process.env.MOCK_SUMARIZACAO_RESUMO = "resumo curto";
    try {
      const config = novoConfig();
      const relatoLongo = "a".repeat(200); // simula relato inicial grande, pra ficar óbvio que o resumo é menor
      await grafo.invoke({ mensagem: relatoLongo }, config); // 1ª pausa, rodada ainda 0
      await grafo.invoke(new Command({ resume: "resposta 1" }), config); // rodada 0 → 1
      await grafo.invoke(new Command({ resume: "resposta 2" }), config); // rodada 1 → 2
      const r = await grafo.invoke(new Command({ resume: "resposta 3" }), config); // rodada 2 → 3 (atinge o limite)
      const estado = r as { resumoRelato?: string; ultimaResposta?: string; mensagem?: string; rodada?: number };

      assert.equal(estado.rodada, 3);
      assert.equal(estado.resumoRelato, "resumo curto", "a partir do limite, deveria ter chamado sumarizarRelato (mock)");
      assert.equal(estado.ultimaResposta, "resposta 3", "última resposta fica de fora do resumo, guardada verbatim");
      // mensagem bruta continua crescendo pra registro (issue #47) — mas o
      // que IMPORTA é que resumo+últimaResposta é bem menor que ela.
      const textoQueIriaPraClassificacao = `${estado.resumoRelato}\n${estado.ultimaResposta}`;
      assert.ok(
        textoQueIriaPraClassificacao.length < (estado.mensagem?.length ?? 0),
        "texto usado pra classificar (resumo + última resposta) deveria ser menor que o histórico bruto completo"
      );
    } finally {
      process.env.MOCK_SUMARIZACAO_RESUMO = original;
    }
  });
});
