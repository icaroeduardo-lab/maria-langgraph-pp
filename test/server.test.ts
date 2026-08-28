import { test } from "node:test";
import assert from "node:assert/strict";
import { montarApp } from "../src/app.js";

let contador = 0;
function novoChatId() {
  contador += 1;
  return `teste-http-${contador}`;
}

test("POST /mensagem sem chatId → 400", async () => {
  const app = montarApp();
  const res = await app.inject({ method: "POST", url: "/mensagem", payload: { mensagem: "oi" } });
  assert.equal(res.statusCode, 400);
});

test("1ª mensagem → pergunta sim_nao com opcoes, status em_andamento", async () => {
  const app = montarApp();
  const chatId = novoChatId();
  const res = await app.inject({ method: "POST", url: "/mensagem", payload: { chatId, mensagem: "oi" } });
  const body = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(body.tipoResposta, "sim_nao");
  assert.deepEqual(body.opcoes, ["Sim", "Não"]);
  assert.equal(body.status, "em_andamento");
});

test("resume com mesmo chatId continua a MESMA conversa (não reinicia)", async () => {
  const app = montarApp();
  const chatId = novoChatId();
  await app.inject({ method: "POST", url: "/mensagem", payload: { chatId, mensagem: "oi" } });
  const res = await app.inject({ method: "POST", url: "/mensagem", payload: { chatId, mensagem: "true" } });
  const body = res.json();
  assert.match(body.resposta, /Qual o número do processo/);
});

test("resume com mensagem 'false' funciona via HTTP (regressão do bug resume:boolean falsy)", async () => {
  const app = montarApp();
  const chatId = novoChatId();
  await app.inject({ method: "POST", url: "/mensagem", payload: { chatId, mensagem: "oi" } });
  const res = await app.inject({ method: "POST", url: "/mensagem", payload: { chatId, mensagem: "false" } });
  assert.equal(res.statusCode, 200);
  assert.match(res.json().resposta, /RG da pessoa presa/);
});

test("fluxo completo via HTTP: termina com status concluido, sem opcoes no final", async () => {
  const app = montarApp();
  const chatId = novoChatId();
  await app.inject({ method: "POST", url: "/mensagem", payload: { chatId, mensagem: "oi" } });
  await app.inject({ method: "POST", url: "/mensagem", payload: { chatId, mensagem: "false" } }); // sem processo
  await app.inject({ method: "POST", url: "/mensagem", payload: { chatId, mensagem: "11111111111" } }); // RG
  await app.inject({ method: "POST", url: "/mensagem", payload: { chatId, mensagem: "true" } }); // confirma nome
  const res = await app.inject({ method: "POST", url: "/mensagem", payload: { chatId, mensagem: "amigo" } }); // parentesco
  const body = res.json();
  assert.equal(body.status, "concluido");
  assert.equal(body.opcoes, undefined);
});
