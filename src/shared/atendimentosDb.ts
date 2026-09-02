import pg from "pg";
import { logger } from "./logger.js";

const { Pool } = pg;

// chatId é a chave — 1 chatId pertence a exatamente 1 flowId pra sempre (é o
// que permite GET e POST /atendimentos/respostas não precisarem de flowId
// de novo: o servidor resolve sozinho). Chave primária em chat_id também
// bloqueia a colisão que motivou essa tabela: tentar criar um atendimento
// com um chatId já usado por OUTRO flowId vira erro explícito (ver
// registrar()), em vez de dois fluxos pisando no mesmo checkpoint do
// LangGraph (que é indexado só por thread_id=chatId, sem separar por fluxo).
export interface AtendimentosStore {
  registrar(chatId: string, flowId: string): Promise<{ ok: true } | { ok: false; flowIdExistente: string }>;
  buscarFlowId(chatId: string): Promise<string | undefined>;
}

// Sem DATABASE_URL (testes, que não carregam .env) cai pra um Map em
// memória — mesmo padrão de criarCheckpointer() (shared/checkpointer.ts).
function criarStoreEmMemoria(): AtendimentosStore {
  const mapa = new Map<string, string>();
  return {
    async registrar(chatId, flowId) {
      const existente = mapa.get(chatId);
      if (existente !== undefined) return existente === flowId ? { ok: true } : { ok: false, flowIdExistente: existente };
      mapa.set(chatId, flowId);
      return { ok: true };
    },
    async buscarFlowId(chatId) {
      return mapa.get(chatId);
    },
  };
}

async function criarStorePostgres(url: string): Promise<AtendimentosStore> {
  const pool = new Pool({ connectionString: url });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atendimentos (
      chat_id TEXT PRIMARY KEY,
      flow_id UUID NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  logger.info("[atendimentosDb] tabela 'atendimentos' pronta (Postgres)");

  return {
    async registrar(chatId, flowId) {
      // ON CONFLICT DO NOTHING + RETURNING: se inseriu, rowCount>0 (era novo).
      // Se não inseriu (já existia), busca o flow_id real pra comparar —
      // mesmo chatId+flowId de novo é idempotente (ok), chatId com OUTRO
      // flowId é o conflito que essa tabela existe pra pegar.
      const inserido = await pool.query<{ flow_id: string }>(
        `INSERT INTO atendimentos (chat_id, flow_id) VALUES ($1, $2)
         ON CONFLICT (chat_id) DO NOTHING
         RETURNING flow_id`,
        [chatId, flowId]
      );
      if ((inserido.rowCount ?? 0) > 0) return { ok: true };
      const existente = await pool.query<{ flow_id: string }>(`SELECT flow_id FROM atendimentos WHERE chat_id = $1`, [chatId]);
      const flowIdExistente = existente.rows[0]?.flow_id ?? flowId;
      return flowIdExistente === flowId ? { ok: true } : { ok: false, flowIdExistente };
    },
    async buscarFlowId(chatId) {
      const res = await pool.query<{ flow_id: string }>(`SELECT flow_id FROM atendimentos WHERE chat_id = $1`, [chatId]);
      return res.rows[0]?.flow_id;
    },
  };
}

// Memoizado a nível de módulo — mesmo racional de criarCheckpointer()
// (shared/checkpointer.ts): 1 pool compartilhado por processo.
let storePromise: Promise<AtendimentosStore> | undefined;

export function obterAtendimentosStore(): Promise<AtendimentosStore> {
  if (!storePromise) {
    const url = process.env.DATABASE_URL;
    storePromise = url ? criarStorePostgres(url) : Promise.resolve(criarStoreEmMemoria());
  }
  return storePromise;
}
