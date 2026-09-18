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
// Issue #83 — colunas de desfecho preenchidas na conclusão (concluir()),
// dado de negócio estruturado pra consulta SQL direta (datasource Postgres
// no Grafana), sem depender só de CloudWatch Logs Insights (issue #82).
// Mesmos campos do log "atendimento finalizado" (rotas/atendimentos.ts).
export interface ConclusaoAtendimento {
  statusFinal: "concluido" | "handoff_humano";
  destino?: string;
  motivoHandoff?: string;
  tokensGastos?: { input: number; output: number; total: number };
}

export interface AtendimentosStore {
  registrar(chatId: string, flowId: string): Promise<{ ok: true } | { ok: false; flowIdExistente: string }>;
  buscarFlowId(chatId: string): Promise<string | undefined>;
  concluir(chatId: string, dados: ConclusaoAtendimento): Promise<void>;
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
    async concluir() {},
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
  // Issue #83 — colunas de desfecho, adicionadas via ALTER (não recriação):
  // tabela já existe em prod com linhas, CREATE TABLE IF NOT EXISTS não
  // alcança colunas novas numa tabela já existente. Todas nullable — só
  // ganham valor em concluir(), continuam NULL enquanto o atendimento está
  // em andamento (é o que distingue "em andamento" de "concluído" pra quem
  // consulta via SQL direto).
  await pool.query(`
    ALTER TABLE atendimentos
      ADD COLUMN IF NOT EXISTS concluido_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS status_final TEXT,
      ADD COLUMN IF NOT EXISTS destino TEXT,
      ADD COLUMN IF NOT EXISTS motivo_handoff TEXT,
      ADD COLUMN IF NOT EXISTS tokens_entrada INTEGER,
      ADD COLUMN IF NOT EXISTS tokens_saida INTEGER,
      ADD COLUMN IF NOT EXISTS tokens_total INTEGER
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
    async concluir(chatId, dados) {
      await pool.query(
        `UPDATE atendimentos
         SET concluido_em = now(), status_final = $2, destino = $3, motivo_handoff = $4,
             tokens_entrada = $5, tokens_saida = $6, tokens_total = $7
         WHERE chat_id = $1`,
        [
          chatId,
          dados.statusFinal,
          dados.destino ?? null,
          dados.motivoHandoff ?? null,
          dados.tokensGastos?.input ?? null,
          dados.tokensGastos?.output ?? null,
          dados.tokensGastos?.total ?? null,
        ]
      );
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
