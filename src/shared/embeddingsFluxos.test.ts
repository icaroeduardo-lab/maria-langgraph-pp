import { test } from "node:test";
import assert from "node:assert/strict";
import { buscarCandidatos } from "./embeddingsFluxos.js";

// NODE_ENV=test nunca chama Bedrock (embedding fake, ver embeddingsFluxos.ts)
// e nunca usa Postgres real (DATABASE_URL não é setado em teste, ver
// package.json) — cai na busca em memória. Cenários espelham exatamente o
// BDD da issue #8.

function catalogo(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `fluxo-${i}`,
    nome: `Fluxo ${i}`,
    descricao: `Descrição do fluxo número ${i}, usado só pra teste de retrieval.`,
  }));
}

test("poucos fluxos cadastrados (≤ k) — devolve o catálogo inteiro, sem cortar", async () => {
  const c = catalogo(2);
  const candidatos = await buscarCandidatos("relato qualquer", 10, c);
  assert.equal(candidatos.length, 2);
  assert.deepEqual(candidatos, c);
});

test("muitos fluxos cadastrados (> k) — só os k mais similares voltam", async () => {
  const c = catalogo(80);
  const candidatos = await buscarCandidatos("relato qualquer", 10, c);
  assert.equal(candidatos.length, 10);
  // todos os candidatos devolvidos precisam existir no catálogo original
  for (const cand of candidatos) {
    assert.ok(c.some((f) => f.id === cand.id), `${cand.id} deveria vir do catálogo original`);
  }
});

test("exatamente k fluxos — não corta (limite é inclusivo)", async () => {
  const c = catalogo(10);
  const candidatos = await buscarCandidatos("relato qualquer", 10, c);
  assert.equal(candidatos.length, 10);
});

test("resultado é consistente pra mesma mensagem/catálogo (embedding fake é determinístico)", async () => {
  const c = catalogo(80);
  const r1 = await buscarCandidatos("mesma mensagem sempre", 10, c);
  const r2 = await buscarCandidatos("mesma mensagem sempre", 10, c);
  assert.deepEqual(r1.map((f) => f.id).sort(), r2.map((f) => f.id).sort());
});
