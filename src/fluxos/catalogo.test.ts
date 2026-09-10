import { test } from "node:test";
import assert from "node:assert/strict";
import { fluxosPlanejados } from "./catalogo.js";
import { fluxosPorId } from "./index.js";

// Regressão pro catálogo real do Verde (issue #19) — garante que popular
// fluxosPlanejados não duplicou um fluxo já implementado nem deixou
// descrição vazia (quebraria embedding/classificação em silêncio).

test("nenhum idCategoriaAssuntoVerde de fluxosPlanejados repete o de um fluxo já implementado", () => {
  const idsImplementados = new Set(
    Object.values(fluxosPorId)
      .map((f) => f.idCategoriaAssuntoVerde)
      .filter((id): id is number => id !== undefined)
  );
  for (const f of fluxosPlanejados) {
    assert.ok(
      !idsImplementados.has(f.idCategoriaAssuntoVerde),
      `${f.nome} (idCategoriaAssuntoVerde ${f.idCategoriaAssuntoVerde}) duplica um fluxo já implementado`
    );
  }
});

test("nenhuma entrada de fluxosPlanejados tem descricao vazia", () => {
  for (const f of fluxosPlanejados) {
    assert.ok(f.descricao.trim().length > 0, `${f.nome} está com descricao vazia`);
  }
});

test("ids (uuid) de fluxosPlanejados são únicos e não colidem com fluxosPorId", () => {
  const idsPlanejados = fluxosPlanejados.map((f) => f.id);
  assert.equal(new Set(idsPlanejados).size, idsPlanejados.length, "há uuid repetido dentro de fluxosPlanejados");
  for (const id of idsPlanejados) {
    assert.ok(!(id in fluxosPorId), `${id} colide com um fluxo já implementado`);
  }
});

test("volume carregado bate com a lista real confirmada em 2026-09-10 (73 categorias − lixo − violência doméstica já implementada)", () => {
  assert.equal(fluxosPlanejados.length, 71);
});
