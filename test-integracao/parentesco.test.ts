import { test } from "node:test";
import assert from "node:assert/strict";
import { classificarEntreOpcoes } from "../src/ia/classificar.js";

// Mesmo padrão de test-integracao/classificar.test.ts — chama o Bedrock de
// VERDADE com a lista/sistema REAIS de classificarParentesco (fluxos/pessoaPresa/graph.ts),
// pra confirmar ao vivo os 2 exemplos da issue #17 (não só a lógica com mock).
// Roda com `pnpm test:integracao`.
const PARENTESCOS_PERMITIDOS = [
  "Mãe",
  "Pai",
  "Irmão(a)",
  "Esposo(a)",
  "Ex-esposo(a)",
  "Companheiro(a)",
  "Filho(a)",
  "Amigo(a)",
  "Primo(a)",
  "Tio(a)",
  "Sobrinho(a)",
  "Avô/Avó",
  "Cunhado(a)",
  "Sogro(a)",
  "Outro",
];

const SISTEMA = `Você classifica o parentesco de quem busca informação sobre uma pessoa presa, na Defensoria Pública do RJ, a partir de um relato livre.
Parentescos possíveis: ${PARENTESCOS_PERMITIDOS.join(", ")}.
Regras: escolha o que melhor descreve a relação, mesmo que o relato seja indireto (ex: "fui casada com ele mas já nos divorciamos" → "Ex-esposo(a)"). Se não bater com confiança em nenhum, responda "nenhum".`;

test("issue #17 exemplo 1: relato indireto de ex-cônjuge → Ex-esposo(a) (Bedrock real)", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const resultado = await classificarEntreOpcoes("Fui casada por dez anos mas já nos divorciamos", SISTEMA, PARENTESCOS_PERMITIDOS);
    assert.equal(resultado.viaIA, true);
    assert.equal(resultado.escolhaId, "Ex-esposo(a)");
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

test("issue #17 exemplo 2: relato indireto de amizade → Amigo(a) (Bedrock real)", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const resultado = await classificarEntreOpcoes("Conheço ele desde criança e sempre fomos vizinhos", SISTEMA, PARENTESCOS_PERMITIDOS);
    assert.equal(resultado.viaIA, true);
    assert.equal(resultado.escolhaId, "Amigo(a)");
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

test("issue #17: resposta já é valor direto da lista → sem ambiguidade (Bedrock real)", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const resultado = await classificarEntreOpcoes("amigo", SISTEMA, PARENTESCOS_PERMITIDOS);
    assert.equal(resultado.viaIA, true);
    assert.equal(resultado.escolhaId, "Amigo(a)");
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

test("issue #17: relato sem match claro → cai em Outro (Bedrock real)", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const resultado = await classificarEntreOpcoes("gosto de pizza aos domingos", SISTEMA, PARENTESCOS_PERMITIDOS);
    assert.equal(resultado.viaIA, true);
    // "Outro" já é um candidato válido da própria lista (não um valor
    // especial "nenhum") — o Bedrock escolhe "Outro" diretamente em vez de
    // "nenhum" quando nada mais bate. classificarParentesco (graph.ts) trata
    // os 2 casos (escolhaId:"Outro" ou escolhaId:undefined) igual, então o
    // resultado final em metadados.parentesco é o mesmo de qualquer forma.
    assert.equal(resultado.escolhaId ?? "Outro", "Outro", "sem parentesco identificável, deveria terminar em Outro");
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});
