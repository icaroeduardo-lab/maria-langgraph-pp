import { MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

// Sem DATABASE_URL (ex: rodando os testes, que não carregam .env) cai pro
// MemorySaver — checkpoint em memória, morre com o processo, mas mantém os
// testes rápidos/isolados sem precisar de Postgres no ar. Com DATABASE_URL
// (server.ts real), persiste de verdade — sobrevive a reinício/deploy.
async function criarCheckpointerReal(): Promise<BaseCheckpointSaver> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[checkpoint] DATABASE_URL ausente — usando MemorySaver (não persiste)");
    return new MemorySaver();
  }
  const saver = PostgresSaver.fromConnString(url);
  await saver.setup(); // cria as tabelas de checkpoint se ainda não existirem
  console.log("[checkpoint] PostgresSaver conectado");
  return saver;
}

// Memoizado a nível de módulo — cada fluxo (fluxos/*/graph.ts) chama isso no
// próprio import, e como ES modules são singletons por processo, TODOS os
// fluxos acabam compartilhando a MESMA conexão/pool em vez de abrir uma
// PostgresSaver por fluxo.
let checkpointerPromise: Promise<BaseCheckpointSaver> | undefined;

export function criarCheckpointer(): Promise<BaseCheckpointSaver> {
  if (!checkpointerPromise) checkpointerPromise = criarCheckpointerReal();
  return checkpointerPromise;
}
