import { test } from "node:test";
import assert from "node:assert/strict";
import { montarApp } from "../../app.js";
import { ID_VIOLENCIA_DOMESTICA } from "../index.js";

// Mecânica genérica da rota já está coberta em test/app.test.ts. Aqui só o
// que é específico do fluxo em si: texto das perguntas, ordem de negócio,
// shape de metadados, e o uso de dadosConhecidos (contrato Tykhe).

const AUTH = { authorization: `Bearer ${process.env.API_KEY}` };
const BASE = "/atendimentos";
const FLOW_ID = ID_VIOLENCIA_DOMESTICA;

let contador = 0;
function novoChatId() {
  contador += 1;
  return `teste-vd-http-${contador}`;
}

test("POST cria atendimento → 1ª pergunta é sim_nao sobre ser vítima", async () => {
  const app = await montarApp();
  const chatId = novoChatId();
  const res = await app.inject({ method: "POST", url: BASE, payload: { chatId, flowId: FLOW_ID }, headers: AUTH });
  const body = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(body.tipoResposta, "sim_nao");
  assert.match(body.resposta, /vítima de violência doméstica/);
});

test("não é vítima → handoff_humano, mensagem específica, metadados com motivoHandoff", async () => {
  const app = await montarApp();
  const chatId = novoChatId();
  await app.inject({ method: "POST", url: BASE, payload: { chatId, flowId: FLOW_ID }, headers: AUTH });
  const res = await app.inject({
    method: "POST",
    url: `${BASE}/respostas`,
    payload: { chatId, resposta: "false" },
    headers: AUTH,
  });
  const body = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(body.status, "handoff_humano");
  assert.match(body.resposta, /destinado apenas para quem é vítima/);
  assert.equal(body.metadados.motivoHandoff, "nao_e_vitima");
});

test("fluxo completo com RO, cpf vindo em dadosConhecidos → concluido, urgente, mensagem cita o órgão", async () => {
  const app = await montarApp();
  const chatId = novoChatId();
  const responder = (resposta: string) =>
    app.inject({ method: "POST", url: `${BASE}/respostas`, payload: { chatId, resposta }, headers: AUTH });

  await app.inject({
    method: "POST",
    url: BASE,
    payload: {
      chatId,
      flowId: FLOW_ID,
      dadosConhecidos: { cpf: "11111111111", idPessoa: 1, nome: "Teste", email: "teste@teste.com" },
    },
    headers: AUTH,
  });
  await responder("true"); // é vítima
  await responder("false"); // sem processo
  const res = await responder("true"); // tem RO — cpf já veio, não pergunta de novo
  const body = res.json();

  assert.equal(res.statusCode, 200);
  assert.equal(body.status, "concluido");
  assert.equal(body.metadados.tipoEncaminhamento, "urgente");
  assert.match(body.resposta, /Juizado/);
});

test("fluxo completo sem RO, sem dadosConhecidos → pergunta CPF, conclui padrão com órgão real (mock)", async () => {
  const app = await montarApp();
  const chatId = novoChatId();
  const responder = (resposta: string) =>
    app.inject({ method: "POST", url: `${BASE}/respostas`, payload: { chatId, resposta }, headers: AUTH });

  await app.inject({ method: "POST", url: BASE, payload: { chatId, flowId: FLOW_ID }, headers: AUTH });
  await responder("true"); // é vítima
  await responder("false"); // sem processo
  const rCpf = await responder("false"); // sem RO → deveria perguntar CPF
  assert.match(rCpf.json().resposta, /Qual o seu CPF/);
  const res = await responder("11111111111"); // cpf
  const body = res.json();

  assert.equal(res.statusCode, 200);
  assert.equal(body.status, "concluido");
  assert.equal(body.metadados.tipoEncaminhamento, "padrao");
  assert.equal(body.metadados.dadosPessoa.encontrado, true);
  assert.match(body.resposta, /Coordenação de Defesa/);
});
