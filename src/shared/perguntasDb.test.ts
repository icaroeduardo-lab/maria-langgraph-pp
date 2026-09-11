import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { obterPerguntasStore, type PerguntaArvore, type AssuntoVerde, type FlowAssunto } from "./perguntasDb.js";

// NODE_ENV=test nunca usa Postgres real (DATABASE_URL não é setado em
// teste, ver package.json) — cai no store em memória. Mesmo store é
// memoizado a nível de módulo (ver obterPerguntasStore), então os testes
// usam flowId próprio pra não vazar estado entre si.

function pergunta(flowId: string, overrides: Partial<PerguntaArvore> = {}): PerguntaArvore {
  return {
    id: `${flowId}-pergunta-${overrides.ordem ?? 0}`,
    flowId,
    idItemCategoria: null,
    veioDaRespostaId: null,
    textoPergunta: "pergunta de teste",
    tipo: "sim_nao",
    opcoes: [{ id: 1, resposta: "SIM" }, { id: 2, resposta: "NÃO" }],
    ordem: 0,
    ...overrides,
  };
}

function assunto(idAssunto: number, overrides: Partial<AssuntoVerde> = {}): AssuntoVerde {
  return {
    idAssunto,
    nome: "assunto de teste",
    documentosNecessarios: [],
    urgente: false,
    plantao: false,
    ...overrides,
  };
}

function flowAssunto(flowId: string, idAssunto: number, overrides: Partial<FlowAssunto> = {}): FlowAssunto {
  return { id: randomUUID(), flowId, idAssunto, veioDaRespostaId: null, ...overrides };
}

test("inserirPergunta + listarPerguntasPorFlow — devolve só as do flowId pedido, na ordem", async () => {
  const store = await obterPerguntasStore();
  const flowId = "flow-teste-1";
  await store.inserirPergunta(pergunta(flowId, { ordem: 1, id: "p1" }));
  await store.inserirPergunta(pergunta(flowId, { ordem: 0, id: "p0" }));
  await store.inserirPergunta(pergunta("outro-flow", { id: "p-outro" }));

  const lista = await store.listarPerguntasPorFlow(flowId);
  assert.equal(lista.length, 2);
  assert.ok(lista.every((p) => p.flowId === flowId));
});

test("buscarPerguntaRaiz — devolve só a linha de ordem 0 do flowId pedido", async () => {
  const store = await obterPerguntasStore();
  const flowId = "flow-teste-raiz";
  await store.inserirPergunta(pergunta(flowId, { ordem: 0, id: "raiz", textoPergunta: "pergunta raiz" }));
  await store.inserirPergunta(pergunta(flowId, { ordem: 1, id: "filha", textoPergunta: "pergunta filha" }));

  const raiz = await store.buscarPerguntaRaiz(flowId);
  assert.equal(raiz?.textoPergunta, "pergunta raiz");
});

test("buscarPerguntaRaiz — undefined quando o flowId não tem nenhuma pergunta", async () => {
  const store = await obterPerguntasStore();
  const raiz = await store.buscarPerguntaRaiz("flow-sem-pergunta-nenhuma");
  assert.equal(raiz, undefined);
});

test("inserirAssunto + inserirFlowAssunto + listarAssuntosPorFlow — devolve só os do flowId pedido", async () => {
  const store = await obterPerguntasStore();
  const flowId = "flow-teste-2";
  await store.inserirAssunto(assunto(111));
  await store.inserirAssunto(assunto(222, { urgente: true, plantao: true }));
  await store.inserirAssunto(assunto(333));
  await store.inserirFlowAssunto(flowAssunto(flowId, 111));
  await store.inserirFlowAssunto(flowAssunto(flowId, 222));
  await store.inserirFlowAssunto(flowAssunto("outro-flow", 333));

  const lista = await store.listarAssuntosPorFlow(flowId);
  assert.equal(lista.length, 2);
  const urgente = lista.find((a) => a.idAssunto === 222);
  assert.equal(urgente?.urgente, true);
  assert.equal(urgente?.plantao, true);
});

// Regressão do bug real achado rodando o crawl completo (issue #20,
// 2026-09-11): o mesmo idAssunto pode ser alcançado pela árvore de VÁRIAS
// categorias diferentes (ex: "LIGAR 129" é saída de dezenas delas). Com
// idAssunto como dono da linha inteira (1ª versão desta tabela), a 2ª
// categoria que inseria sobrescrevia a ligação da 1ª — 749 visitas de
// assunto viraram só 274 linhas. A ligação flow→assunto é tabela própria
// exatamente pra evitar isso.
test("mesmo idAssunto alcançado por 2 flows diferentes — os 2 preservam a ligação, sem se sobrescreverem", async () => {
  const store = await obterPerguntasStore();
  const flowA = "flow-teste-compartilhado-a";
  const flowB = "flow-teste-compartilhado-b";
  const idAssuntoCompartilhado = 999;

  await store.inserirAssunto(assunto(idAssuntoCompartilhado, { nome: "LIGAR 129" }));
  await store.inserirFlowAssunto(flowAssunto(flowA, idAssuntoCompartilhado, { veioDaRespostaId: 1 }));
  await store.inserirFlowAssunto(flowAssunto(flowB, idAssuntoCompartilhado, { veioDaRespostaId: 2 }));

  const listaA = await store.listarAssuntosPorFlow(flowA);
  const listaB = await store.listarAssuntosPorFlow(flowB);
  assert.equal(listaA.length, 1, "flowA deveria continuar enxergando o assunto compartilhado");
  assert.equal(listaB.length, 1, "flowB deveria continuar enxergando o assunto compartilhado, sem apagar o de A");
  assert.equal(listaA[0].veioDaRespostaId, 1);
  assert.equal(listaB[0].veioDaRespostaId, 2);
});

test("limparFlow — remove perguntas e ligações flow→assunto só do flowId pedido, recrawl não acumula duplicado", async () => {
  const store = await obterPerguntasStore();
  const flowId = "flow-teste-3";
  const outroFlowId = "flow-teste-3-intacto";

  await store.inserirPergunta(pergunta(flowId, { id: "p-antiga" }));
  await store.inserirAssunto(assunto(444));
  await store.inserirFlowAssunto(flowAssunto(flowId, 444));
  await store.inserirPergunta(pergunta(outroFlowId, { id: "p-intacta" }));

  await store.limparFlow(flowId);

  assert.equal((await store.listarPerguntasPorFlow(flowId)).length, 0);
  assert.equal((await store.listarAssuntosPorFlow(flowId)).length, 0);
  assert.equal((await store.listarPerguntasPorFlow(outroFlowId)).length, 1, "flowId diferente não deveria ser afetado");

  // simula recrawl — insere de novo depois de limpar, não deveria duplicar
  await store.inserirPergunta(pergunta(flowId, { id: "p-nova" }));
  assert.equal((await store.listarPerguntasPorFlow(flowId)).length, 1);
});
