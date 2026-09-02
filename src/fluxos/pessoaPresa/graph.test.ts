import { test } from "node:test";
import assert from "node:assert/strict";
import { Command } from "@langchain/langgraph";
import { grafo } from "./graph.js";

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

test("temProcesso=true → depois de informar o número, consulta o processo (Verde) e segue pro RG normalmente", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "true" }), config); // tem processo
  const r = await grafo.invoke(new Command({ resume: "0000088-95.2026.8.19.0010" }), config); // número
  const p = pergunta(r);
  assert.match(p?.pergunta ?? "", /RG da pessoa presa/, "consultarProcesso não deve travar o fluxo, mesmo sem achar/com erro");
  const dadosProcesso = (r as { dadosProcesso?: { encontrado: boolean } }).dadosProcesso;
  assert.equal(typeof dadosProcesso?.encontrado, "boolean", "dadosProcesso deveria estar preenchido no state");
});

test("temProcesso=false → pula direto pro RG", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  const r = await grafo.invoke(new Command({ resume: "false" }), config);
  const p = pergunta(r);
  assert.match(p?.pergunta ?? "", /RG da pessoa presa/);
});

// Regressão — bug real achado ao vivo 2026-08-31: o fluxo da Tykhe manda o
// texto literal "Sim"/"Não" digitado pelo usuário, não "true"/"false" como
// o contrato previa. Confirmação de nome com "Sim" literal virava false (a
// comparação estrita === "true" não reconhecia), negando a confirmação sem
// motivo e mandando pro handoff. respostaEhSim() aceita as duas formas.
test("resume com 'Sim'/'Não' literal (não 'true'/'false') funciona igual", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  const r = await grafo.invoke(new Command({ resume: "Sim" }), config);
  const p = pergunta(r);
  assert.match(p?.pergunta ?? "", /Qual o número do processo/, "'Sim' deveria contar como temProcesso=true, igual 'true'");
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

test("confirmação de nome com 'Sim' literal → concluido (cenário exato do bug real: WhatsApp/Tykhe manda 'Sim', não 'true')", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "Não" }), config); // sem processo
  await grafo.invoke(new Command({ resume: "11111111111" }), config); // RG
  const rConfirma = await grafo.invoke(new Command({ resume: "Sim" }), config); // confirma nome, literal
  assert.match(pergunta(rConfirma)?.pergunta ?? "", /parentesco/, "'Sim' deveria confirmar o nome, não mandar pro handoff");
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

test("RG não encontrado → pergunta se quer tentar de novo (tentativa 1 de 3)", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
  const r = await grafo.invoke(new Command({ resume: "000000000" }), config); // RG sentinela "não encontrado"
  const p = pergunta(r);
  assert.equal(p?.tipo, "sim_nao");
  assert.match(p?.pergunta ?? "", /tentativa 1 de 3/);
});

test("RG não encontrado, aceita tentar de novo, acha na 2ª → segue pro confirma nome", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "false" }), config);
  await grafo.invoke(new Command({ resume: "000000000" }), config); // 1ª tentativa, não encontrado
  const rPergunta = await grafo.invoke(new Command({ resume: "true" }), config); // quer tentar de novo
  assert.match(pergunta(rPergunta)?.pergunta ?? "", /RG da pessoa presa/);
  const rApenado = await grafo.invoke(new Command({ resume: "11111111111" }), config); // 2ª tentativa, acha
  assert.match(pergunta(rApenado)?.pergunta ?? "", /Confirma que a pessoa presa é/);
});

test("RG não encontrado, NÃO quer tentar de novo → handoff_humano direto", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "false" }), config);
  await grafo.invoke(new Command({ resume: "000000000" }), config);
  const rFinal = await grafo.invoke(new Command({ resume: "false" }), config); // não quer tentar de novo
  assert.equal(pergunta(rFinal), undefined);
  assert.equal((rFinal as { statusFinal?: string }).statusFinal, "handoff_humano");
});

test("RG não encontrado 3x seguidas → esgota tentativas, vai direto pro atendente sem perguntar de novo", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "false" }), config);
  const rTentativa1 = await grafo.invoke(new Command({ resume: "000000000" }), config); // tentativa 1
  assert.match(pergunta(rTentativa1)?.pergunta ?? "", /tentativa 1 de 3/);
  await grafo.invoke(new Command({ resume: "true" }), config); // quer tentar de novo → pedirRg
  const rTentativa2 = await grafo.invoke(new Command({ resume: "000000000" }), config); // tentativa 2
  assert.match(pergunta(rTentativa2)?.pergunta ?? "", /tentativa 2 de 3/);
  await grafo.invoke(new Command({ resume: "true" }), config); // quer tentar de novo → pedirRg
  // tentativa 3: esgotou — vai direto pro atendente, SEM perguntar "quer tentar de novo?" de novo
  const rFinal = await grafo.invoke(new Command({ resume: "000000000" }), config);
  assert.equal(pergunta(rFinal), undefined, "não deve perguntar de novo — esgotou as 3 tentativas");
  assert.equal((rFinal as { statusFinal?: string }).statusFinal, "handoff_humano");
});
