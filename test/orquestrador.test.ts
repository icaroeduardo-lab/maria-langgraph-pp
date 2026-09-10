import { test } from "node:test";
import assert from "node:assert/strict";
import { montarApp } from "../src/app.js";
import { ID_PESSOA_PRESA } from "../src/fluxos/index.js";
import { fluxosPlanejados } from "../src/fluxos/catalogo.js";

// Testa só a MECÂNICA da rota do orquestrador (rotas/orquestrador.ts) —
// resolve fluxo por classificação em vez de flowId explícito. Classificação
// em si é mockada via MOCK_CLASSIFICACAO_FLOWID (ver ia/classificarFluxo.ts)
// — NODE_ENV=test nunca chama Bedrock de verdade.

let contador = 0;
function novoChatId() {
  contador += 1;
  return `teste-orq-${contador}`;
}

const AUTH = { authorization: `Bearer ${process.env.API_KEY}` };
const BASE = "/atendimentos/orquestrador";

test("sem mensagem → 400", async () => {
  const app = await montarApp();
  const res = await app.inject({ method: "POST", url: BASE, payload: {}, headers: AUTH });
  assert.equal(res.statusCode, 400);
});

test("sem Authorization → 401 (rota protegida igual às demais)", async () => {
  const app = await montarApp();
  const res = await app.inject({ method: "POST", url: BASE, payload: { mensagem: "qualquer coisa" } });
  assert.equal(res.statusCode, 401);
});

test("classificação não identifica nenhum fluxo → handoff_humano direto, sem flowId", async () => {
  const original = process.env.MOCK_CLASSIFICACAO_FLOWID;
  delete process.env.MOCK_CLASSIFICACAO_FLOWID;
  try {
    const app = await montarApp();
    const res = await app.inject({
      method: "POST",
      url: BASE,
      payload: { chatId: novoChatId(), mensagem: "quero saber sobre meu carnê do IPTU" },
      headers: AUTH,
    });
    const body = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(body.status, "handoff_humano");
    assert.equal(body.motivoHandoff, "nao_identificado");
    assert.equal(body.flowId, undefined);
    assert.match(body.resposta, /Não consegui identificar/);
  } finally {
    process.env.MOCK_CLASSIFICACAO_FLOWID = original;
  }
});

// Mede demanda de fluxo ainda não codado (ver fluxos/catalogo.ts) — IA
// "reconhece" pelo relato, cai no grafo padrão compartilhado (issue #21),
// conclui de verdade (não é mais handoff especial). flowId aparece na
// resposta/log — é isso que dá a métrica de demanda, sem precisar de campo
// especial.
test("classificação identifica fluxo PLANEJADO (sem código ainda) → grafo padrão, concluido de verdade", async () => {
  const fluxoFalso = {
    id: "00000000-0000-0000-0000-000000000099",
    nome: "fluxo-teste-planejado",
    descricao: "só pra teste",
    idCategoriaAssuntoVerde: 99999,
  };
  fluxosPlanejados.push(fluxoFalso);
  const original = process.env.MOCK_CLASSIFICACAO_FLOWID;
  process.env.MOCK_CLASSIFICACAO_FLOWID = fluxoFalso.id;
  try {
    const app = await montarApp();
    const res = await app.inject({
      method: "POST",
      url: BASE,
      payload: { chatId: novoChatId(), mensagem: "preciso de um fluxo que ainda não existe" },
      headers: AUTH,
    });
    const body = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(body.status, "concluido");
    assert.equal(body.flowId, fluxoFalso.id, "flowId do planejado deve aparecer — atendimento rodou de verdade (grafo padrão)");
    assert.match(body.resposta, /sendo construíd/i);
  } finally {
    process.env.MOCK_CLASSIFICACAO_FLOWID = original;
    fluxosPlanejados.pop();
  }
});

// Issue #21: várias categorias planejadas diferentes compartilham a MESMA
// instância de grafo padrão (fluxos/index.ts::FLUXO_PADRAO) — isolamento de
// conversa é por chatId/thread_id, não por qual flowId planejado apontou pra
// cá. Esse teste garante que 2 flowId diferentes não misturam estado.
test("2 categorias planejadas diferentes usam o mesmo grafo padrão sem misturar estado entre si", async () => {
  const planejadoA = { id: "00000000-0000-0000-0000-0000000000a1", nome: "planejado-a", descricao: "a", idCategoriaAssuntoVerde: 88881 };
  const planejadoB = { id: "00000000-0000-0000-0000-0000000000b2", nome: "planejado-b", descricao: "b", idCategoriaAssuntoVerde: 88882 };
  fluxosPlanejados.push(planejadoA, planejadoB);
  const original = process.env.MOCK_CLASSIFICACAO_FLOWID;
  try {
    const app = await montarApp();
    const chatA = novoChatId();
    const chatB = novoChatId();

    process.env.MOCK_CLASSIFICACAO_FLOWID = planejadoA.id;
    const resA = await app.inject({ method: "POST", url: BASE, payload: { chatId: chatA, mensagem: "relato A" }, headers: AUTH });

    process.env.MOCK_CLASSIFICACAO_FLOWID = planejadoB.id;
    const resB = await app.inject({ method: "POST", url: BASE, payload: { chatId: chatB, mensagem: "relato B" }, headers: AUTH });

    assert.equal(resA.json().flowId, planejadoA.id);
    assert.equal(resB.json().flowId, planejadoB.id);
    assert.equal(resA.json().status, "concluido");
    assert.equal(resB.json().status, "concluido");

    const getA = await app.inject({ method: "GET", url: `/atendimentos/${chatA}`, headers: AUTH });
    const getB = await app.inject({ method: "GET", url: `/atendimentos/${chatB}`, headers: AUTH });
    assert.equal(getA.json().flowId, planejadoA.id, "GET do chatId A não deveria vazar o flowId de B");
    assert.equal(getB.json().flowId, planejadoB.id, "GET do chatId B não deveria vazar o flowId de A");
  } finally {
    process.env.MOCK_CLASSIFICACAO_FLOWID = original;
    fluxosPlanejados.pop();
    fluxosPlanejados.pop();
  }
});

test("classificação identifica pessoa-presa → cria atendimento normalmente, corpo inclui flowId", async () => {
  const original = process.env.MOCK_CLASSIFICACAO_FLOWID;
  process.env.MOCK_CLASSIFICACAO_FLOWID = ID_PESSOA_PRESA;
  try {
    const app = await montarApp();
    const chatId = novoChatId();
    const res = await app.inject({
      method: "POST",
      url: BASE,
      payload: { chatId, mensagem: "meu marido foi preso, queria saber do processo dele" },
      headers: AUTH,
    });
    const body = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(body.status, "em_andamento");
    assert.equal(body.flowId, ID_PESSOA_PRESA);
    assert.match(body.resposta, /número do processo/);

    // dali em diante é o MESMO atendimento de sempre — GET resolve pela
    // tabela chatId→flowId sem precisar mandar flowId de novo.
    const get = await app.inject({ method: "GET", url: `/atendimentos/${chatId}`, headers: AUTH });
    assert.equal(get.statusCode, 200);
    assert.equal(get.json().resposta, body.resposta);
  } finally {
    process.env.MOCK_CLASSIFICACAO_FLOWID = original;
  }
});

test("chatId já existe em outro flowId → 409, mesma proteção da criação manual", async () => {
  const chatId = novoChatId();
  const original = process.env.MOCK_CLASSIFICACAO_FLOWID;
  try {
    const app = await montarApp();
    // cria manualmente num fluxo
    await app.inject({
      method: "POST",
      url: "/atendimentos",
      payload: { chatId, flowId: ID_PESSOA_PRESA },
      headers: AUTH,
    });
    // orquestrador tenta criar o MESMO chatId classificando pra outro flowId
    process.env.MOCK_CLASSIFICACAO_FLOWID = "cabb2495-4e12-4f4a-9956-3d20649059bc";
    const res = await app.inject({
      method: "POST",
      url: BASE,
      payload: { chatId, mensagem: "sou vítima de violência doméstica" },
      headers: AUTH,
    });
    assert.equal(res.statusCode, 409);
  } finally {
    process.env.MOCK_CLASSIFICACAO_FLOWID = original;
  }
});
