import { test } from "node:test";
import assert from "node:assert/strict";
import { Command } from "@langchain/langgraph";
import { grafo } from "../src/graph.js";

// thread_id único por teste — grafo é singleton com MemorySaver compartilhado
// entre todos os testes deste arquivo, thread_id diferente evita um teste
// pisar no estado do outro.
let contador = 0;
function novoConfig() {
  contador += 1;
  return { configurable: { thread_id: `teste-grafo-${contador}` } };
}

function pergunta(resultado: unknown): { pergunta: string; tipo: string; opcoes?: string[] } | undefined {
  return (resultado as { __interrupt__?: Array<{ value: { pergunta: string; tipo: string; opcoes?: string[] } }> }).__interrupt__?.[0]?.value;
}

test("1ª invocação pausa em pedirTemProcesso (primeira pergunta da ordem atual)", async () => {
  const config = novoConfig();
  const r = await grafo.invoke({}, config);
  const p = pergunta(r);
  assert.equal(p?.tipo, "sim_nao");
  assert.match(p?.pergunta ?? "", /número do processo/);
});

test("temProcesso=true → pergunta número do processo (não pula pro RG)", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  const r = await grafo.invoke(new Command({ resume: "true" }), config);
  const p = pergunta(r);
  assert.match(p?.pergunta ?? "", /Qual o número do processo/);
});

test("temProcesso=false → pula direto pro RG", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  const r = await grafo.invoke(new Command({ resume: "false" }), config);
  const p = pergunta(r);
  assert.match(p?.pergunta ?? "", /RG da pessoa presa/);
});

test("resume com 'false' não quebra (regressão do bug de Command({resume:false})/valor falsy)", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config); // pausa em pedirTemProcesso
  // resume é sempre STRING ("false"), nunca boolean cru — é isso que evita
  // o bug real do LangGraph (graph.invoke trata resume:false como "sem
  // resume", lança "Received empty Command input"). Se alguém reintroduzir
  // resume:boolean aqui, este teste quebra.
  await assert.doesNotReject(() => grafo.invoke(new Command({ resume: "false" }), config));
});

test("fluxo completo: sem processo, nome confirmado → concluido, parentesco é a última pergunta", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config); // tem processo?
  await grafo.invoke(new Command({ resume: "false" }), config); // → RG direto
  const rApenado = await grafo.invoke(new Command({ resume: "11111111111" }), config); // RG
  const pApenado = pergunta(rApenado);
  assert.match(pApenado?.pergunta ?? "", /Confirma que a pessoa presa é/);

  const rConfirma = await grafo.invoke(new Command({ resume: "true" }), config); // confirma nome
  const pParentesco = pergunta(rConfirma);
  assert.match(pParentesco?.pergunta ?? "", /parentesco/);

  const rFinal = await grafo.invoke(new Command({ resume: "amigo" }), config); // parentesco
  assert.equal(pergunta(rFinal), undefined, "não deve ter pergunta pendente no fim");
  assert.equal((rFinal as { statusFinal?: string }).statusFinal, "concluido");
});

test("nome não confirmado → handoff_humano, NÃO pergunta parentesco", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
  await grafo.invoke(new Command({ resume: "11111111111" }), config); // RG
  const rFinal = await grafo.invoke(new Command({ resume: "false" }), config); // NÃO confirma nome
  assert.equal(pergunta(rFinal), undefined);
  assert.equal((rFinal as { statusFinal?: string }).statusFinal, "handoff_humano");
});
