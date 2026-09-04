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

// CPF agora é comum aos 2 ramos (com/sem RO) — os dois precisam de idPessoa
// pra consultar órgão no Verde (decisão de design 2026-09-04, depois de
// descobrir que RO:true também precisa consultar /orgao/violencia-domestica).
test("depois do RO (tem RO), pergunta CPF — comum aos 2 ramos agora", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
  await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
  const r = await grafo.invoke(new Command({ resume: "true" }), config); // tem RO
  assert.match(pergunta(r)?.pergunta ?? "", /Qual o seu CPF/);
});

test("depois do RO (sem RO), pergunta CPF também", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
  await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
  const r = await grafo.invoke(new Command({ resume: "false" }), config); // sem RO
  assert.match(pergunta(r)?.pergunta ?? "", /Qual o seu CPF/);
});

test("tem RO, CPF válido → conclui urgente, mensagem cita o órgão real (mock)", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
  await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
  await grafo.invoke(new Command({ resume: "true" }), config); // tem RO
  const r = await grafo.invoke(new Command({ resume: "11111111111" }), config); // cpf
  assert.equal(pergunta(r), undefined);
  assert.equal((r as { statusFinal?: string }).statusFinal, "concluido");
  assert.equal((r as { tipoEncaminhamento?: string }).tipoEncaminhamento, "urgente");
  const orgaos = (r as { orgaosViolenciaDomestica?: { orgaos: Array<{ nome: string }> } }).orgaosViolenciaDomestica;
  assert.match(orgaos?.orgaos[0]?.nome ?? "", /Juizado/);
});

test("tem RO, CPF não encontrado no Verde (idPessoa=0) → sem órgão, handoff_humano, motivo sem_orgao_disponivel", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
  await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
  await grafo.invoke(new Command({ resume: "true" }), config); // tem RO
  const r = await grafo.invoke(new Command({ resume: "00000000000" }), config); // cpf sentinela "não encontrado"
  assert.equal(pergunta(r), undefined);
  assert.equal((r as { statusFinal?: string }).statusFinal, "handoff_humano");
  assert.equal((r as { motivoHandoff?: string }).motivoHandoff, "sem_orgao_disponivel");
});

test("sem RO, CPF válido → conclui padrão, mensagem cita o órgão real (mock)", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
  await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
  await grafo.invoke(new Command({ resume: "false" }), config); // sem RO
  const r = await grafo.invoke(new Command({ resume: "11111111111" }), config); // cpf
  assert.equal(pergunta(r), undefined);
  assert.equal((r as { statusFinal?: string }).statusFinal, "concluido");
  assert.equal((r as { tipoEncaminhamento?: string }).tipoEncaminhamento, "padrao");
  assert.match((r as { resposta?: string; mensagemFinal?: string }).mensagemFinal ?? "", /Coordenação de Defesa/);
});

// Sem RO sempre tem fallback no Verde (NUDEM > núcleo > DP única) — mesmo
// com CPF não encontrado, mock não simula "sem órgão" nesse ramo (só existe
// documentado com RO:true).
test("sem RO, CPF não encontrado no Verde → ainda assim encontra órgão (fallback do Verde)", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
  await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
  await grafo.invoke(new Command({ resume: "false" }), config); // sem RO
  const r = await grafo.invoke(new Command({ resume: "00000000000" }), config); // cpf sentinela "não encontrado"
  assert.equal((r as { statusFinal?: string }).statusFinal, "concluido");
  assert.equal((r as { tipoEncaminhamento?: string }).tipoEncaminhamento, "padrao");
});

test("concluido de verdade inclui encaminhamentoId (POST real no Verde, mock retorna sucesso)", async () => {
  const config = novoConfig();
  await grafo.invoke({}, config);
  await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
  await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
  await grafo.invoke(new Command({ resume: "false" }), config); // sem RO
  const r = await grafo.invoke(new Command({ resume: "11111111111" }), config); // cpf
  assert.equal((r as { encaminhamentoId?: number }).encaminhamentoId, 999999);
  assert.match((r as { mensagemFinal?: string }).mensagemFinal ?? "", /Protocolo: 999999/);
});

test("falha ao criar encaminhamento de verdade (MOCK_ENCAMINHAMENTO_FALHA) → handoff_humano, motivo falha_encaminhamento", async () => {
  const original = process.env.MOCK_ENCAMINHAMENTO_FALHA;
  process.env.MOCK_ENCAMINHAMENTO_FALHA = "true";
  try {
    const config = novoConfig();
    await grafo.invoke({}, config);
    await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
    await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
    await grafo.invoke(new Command({ resume: "false" }), config); // sem RO
    const r = await grafo.invoke(new Command({ resume: "11111111111" }), config); // cpf — acha órgão, mas encaminhar falha
    assert.equal(pergunta(r), undefined);
    assert.equal((r as { statusFinal?: string }).statusFinal, "handoff_humano");
    assert.equal((r as { motivoHandoff?: string }).motivoHandoff, "falha_encaminhamento");
    assert.equal((r as { encaminhamentoId?: number }).encaminhamentoId, undefined, "não deveria ter id, o encaminhamento falhou");
  } finally {
    process.env.MOCK_ENCAMINHAMENTO_FALHA = original;
  }
});

// Em horário de plantão a regra de órgão muda — usa
// consultarOrgaosPlantaoViolenciaDomestica em vez da consulta normal, RO
// deixa de importar pra ESSA decisão (mas ainda decide urgente x padrão).
test("plantão vigente (MOCK_PLANTAO_VIGENTE) → usa órgão de plantão, não o normal", async () => {
  const original = process.env.MOCK_PLANTAO_VIGENTE;
  process.env.MOCK_PLANTAO_VIGENTE = "true";
  try {
    const config = novoConfig();
    await grafo.invoke({}, config);
    await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
    await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
    await grafo.invoke(new Command({ resume: "false" }), config); // sem RO
    const r = await grafo.invoke(new Command({ resume: "11111111111" }), config); // cpf
    assert.equal((r as { statusFinal?: string }).statusFinal, "concluido");
    const orgaos = (r as { orgaosViolenciaDomestica?: { orgaos: Array<{ nome: string }> } }).orgaosViolenciaDomestica;
    assert.match(orgaos?.orgaos[0]?.nome ?? "", /Plantão/, "deveria ter usado o órgão de plantão, não o normal (Coordenação/Juizado)");
  } finally {
    process.env.MOCK_PLANTAO_VIGENTE = original;
  }
});

test("plantão vigente + idPessoa não encontrado → sem órgão de plantão, handoff_humano", async () => {
  const original = process.env.MOCK_PLANTAO_VIGENTE;
  process.env.MOCK_PLANTAO_VIGENTE = "true";
  try {
    const config = novoConfig();
    await grafo.invoke({}, config);
    await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
    await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
    await grafo.invoke(new Command({ resume: "false" }), config); // sem RO
    const r = await grafo.invoke(new Command({ resume: "00000000000" }), config); // cpf sentinela "não encontrado"
    assert.equal(pergunta(r), undefined);
    assert.equal((r as { statusFinal?: string }).statusFinal, "handoff_humano");
    assert.equal((r as { motivoHandoff?: string }).motivoHandoff, "sem_orgao_disponivel");
  } finally {
    process.env.MOCK_PLANTAO_VIGENTE = original;
  }
});

test("cpf pré-preenchido em dadosConhecidos → não pergunta CPF de novo", async () => {
  const config = novoConfig();
  const r0 = await grafo.invoke({ cpf: "11111111111" }, config);
  assert.match(pergunta(r0)?.pergunta ?? "", /vítima de violência doméstica/);
  await grafo.invoke(new Command({ resume: "true" }), config); // é vítima
  await grafo.invoke(new Command({ resume: "false" }), config); // sem processo
  const r = await grafo.invoke(new Command({ resume: "false" }), config); // sem RO → deveria pular CPF
  assert.equal(pergunta(r), undefined, "cpf já veio pronto, não deveria pausar pra perguntar de novo");
  assert.equal((r as { tipoEncaminhamento?: string }).tipoEncaminhamento, "padrao");
});
