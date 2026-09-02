import { test } from "node:test";
import assert from "node:assert/strict";
import { montarApp } from "../src/app.js";
import { ID_PESSOA_PRESA, ID_VIOLENCIA_DOMESTICA } from "../src/fluxos/index.js";

// Testa a MECÂNICA genérica das rotas (rotas/atendimentos.ts + rotas/fluxos.ts)
// — auth, health, idempotência, status codes, HATEOAS — sem acoplar em texto
// de negócio de nenhum fluxo específico. Teste de conteúdo/pergunta de cada
// fluxo mora em fluxos/<nome>/http.test.ts.
//
// violência doméstica é o fluxo mais simples (1 pergunta só) — usado aqui
// como fixture, só pra ter ALGUM grafo real rodando por trás.

let contador = 0;
function novoChatId() {
  contador += 1;
  return `teste-app-${contador}`;
}

const AUTH = { authorization: `Bearer ${process.env.API_KEY}` };
const BASE = `/atendimentos/${ID_VIOLENCIA_DOMESTICA}`;

test("POST /atendimentos/:fluxoId sem Authorization → 401", async () => {
  const app = await montarApp();
  const res = await app.inject({ method: "POST", url: BASE, payload: {} });
  assert.equal(res.statusCode, 401);
});

test("POST /atendimentos/:fluxoId com chave errada → 401", async () => {
  const app = await montarApp();
  const res = await app.inject({
    method: "POST",
    url: BASE,
    payload: {},
    headers: { authorization: "Bearer chave-errada" },
  });
  assert.equal(res.statusCode, 401);
});

test("GET /health não exige Authorization (health check do ALB não manda header)", async () => {
  const app = await montarApp();
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
});

test("GET /fluxos lista pessoa-presa e violencia-domestica com seus ids", async () => {
  const app = await montarApp();
  const res = await app.inject({ method: "GET", url: "/fluxos", headers: AUTH });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Array<{ id: string; nome: string }>;
  assert.deepEqual(
    body.map((f) => f.id).sort(),
    [ID_PESSOA_PRESA, ID_VIOLENCIA_DOMESTICA].sort()
  );
  assert.ok(body.find((f) => f.id === ID_PESSOA_PRESA)?.nome === "pessoa-presa");
});

test("POST /atendimentos/:fluxoId com fluxoId desconhecido → 404", async () => {
  const app = await montarApp();
  const res = await app.inject({
    method: "POST",
    url: "/atendimentos/00000000-0000-0000-0000-000000000000",
    payload: { chatId: novoChatId() },
    headers: AUTH,
  });
  assert.equal(res.statusCode, 404);
});

// chatId é obrigatório SEMPRE (produção e desenvolvimento) — só NODE_ENV=test
// relaxa isso (gera UUID), pra facilitar teste sem precisar inventar chatId
// toda hora. Rodando via `pnpm test`, NODE_ENV já vem "test" (ver package.json).
test("POST /atendimentos/:fluxoId sem chatId, NODE_ENV=test → 200 com UUID gerado, não rejeita com 400", async () => {
  const app = await montarApp();
  const res = await app.inject({ method: "POST", url: BASE, payload: {}, headers: AUTH });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, "em_andamento");
});

test("POST /atendimentos/:fluxoId sem chatId, FORA de NODE_ENV=test → 400 (obrigatório de verdade)", async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const app = await montarApp();
    const res = await app.inject({ method: "POST", url: BASE, payload: {}, headers: AUTH });
    assert.equal(res.statusCode, 400);
  } finally {
    process.env.NODE_ENV = original;
  }
});

test("POST /atendimentos/:fluxoId → 200, Location aponta pro recurso criado, _links.responder presente", async () => {
  const app = await montarApp();
  const chatId = novoChatId();
  const res = await app.inject({ method: "POST", url: BASE, payload: { chatId }, headers: AUTH });
  const body = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.location, `${BASE}/${chatId}`);
  assert.equal(body.status, "em_andamento");
  assert.equal(body._links.self.href, `${BASE}/${chatId}`);
  assert.equal(body._links.responder.href, `${BASE}/${chatId}/respostas`);
  assert.equal(body._links.responder.method, "POST");
});

test("GET /atendimentos/:fluxoId/:chatId inexistente → 404", async () => {
  const app = await montarApp();
  const res = await app.inject({ method: "GET", url: `${BASE}/nao-existe-nunca-foi-criado`, headers: AUTH });
  assert.equal(res.statusCode, 404);
});

test("GET /atendimentos/:fluxoId/:chatId depois de criado → mesmo estado, sem avançar o fluxo", async () => {
  const app = await montarApp();
  const chatId = novoChatId();
  const criado = await app.inject({ method: "POST", url: BASE, payload: { chatId }, headers: AUTH });
  const res = await app.inject({ method: "GET", url: `${BASE}/${chatId}`, headers: AUTH });
  const body = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(body.resposta, criado.json().resposta, "GET não deve avançar o fluxo");
  assert.equal(body.status, "em_andamento");
});

// Regressão — bug real achado ao vivo 2026-08-31: a Tykhe chamando POST
// /atendimentos de novo no MESMO chatId (retry/reconexão) reiniciava a
// conversa do zero, apagando o progresso. POST em chatId existente agora é
// idempotente — comportamento genérico da rota, não de um fluxo específico
// (regressão de negócio equivalente pra pessoa-presa mora em
// fluxos/pessoaPresa/http.test.ts).
test("POST /atendimentos/:fluxoId 2x no MESMO chatId não reinicia — devolve o estado atual", async () => {
  const app = await montarApp();
  const chatId = novoChatId();
  const primeira = await app.inject({ method: "POST", url: BASE, payload: { chatId }, headers: AUTH });
  const segunda = await app.inject({ method: "POST", url: BASE, payload: { chatId }, headers: AUTH });
  assert.equal(segunda.statusCode, 200);
  assert.equal(segunda.json().resposta, primeira.json().resposta, "não deveria reiniciar o fluxo");
});

test("POST /atendimentos/:fluxoId/:chatId/respostas em chatId inexistente → 409", async () => {
  const app = await montarApp();
  const res = await app.inject({
    method: "POST",
    url: `${BASE}/nunca-criado/respostas`,
    payload: { resposta: "qualquer coisa" },
    headers: AUTH,
  });
  assert.equal(res.statusCode, 409);
});

test("fluxo concluído: sem opcoes, sem _links.responder", async () => {
  const app = await montarApp();
  const chatId = novoChatId();
  await app.inject({ method: "POST", url: BASE, payload: { chatId }, headers: AUTH });
  const res = await app.inject({
    method: "POST",
    url: `${BASE}/${chatId}/respostas`,
    payload: { resposta: "qualquer coisa" },
    headers: AUTH,
  });
  const body = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(body.status, "concluido");
  assert.equal(body.opcoes, undefined);
  assert.equal(body._links.responder, undefined, "concluído não deve oferecer link pra responder de novo");
  assert.equal(body._links.self.href, `${BASE}/${chatId}`);
});
