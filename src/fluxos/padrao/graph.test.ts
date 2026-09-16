import { test } from "node:test";
import assert from "node:assert/strict";
import { grafo } from "./graph.js";
import { adicionarPlanejadoDeTeste, removerPlanejadoDeTeste } from "../../shared/fluxosPlanejadosDb.js";
import { MENSAGEM_CONCLUIDO } from "./api.js";

// NODE_ENV=test nunca usa Postgres real (sem DATABASE_URL) — adicionar/
// removerPlanejadoDeTeste (shared/fluxosPlanejadosDb.ts) simulam uma linha
// da tabela fluxos_planejados sem tocar dado de produção.

let contador = 0;
function novoConfig(fluxoId?: string) {
  contador += 1;
  return { configurable: { thread_id: `teste-padrao-${contador}`, ...(fluxoId ? { fluxoId } : {}) } };
}

test("categoria SEM mensagemFixa → usa a mensagem genérica de 'em construção'", async () => {
  const fluxoId = "00000000-0000-0000-0000-0000000000a1";
  await adicionarPlanejadoDeTeste({ id: fluxoId, nome: "categoria-teste", descricao: "teste", idCategoriaAssuntoVerde: 88888, palavrasChave: [] });
  try {
    const r = await grafo.invoke({}, novoConfig(fluxoId));
    const final = r as { statusFinal?: string; mensagemFinal?: string };
    assert.equal(final.statusFinal, "concluido");
    assert.equal(final.mensagemFinal, MENSAGEM_CONCLUIDO);
  } finally {
    await removerPlanejadoDeTeste(fluxoId);
  }
});

// Issue #22 — categorias de redirecionamento permanente (ex: reclamação
// trabalhista, LOAS) usam texto próprio em vez da mensagem genérica de "em
// construção", que dava a entender que um dia a Maria ia atender isso.
test("categoria COM mensagemFixa → usa o texto específico, não a genérica", async () => {
  const fluxoId = "00000000-0000-0000-0000-0000000000b2";
  const mensagem = "Não atuamos nesse tipo de caso — procure outro órgão.";
  await adicionarPlanejadoDeTeste({
    id: fluxoId,
    nome: "categoria-redirecionamento-teste",
    descricao: "teste",
    idCategoriaAssuntoVerde: 88889,
    palavrasChave: [],
    mensagemFixa: mensagem,
  });
  try {
    const r = await grafo.invoke({}, novoConfig(fluxoId));
    const final = r as { statusFinal?: string; mensagemFinal?: string };
    assert.equal(final.statusFinal, "concluido", "redirecionamento permanente ainda é um desfecho 'concluido', só muda o texto");
    assert.equal(final.mensagemFinal, mensagem);
  } finally {
    await removerPlanejadoDeTeste(fluxoId);
  }
});

test("sem fluxoId no config (não deveria acontecer em produção) → cai na mensagem genérica, não quebra", async () => {
  const r = await grafo.invoke({}, novoConfig());
  assert.equal((r as { mensagemFinal?: string }).mensagemFinal, MENSAGEM_CONCLUIDO);
});
