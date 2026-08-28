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
test("POST /atendimentos sem chatId, NODE_ENV=test → 201 com UUID gerado, não rejeita com 400", async () => {
  const app = await montarApp();
  const res = await app.inject({ method: "POST", url: "/atendimentos", payload: {} });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().status, "em_andamento");
});

test("POST /atendimentos sem chatId, FORA de NODE_ENV=test → 400 (obrigatório de verdade)", async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const app = await montarApp();
    const res = await app.inject({ method: "POST", url: "/atendimentos", payload: {} });
    assert.equal(res.statusCode, 400);
  } finally {
    process.env.NODE_ENV = original;
  }
});

test("POST /atendimentos → 201, Location aponta pro recurso criado, _links.responder presente", async () => {
  const app = await montarApp();
  const chatId = novoChatId();
  const res = await app.inject({ method: "POST", url: "/atendimentos", payload: { chatId } });
  const body = res.json();
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers.location, `/atendimentos/${chatId}`);
  assert.equal(body.tipoResposta, "sim_nao");
  assert.deepEqual(body.opcoes, ["Sim", "Não"]);
  assert.equal(body.status, "em_andamento");
  assert.equal(body._links.self.href, `/atendimentos/${chatId}`);
  assert.equal(body._links.responder.href, `/atendimentos/${chatId}/respostas`);
  assert.equal(body._links.responder.method, "POST");
});

test("GET /atendimentos/:chatId inexistente → 404", async () => {
  const app = await montarApp();
  const res = await app.inject({ method: "GET", url: "/atendimentos/nao-existe-nunca-foi-criado" });
  assert.equal(res.statusCode, 404);
});

test("GET /atendimentos/:chatId depois de criado → mesma pergunta pendente, sem avançar o fluxo", async () => {
  const app = await montarApp();
  const chatId = novoChatId();
  await app.inject({ method: "POST", url: "/atendimentos", payload: { chatId } });
  const res = await app.inject({ method: "GET", url: `/atendimentos/${chatId}` });
  const body = res.json();
  assert.equal(res.statusCode, 200);
  assert.match(body.resposta, /número do processo/);
  assert.equal(body.status, "em_andamento");
});

test("POST /atendimentos/:chatId/respostas em chatId inexistente → 409", async () => {
  const app = await montarApp();
  const res = await app.inject({
    method: "POST",
    url: "/atendimentos/nunca-criado/respostas",
    payload: { resposta: "true" },
  });
  assert.equal(res.statusCode, 409);
});

test("POST /atendimentos/:chatId/respostas continua a MESMA conversa (não reinicia)", async () => {
  const app = await montarApp();
  const chatId = novoChatId();
  await app.inject({ method: "POST", url: "/atendimentos", payload: { chatId } });
  const res = await app.inject({
    method: "POST",
    url: `/atendimentos/${chatId}/respostas`,
    payload: { resposta: "true" },
  });
  const body = res.json();
  assert.equal(res.statusCode, 200);
  assert.match(body.resposta, /Qual o número do processo/);
});

test("resposta 'false' funciona (regressão do bug resume:boolean falsy)", async () => {
  const app = await montarApp();
  const chatId = novoChatId();
  await app.inject({ method: "POST", url: "/atendimentos", payload: { chatId } });
  const res = await app.inject({
    method: "POST",
    url: `/atendimentos/${chatId}/respostas`,
    payload: { resposta: "false" },
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.json().resposta, /RG da pessoa presa/);
});

test("fluxo completo: termina com status concluido, sem opcoes, sem _links.responder", async () => {
  const app = await montarApp();
  const chatId = novoChatId();
  const responder = (resposta: string) =>
    app.inject({ method: "POST", url: `/atendimentos/${chatId}/respostas`, payload: { resposta } });

  await app.inject({ method: "POST", url: "/atendimentos", payload: { chatId } });
  await responder("false"); // sem processo
  await responder("11111111111"); // RG
  await responder("true"); // confirma nome
  const res = await responder("amigo"); // parentesco
  const body = res.json();

  assert.equal(res.statusCode, 200);
  assert.equal(body.status, "concluido");
  assert.equal(body.opcoes, undefined);
  assert.equal(body._links.responder, undefined, "concluído não deve oferecer link pra responder de novo");
  assert.equal(body._links.self.href, `/atendimentos/${chatId}`);
});
