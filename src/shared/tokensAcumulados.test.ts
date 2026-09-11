import { test } from "node:test";
import assert from "node:assert/strict";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { AnnotationTokensAcumulados } from "./tokensAcumulados.js";

// Testa o reducer isoladamente, com valores MOCKADOS (não depende de
// Bedrock real, NODE_ENV=test sempre zera os deltas reais dos fluxos de
// verdade — ver ia/reescrever.ts) — issue #35. Monta um mini-grafo próprio
// com o MESMO canal usado em produção (fluxos/pessoaPresa/state.ts,
// violenciaDomestica/state.ts, orquestrador/state.ts) pra validar a soma em
// si, não o valor real de nenhum fluxo.

// `marcador` só existe pra ter ALGUM canal escrito nos testes que não
// mexem em tokensGastosTotal — sem nenhum canal tocado em todo o invoke, o
// LangGraph devolve `undefined` em vez do state (comportamento do próprio
// LangGraph, não tem a ver com o reducer sendo testado aqui). Situação que
// não acontece nos fluxos de verdade — todo "preparar*" que faz bypass
// (campo já respondido) roda na MESMA perna de outros nós que escrevem
// alguma coisa.
function estadoDeTeste() {
  return Annotation.Root({ tokensGastosTotal: AnnotationTokensAcumulados(), marcador: Annotation<boolean | undefined>() });
}

test("reducer soma os deltas de vários nós, não sobrescreve com o último", async () => {
  const TesteState = estadoDeTeste();
  const grafo = new StateGraph(TesteState)
    .addNode("a", async () => ({ tokensGastosTotal: 100 }))
    .addNode("b", async () => ({ tokensGastosTotal: 50 }))
    .addEdge(START, "a")
    .addEdge("a", "b")
    .addEdge("b", END)
    .compile();
  const resultado = await grafo.invoke({});
  assert.equal(resultado.tokensGastosTotal, 150, "deveria somar os 2 deltas (100+50), não ficar só com o último (50)");
});

test("reducer soma em cima de um valor inicial passado no invoke (seed de outro grafo, ex: handoff do orquestrador)", async () => {
  const TesteState = estadoDeTeste();
  const grafo = new StateGraph(TesteState)
    .addNode("a", async () => ({ tokensGastosTotal: 20 }))
    .addEdge(START, "a")
    .addEdge("a", END)
    .compile();
  const resultado = await grafo.invoke({ tokensGastosTotal: 4324 });
  assert.equal(resultado.tokensGastosTotal, 4344, "seed inicial deveria somar com o delta do nó, não ser substituído");
});

test("sem nenhum delta (nenhuma chamada de IA rodou) o total é 0, não undefined", async () => {
  const TesteState = estadoDeTeste();
  const grafo = new StateGraph(TesteState)
    .addNode("semDelta", async () => ({ marcador: true }))
    .addEdge(START, "semDelta")
    .addEdge("semDelta", END)
    .compile();
  const resultado = await grafo.invoke({});
  assert.equal(resultado.tokensGastosTotal, 0);
});
