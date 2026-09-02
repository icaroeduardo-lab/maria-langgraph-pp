import { test } from "node:test";
import assert from "node:assert/strict";
import { montarApp } from "../../app.js";
import { ID_VIOLENCIA_DOMESTICA } from "../index.js";

// Mecânica genérica da rota já está coberta em test/app.test.ts (que, aliás,
// usa ESTE fluxo como fixture por ser o mais simples). Aqui só o que é
// específico do fluxo em si: texto da pergunta e shape de metadados.

const AUTH = { authorization: `Bearer ${process.env.API_KEY}` };
const BASE = `/atendimentos/${ID_VIOLENCIA_DOMESTICA}`;

test("fluxo violência doméstica: pergunta relato, conclui com relato nos metadados", async () => {
  const app = await montarApp();
  const chatId = "teste-vd-http-1";
  const criado = await app.inject({ method: "POST", url: BASE, payload: { chatId }, headers: AUTH });
  assert.equal(criado.json().tipoResposta, "texto");
  assert.match(criado.json().resposta, /o que está acontecendo/);

  const res = await app.inject({
    method: "POST",
    url: `${BASE}/${chatId}/respostas`,
    payload: { resposta: "relato de teste" },
    headers: AUTH,
  });
  const body = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(body.status, "concluido");
  assert.equal(body.metadados.relato, "relato de teste");
});
