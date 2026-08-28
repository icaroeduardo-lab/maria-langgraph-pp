import { test } from "node:test";
import assert from "node:assert/strict";
import { montarApp } from "../src/app.js";

let contador = 0;
function novoChatId() {
  contador += 1;
  return `teste-http-${contador}`;
}

// chatId é obrigatório SEMPRE (produção e desenvolvimento) — só NODE_ENV=test
// relaxa isso (gera UUID), pra facilitar teste sem precisar inventar chatId
// toda hora. Rodando via `pnpm test`, NODE_ENV já vem "test" (ver package.json).
test("POST /mensagem sem chatId, NODE_ENV=test → gera UUID como fallback, não rejeita com 400", async () => {
  const app = montarApp();
  const res = await app.inject({ method: "POST", url: "/mensagem", payload: { mensagem: "oi" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, "em_andamento");
});

test("POST /mensagem sem chatId, FORA de NODE_ENV=test → 400 (obrigatório de verdade)", async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const app = montarApp();
    const res = await app.inject({ method: "POST", url: "/mensagem", payload: { mensagem: "oi" } });
    assert.equal(res.statusCode, 400);
  } finally {
    process.env.NODE_ENV = original;
  }
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
