import { test } from "node:test";
import assert from "node:assert/strict";
import { Command } from "@langchain/langgraph";
import { grafo } from "./graph.js";

let contador = 0;
function novoConfig() {
  contador += 1;
  return { configurable: { thread_id: `teste-grafo-vd-${contador}` } };
}

function pergunta(resultado: unknown): { pergunta: string; tipo: string } | undefined {
  return (resultado as { __interrupt__?: Array<{ value: { pergunta: string; tipo: string } }> }).__interrupt__?.[0]?.value;
}

test("1ª invocação pausa em pedirRelato", async () => {
  const config = novoConfig();
  const r = await grafo.invoke({}, config);
  const p = pergunta(r);
  assert.equal(p?.tipo, "texto");
  assert.match(p?.pergunta ?? "", /o que está acontecendo/);
});

test("resume com relato → conclui, sem pergunta pendente", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  const r = await grafo.invoke(new Command({ resume: "relato de teste" }), config);
  assert.equal(pergunta(r), undefined, "não deve ter pergunta pendente no fim");
  assert.equal((r as { statusFinal?: string }).statusFinal, "concluido");
  assert.equal((r as { relato?: string }).relato, "relato de teste");
});
