import { test } from "node:test";
import assert from "node:assert/strict";
import { Command } from "@langchain/langgraph";
import { grafo } from "./graph.js";

let contador = 0;
function novoConfig() {
  contador += 1;
  return { configurable: { thread_id: `teste-grafo-vd-${contador}` } };
}

function pergunta(resultado: unknown): { pergunta: string; tipo: string; opcoes?: string[] } | undefined {
  return (resultado as { __interrupt__?: Array<{ value: { pergunta: string; tipo: string; opcoes?: string[] } }> }).__interrupt__?.[0]?.value;
}

test("1ª invocação pausa em pedirEhVitima", async () => {
  const config = novoConfig();
  const r = await grafo.invoke({}, config);
  const p = pergunta(r);
  assert.equal(p?.tipo, "sim_nao");
  assert.match(p?.pergunta ?? "", /vítima de violência doméstica/);
});

test("não é vítima → handoff_humano direto, sem mais perguntas", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  const r = await grafo.invoke(new Command({ resume: "false" }), config);
  assert.equal(pergunta(r), undefined);
  assert.equal((r as { statusFinal?: string }).statusFinal, "handoff_humano");
  assert.equal((r as { motivoHandoff?: string }).motivoHandoff, "nao_e_vitima");
});

test("é vítima → pergunta sobre processo em seguida", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  const r = await grafo.invoke(new Command({ resume: "true" }), config);
  const p = pergunta(r);
  assert.match(p?.pergunta ?? "", /processo relacionado/);
});

test("tem processo → pede número, consulta Verde (informativo), segue pro RO normalmente", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
  const rNumero = await grafo.invoke(new Command({ resume: "true" }), config); // tem processo
  assert.match(pergunta(rNumero)?.pergunta ?? "", /número do processo/);
  const r = await grafo.invoke(new Command({ resume: "0000088-95.2026.8.19.0010" }), config);
  assert.match(pergunta(r)?.pergunta ?? "", /Boletim de Ocorrência/, "consultarProcesso não deve travar o fluxo");
  const dadosProcesso = (r as { dadosProcesso?: { encontrado: boolean } }).dadosProcesso;
  assert.equal(typeof dadosProcesso?.encontrado, "boolean");
});

test("sem processo → pula direto pra pergunta do RO", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
  const r = await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
  assert.match(pergunta(r)?.pergunta ?? "", /Boletim de Ocorrência/);
});

test("tem RO → conclui urgente, sem perguntar CPF", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
  await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
  const r = await grafo.invoke(new Command({ resume: "true" }), config); // tem RO
  assert.equal(pergunta(r), undefined);
  assert.equal((r as { statusFinal?: string }).statusFinal, "concluido");
  assert.equal((r as { tipoEncaminhamento?: string }).tipoEncaminhamento, "urgente_juizado");
});

test("sem RO, cpf não veio em dadosConhecidos → pergunta CPF", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
  await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
  const r = await grafo.invoke(new Command({ resume: "false" }), config); // sem RO
  assert.match(pergunta(r)?.pergunta ?? "", /Qual o seu CPF/);
});

test("sem RO, município capital (mock Verde) → conclui nudem", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
  await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
  await grafo.invoke(new Command({ resume: "false" }), config); // sem RO
  const r = await grafo.invoke(new Command({ resume: "11111111111" }), config); // cpf (mock → Rio de Janeiro)
  assert.equal(pergunta(r), undefined);
  assert.equal((r as { statusFinal?: string }).statusFinal, "concluido");
  assert.equal((r as { tipoEncaminhamento?: string }).tipoEncaminhamento, "nudem");
});

test("sem RO, CPF não encontrado no Verde (sem município) → conclui defensoria_vitima_juizado, não nudem", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
  await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
  await grafo.invoke(new Command({ resume: "false" }), config); // sem RO
  const r = await grafo.invoke(new Command({ resume: "00000000000" }), config); // cpf sentinela "não encontrado"
  assert.equal(pergunta(r), undefined);
  assert.equal((r as { tipoEncaminhamento?: string }).tipoEncaminhamento, "defensoria_vitima_juizado");
});

test("sem RO, cpf pré-preenchido em dadosConhecidos → não pergunta CPF de novo", async () => {
  const config = novoConfig();
  const r0 = await grafo.invoke({ cpf: "11111111111" }, config);
  assert.match(pergunta(r0)?.pergunta ?? "", /vítima de violência doméstica/);
  await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
  await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
  const r = await grafo.invoke(new Command({ resume: "false" }), config); // sem RO → deveria pular CPF
  assert.equal(pergunta(r), undefined, "cpf já veio pronto, não deveria pausar pra perguntar de novo");
  assert.equal((r as { tipoEncaminhamento?: string }).tipoEncaminhamento, "nudem");
});
