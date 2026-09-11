import pg from "pg";
import { logger } from "./logger.js";

const { Pool } = pg;

// Referência da árvore de perguntas do Verde por categoria (issue #20) —
// alimentada pelo script scripts/coletarArvorePerguntasVerde.ts (roda sob
// demanda, não em request). `flowId` é o MESMO uuid usado em
// fluxosPorId/fluxos_planejados (fluxos/index.ts, shared/fluxosPlanejadosDb.ts)
// — sem FK física, porque metade desses ids só existe em código
// (fluxosPorId), não em tabela nenhuma (mesma situação de
// atendimentos.flow_id).
export interface PerguntaArvore {
  id: string;
  flowId: string;
  // null pro nó raiz da árvore (identificado por idCategoria, não por
  // idItemCategoria — só os nós filhos têm idItemCategoria no Verde).
  idItemCategoria: number | null;
  // id da resposta (Verde) que levou até este nó — null pro nó raiz.
  veioDaRespostaId: number | null;
  textoPergunta: string;
  // "texto" cobre nós informativos sem opções reais (ver
  // scripts/coletarArvorePerguntasVerde.ts — dado inconsistente do próprio
  // Verde), além do uso normal futuro de pergunta livre.
  tipo: "sim_nao" | "opcoes" | "texto";
  opcoes: Array<{ id: number; resposta: string }>;
  // ordem de inserção durante o crawl (DFS) — só pra leitura/documentação
  // ficar em ordem estável, não representa profundidade na árvore.
  ordem: number;
}

// Nó FINAL da árvore (assuntoEncontrado: true, GET /assunto/{id}) — SEM
// flowId aqui de propósito: o MESMO assunto pode ser o destino de árvores de
// VÁRIAS categorias diferentes (ex: "LIGAR 129" aparece como saída de
// dezenas de categorias). Achado ao vivo 2026-09-11 rodando o crawl —
// guardar flowId direto nesta linha (1ª versão) perdia a associação de
// todas as categorias menos a última que escreveu por cima (mesmo
// id_assunto, upsert). Ver FlowAssunto abaixo — a ligação por (flow,
// assunto) mora numa tabela própria, o detalhe do assunto (nome/descrição/
// documentos) fica só aqui, sem duplicar.
export interface AssuntoVerde {
  idAssunto: number;
  nome: string;
  nomeMateria?: string;
  descricao?: string;
  txDocumentosNecessarios?: string;
  documentosNecessarios: Array<{ id: number; nomeDocumento: string; basico: boolean }>;
  urgente: boolean;
  plantao: boolean;
}

// Liga um flow a um assunto que a árvore dele alcança — 1 linha por
// (flow, caminho) que chega lá, mesmo quando o idAssunto é compartilhado
// com outras categorias.
export interface FlowAssunto {
  id: string;
  flowId: string;
  idAssunto: number;
  veioDaRespostaId: number | null;
}

export type AssuntoDoFlow = AssuntoVerde & { veioDaRespostaId: number | null };

export interface PerguntasStore {
  inserirPergunta(p: PerguntaArvore): Promise<void>;
  inserirAssunto(a: AssuntoVerde): Promise<void>;
  inserirFlowAssunto(fa: FlowAssunto): Promise<void>;
  listarPerguntasPorFlow(flowId: string): Promise<PerguntaArvore[]>;
  listarAssuntosPorFlow(flowId: string): Promise<AssuntoDoFlow[]>;
  // Remove perguntas e ligações flow→assunto de um flowId antes de
  // recrawlear — o crawl não é incremental (a árvore pode mudar de forma
  // entre uma rodada e outra), roda "substitui tudo" por flowId em vez de
  // tentar diff. NÃO apaga `assuntos_verde` (detalhe compartilhado — outro
  // flow pode ainda apontar pra ele).
  limparFlow(flowId: string): Promise<void>;
}

function criarStoreEmMemoria(): PerguntasStore {
  const perguntas: PerguntaArvore[] = [];
  const assuntos = new Map<number, AssuntoVerde>();
  const flowAssuntos: FlowAssunto[] = [];
  return {
    async inserirPergunta(p) {
      perguntas.push(p);
    },
    async inserirAssunto(a) {
      assuntos.set(a.idAssunto, a);
    },
    async inserirFlowAssunto(fa) {
      flowAssuntos.push(fa);
    },
    async listarPerguntasPorFlow(flowId) {
      return perguntas.filter((p) => p.flowId === flowId);
    },
    async listarAssuntosPorFlow(flowId) {
      return flowAssuntos
        .filter((fa) => fa.flowId === flowId)
        .map((fa) => {
          const detalhe = assuntos.get(fa.idAssunto);
          if (!detalhe) throw new Error(`flowAssunto aponta pra idAssunto ${fa.idAssunto} sem detalhe inserido`);
          return { ...detalhe, veioDaRespostaId: fa.veioDaRespostaId };
        });
    },
    async limparFlow(flowId) {
      for (let i = perguntas.length - 1; i >= 0; i--) if (perguntas[i].flowId === flowId) perguntas.splice(i, 1);
      for (let i = flowAssuntos.length - 1; i >= 0; i--) if (flowAssuntos[i].flowId === flowId) flowAssuntos.splice(i, 1);
    },
  };
}

function criarStorePostgres(url: string): PerguntasStore {
  const pool = new Pool({ connectionString: url });
  const prontoPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS perguntas (
        id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        id_item_categoria INTEGER,
        veio_da_resposta_id INTEGER,
        texto_pergunta TEXT NOT NULL,
        tipo TEXT NOT NULL,
        opcoes JSONB NOT NULL DEFAULT '[]',
        ordem INTEGER NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS perguntas_flow_id_idx ON perguntas (flow_id)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS assuntos_verde (
        id_assunto INTEGER PRIMARY KEY,
        nome TEXT NOT NULL,
        nome_materia TEXT,
        descricao TEXT,
        tx_documentos_necessarios TEXT,
        documentos_necessarios JSONB NOT NULL DEFAULT '[]',
        urgente BOOLEAN NOT NULL DEFAULT false,
        plantao BOOLEAN NOT NULL DEFAULT false
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flow_assuntos (
        id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        id_assunto INTEGER NOT NULL,
        veio_da_resposta_id INTEGER
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS flow_assuntos_flow_id_idx ON flow_assuntos (flow_id)`);
    logger.info("[perguntasDb] tabelas 'perguntas', 'assuntos_verde' e 'flow_assuntos' prontas (Postgres)");
  })();

  return {
    async inserirPergunta(p) {
      await prontoPromise;
      await pool.query(
        `INSERT INTO perguntas (id, flow_id, id_item_categoria, veio_da_resposta_id, texto_pergunta, tipo, opcoes, ordem)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         ON CONFLICT (id) DO UPDATE SET texto_pergunta = $5, tipo = $6, opcoes = $7::jsonb, ordem = $8`,
        [p.id, p.flowId, p.idItemCategoria, p.veioDaRespostaId, p.textoPergunta, p.tipo, JSON.stringify(p.opcoes), p.ordem]
      );
    },
    async inserirAssunto(a) {
      await prontoPromise;
      await pool.query(
        `INSERT INTO assuntos_verde (id_assunto, nome, nome_materia, descricao, tx_documentos_necessarios, documentos_necessarios, urgente, plantao)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         ON CONFLICT (id_assunto) DO UPDATE SET nome = $2, nome_materia = $3, descricao = $4,
           tx_documentos_necessarios = $5, documentos_necessarios = $6::jsonb, urgente = $7, plantao = $8`,
        [
          a.idAssunto,
          a.nome,
          a.nomeMateria ?? null,
          a.descricao ?? null,
          a.txDocumentosNecessarios ?? null,
          JSON.stringify(a.documentosNecessarios),
          a.urgente,
          a.plantao,
        ]
      );
    },
    async inserirFlowAssunto(fa) {
      await prontoPromise;
      await pool.query(
        `INSERT INTO flow_assuntos (id, flow_id, id_assunto, veio_da_resposta_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET id_assunto = $3, veio_da_resposta_id = $4`,
        [fa.id, fa.flowId, fa.idAssunto, fa.veioDaRespostaId]
      );
    },
    async listarPerguntasPorFlow(flowId) {
      await prontoPromise;
      const res = await pool.query(`SELECT * FROM perguntas WHERE flow_id = $1 ORDER BY ordem`, [flowId]);
      return res.rows.map((r) => ({
        id: r.id,
        flowId: r.flow_id,
        idItemCategoria: r.id_item_categoria,
        veioDaRespostaId: r.veio_da_resposta_id,
        textoPergunta: r.texto_pergunta,
        tipo: r.tipo,
        opcoes: r.opcoes,
        ordem: r.ordem,
      }));
    },
    async listarAssuntosPorFlow(flowId) {
      await prontoPromise;
      const res = await pool.query(
        `SELECT av.*, fa.veio_da_resposta_id AS fa_veio_da_resposta_id
         FROM flow_assuntos fa
         JOIN assuntos_verde av ON av.id_assunto = fa.id_assunto
         WHERE fa.flow_id = $1`,
        [flowId]
      );
      return res.rows.map((r) => ({
        idAssunto: r.id_assunto,
        nome: r.nome,
        nomeMateria: r.nome_materia ?? undefined,
        descricao: r.descricao ?? undefined,
        txDocumentosNecessarios: r.tx_documentos_necessarios ?? undefined,
        documentosNecessarios: r.documentos_necessarios,
        urgente: r.urgente,
        plantao: r.plantao,
        veioDaRespostaId: r.fa_veio_da_resposta_id,
      }));
    },
    async limparFlow(flowId) {
      await prontoPromise;
      await pool.query(`DELETE FROM perguntas WHERE flow_id = $1`, [flowId]);
      await pool.query(`DELETE FROM flow_assuntos WHERE flow_id = $1`, [flowId]);
    },
  };
}

let storePromise: Promise<PerguntasStore> | undefined;

export function obterPerguntasStore(): Promise<PerguntasStore> {
  if (!storePromise) {
    const url = process.env.DATABASE_URL;
    storePromise = Promise.resolve(url ? criarStorePostgres(url) : criarStoreEmMemoria());
  }
  return storePromise;
}
