import pg from "pg";
import { logger } from "./logger.js";

const { Pool } = pg;

// Catálogo de fluxos que a Maria já RECONHECE pelo relato (classificação do
// orquestrador, ver rotas/orquestrador.ts), mas que ainda não têm grafo
// implementado (fluxos/<nome>/graph.ts, registro em fluxosPorId). Até a
// issue #26, isso era um array hardcoded em fluxos/catalogo.ts — agora mora
// nesta tabela, editável sem deploy.
//
// Pra "ativar" um fluxo planejado (implementar de verdade): ANTES de
// codar, consulte `perguntas`/`assuntos_verde` (shared/perguntasDb.ts,
// issue #20) pelo `id` desta linha — a árvore de perguntas e os documentos
// necessários já foram coletados do Verde, evita redescobrir isso na mão.
// Depois de implementar fluxos/<nome>/{graph,state,api}.ts normal e
// registrar em fluxosPorId (fluxos/index.ts), REMOVA a linha correspondente
// desta tabela (senão fica duplicado nos dois catálogos).
export interface FluxoPlanejado {
  id: string;
  nome: string;
  descricao: string;
  // idCategoriaAssunto do Verde (GET /integra/assunto/categorias, issue
  // #19) que essa entrada representa.
  idCategoriaAssuntoVerde: number;
  // Palavras-chave curadas do Verde por categoria — combinadas com
  // descricao em textoParaClassificacao, ajudam a IA/embedding a bater com
  // o jeito coloquial que a pessoa relata.
  palavrasChave: string[];
}

// Combina descricao + palavrasChave num texto só, pro que a IA de
// classificação/embedding realmente lê (ia/classificarFluxos.ts,
// shared/embeddingsFluxos.ts).
export function textoParaClassificacao(f: FluxoPlanejado): string {
  if (f.palavrasChave.length === 0) return f.descricao;
  return `${f.descricao} Palavras-chave: ${f.palavrasChave.join(", ")}.`;
}

export interface FluxosPlanejadosStore {
  listar(): Promise<FluxoPlanejado[]>;
  buscarPorId(id: string): Promise<FluxoPlanejado | undefined>;
}

interface StoreDeTeste extends FluxosPlanejadosStore {
  adicionarDeTeste(f: FluxoPlanejado): void;
  removerDeTeste(id: string): void;
}

function ehStoreDeTeste(s: FluxosPlanejadosStore): s is StoreDeTeste {
  return typeof (s as Partial<StoreDeTeste>).adicionarDeTeste === "function";
}

// Sem DATABASE_URL (testes, que não carregam .env) cai pra um array em
// memória — mesmo padrão de criarStoreEmMemoria() (shared/atendimentosDb.ts).
// Testes usam adicionarPlanejadoDeTeste/removerPlanejadoDeTeste (abaixo) em
// vez de mutar array de código direto (antigo fluxosPlanejados.push/pop).
function criarStoreEmMemoria(): StoreDeTeste {
  const lista: FluxoPlanejado[] = [];
  return {
    async listar() {
      return [...lista];
    },
    async buscarPorId(id) {
      return lista.find((f) => f.id === id);
    },
    adicionarDeTeste(f) {
      lista.push(f);
    },
    removerDeTeste(id) {
      const i = lista.findIndex((f) => f.id === id);
      if (i >= 0) lista.splice(i, 1);
    },
  };
}

function criarStorePostgres(url: string): FluxosPlanejadosStore {
  const pool = new Pool({ connectionString: url });
  const prontoPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fluxos_planejados (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        descricao TEXT NOT NULL,
        id_categoria_assunto_verde INTEGER NOT NULL,
        palavras_chave TEXT[] NOT NULL DEFAULT '{}'
      )
    `);
    logger.info("[fluxosPlanejadosDb] tabela 'fluxos_planejados' pronta (Postgres)");
  })();

  type Linha = { id: string; nome: string; descricao: string; id_categoria_assunto_verde: number; palavras_chave: string[] };
  const paraFluxo = (r: Linha): FluxoPlanejado => ({
    id: r.id,
    nome: r.nome,
    descricao: r.descricao,
    idCategoriaAssuntoVerde: r.id_categoria_assunto_verde,
    palavrasChave: r.palavras_chave,
  });

  return {
    async listar() {
      await prontoPromise;
      const res = await pool.query<Linha>(`SELECT id, nome, descricao, id_categoria_assunto_verde, palavras_chave FROM fluxos_planejados ORDER BY id`);
      return res.rows.map(paraFluxo);
    },
    async buscarPorId(id) {
      await prontoPromise;
      const res = await pool.query<Linha>(
        `SELECT id, nome, descricao, id_categoria_assunto_verde, palavras_chave FROM fluxos_planejados WHERE id = $1`,
        [id]
      );
      return res.rows[0] ? paraFluxo(res.rows[0]) : undefined;
    },
  };
}

// Memoizado a nível de módulo — mesmo racional de criarCheckpointer()
// (shared/checkpointer.ts) e obterAtendimentosStore() (shared/atendimentosDb.ts).
let storePromise: Promise<FluxosPlanejadosStore> | undefined;

function obterStore(): Promise<FluxosPlanejadosStore> {
  if (!storePromise) {
    const url = process.env.DATABASE_URL;
    storePromise = Promise.resolve(url ? criarStorePostgres(url) : criarStoreEmMemoria());
  }
  return storePromise;
}

export async function listarFluxosPlanejados(): Promise<FluxoPlanejado[]> {
  const store = await obterStore();
  return store.listar();
}

export async function buscarFluxoPlanejadoPorId(id: string): Promise<FluxoPlanejado | undefined> {
  const store = await obterStore();
  return store.buscarPorId(id);
}

// Só funciona sem DATABASE_URL (mesmo padrão de teste dos outros stores) —
// insere/remove um fluxo planejado em memória, pra testes que precisam
// simular um planejado sem editar dado de produção.
export async function adicionarPlanejadoDeTeste(f: FluxoPlanejado): Promise<void> {
  const store = await obterStore();
  if (!ehStoreDeTeste(store)) throw new Error("adicionarPlanejadoDeTeste só funciona sem DATABASE_URL");
  store.adicionarDeTeste(f);
}

export async function removerPlanejadoDeTeste(id: string): Promise<void> {
  const store = await obterStore();
  if (!ehStoreDeTeste(store)) throw new Error("removerPlanejadoDeTeste só funciona sem DATABASE_URL");
  store.removerDeTeste(id);
}
