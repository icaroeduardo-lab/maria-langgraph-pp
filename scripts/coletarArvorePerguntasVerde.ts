// Script de coleta (issue #20) — roda sob demanda (não em request), varre a
// árvore de perguntas do Verde (GET /integra/assunto/consultar-item-arvore)
// categoria por categoria até achar os "assuntos" finais
// (GET /integra/assunto/{idAssunto}), salvando tudo em `perguntas` +
// `assuntos_verde` (shared/perguntasDb.ts). Não incremental — recrawleia
// (limpa e reinsere) cada flowId visitado, a árvore pode mudar de forma
// entre uma rodada e outra. Uso: npm run coletar:arvore-perguntas-verde
// (precisa DATABASE_URL + VERDE_JWT_TOKEN/VERDE_CLIENT_ID reais no .env —
// sem modo mock, é um script de coleta de dado real, não faz sentido rodar
// contra dado inventado).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { fluxosPorId, ID_VIOLENCIA_DOMESTICA } from "../src/fluxos/index.js";
import { listarFluxosPlanejados } from "../src/shared/fluxosPlanejadosDb.js";
import { obterPerguntasStore, type PerguntaArvore, type AssuntoVerde } from "../src/shared/perguntasDb.js";

const VERDE_API_URL = process.env.VERDE_API_URL ?? "https://homologacao.verde.rj.def.br/api/integra";
const VERDE_JWT_TOKEN = process.env.VERDE_JWT_TOKEN ?? "";
const VERDE_CLIENT_ID = process.env.VERDE_CLIENT_ID ?? "";

// Guarda contra árvore mal-formada/loop infinito — nenhuma árvore real do
// Verde deveria chegar nem perto disso (violência doméstica tem profundidade
// 1, ver PR desta issue).
const PROFUNDIDADE_MAXIMA = 12;
const PAUSA_ENTRE_CHAMADAS_MS = 120;

interface DadosArvore {
  pergunta?: string;
  respostas?: Array<{ id: number; resposta: string }>;
  assuntoEncontrado: boolean;
  idAssunto?: number;
  nomeAssunto?: string;
}

interface DadosAssunto {
  nome?: string;
  nomeMateria?: string;
  descricao?: string;
  txDocumentosNecessarios?: string;
  documentosNecessarios?: Array<{ id: number; nomeDocumento: string; basico: boolean }>;
  urgente?: boolean;
  plantao?: boolean;
}

function pausa(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headersVerde(): HeadersInit {
  return { accept: "application/json", authorization: `Bearer ${VERDE_JWT_TOKEN}`, "x-client-id": VERDE_CLIENT_ID };
}

async function consultarItemArvore(params: { idCategoria?: number; idItemCategoria?: number }): Promise<DadosArvore> {
  const query = params.idCategoria !== undefined ? `idCategoria=${params.idCategoria}` : `idItemCategoria=${params.idItemCategoria}`;
  const res = await fetch(`${VERDE_API_URL}/assunto/consultar-item-arvore?${query}`, { headers: headersVerde(), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`consultar-item-arvore HTTP ${res.status} (${JSON.stringify(params)})`);
  const corpo = (await res.json()) as { dados?: DadosArvore };
  if (!corpo.dados) throw new Error(`consultar-item-arvore sem 'dados' (${JSON.stringify(params)})`);
  return corpo.dados;
}

async function consultarAssunto(idAssunto: number): Promise<DadosAssunto> {
  const res = await fetch(`${VERDE_API_URL}/assunto/${idAssunto}`, { headers: headersVerde(), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`GET /assunto/${idAssunto} HTTP ${res.status}`);
  const corpo = (await res.json()) as { dados?: DadosAssunto };
  if (!corpo.dados) throw new Error(`GET /assunto/${idAssunto} sem 'dados'`);
  return corpo.dados;
}

// "SIM"/"NÃO" (2 respostas, nada mais) é sim_nao; qualquer outra coisa
// (3+ opções, ou 2 opções que não são sim/não) é opcoes.
function tipoDaPergunta(respostas: Array<{ id: number; resposta: string }>): "sim_nao" | "opcoes" {
  const normalizadas = respostas.map((r) => r.resposta.trim().toUpperCase());
  const ehSimNao = normalizadas.length === 2 && normalizadas.includes("SIM") && normalizadas.includes("NÃO");
  return ehSimNao ? "sim_nao" : "opcoes";
}

async function crawlearFlow(flowId: string, idCategoriaAssuntoVerde: number, nome: string): Promise<{ perguntas: number; assuntos: number }> {
  const store = await obterPerguntasStore();
  await store.limparFlow(flowId);

  let ordem = 0;
  let totalPerguntas = 0;
  let totalAssuntos = 0;

  async function visitar(params: { idCategoria?: number; idItemCategoria?: number }, veioDaRespostaId: number | null, profundidade: number): Promise<void> {
    if (profundidade > PROFUNDIDADE_MAXIMA) throw new Error(`profundidade máxima (${PROFUNDIDADE_MAXIMA}) excedida em "${nome}" — árvore maior que o esperado ou loop`);
    await pausa(PAUSA_ENTRE_CHAMADAS_MS);
    const dados = await consultarItemArvore(params);

    if (dados.assuntoEncontrado) {
      const idAssunto = dados.idAssunto;
      if (idAssunto === undefined) throw new Error(`assuntoEncontrado sem idAssunto em "${nome}"`);
      await pausa(PAUSA_ENTRE_CHAMADAS_MS);
      const detalhe = await consultarAssunto(idAssunto);
      const assunto: AssuntoVerde = {
        idAssunto,
        nome: detalhe.nome ?? dados.nomeAssunto ?? "",
        nomeMateria: detalhe.nomeMateria,
        descricao: detalhe.descricao,
        txDocumentosNecessarios: detalhe.txDocumentosNecessarios,
        documentosNecessarios: detalhe.documentosNecessarios ?? [],
        urgente: detalhe.urgente ?? false,
        plantao: detalhe.plantao ?? false,
      };
      // Detalhe do assunto é upsert por idAssunto (compartilhado entre
      // categorias — ver comentário em perguntasDb.ts); a ligação
      // flow→assunto é sempre uma linha NOVA, mesmo quando o idAssunto já
      // existia de outra categoria.
      await store.inserirAssunto(assunto);
      await store.inserirFlowAssunto({ id: randomUUID(), flowId, idAssunto, veioDaRespostaId });
      totalAssuntos += 1;
      return;
    }

    const pergunta = dados.pergunta;
    const respostas = dados.respostas ?? [];
    if (!pergunta) throw new Error(`nó sem pergunta e sem assuntoEncontrado em "${nome}" (${JSON.stringify(params)})`);

    // Achado ao vivo 2026-09-11: alguns nós do Verde têm `pergunta` (na
    // real, um AVISO/mensagem final, não uma pergunta de verdade) com
    // `respostas: []` e `assuntoEncontrado: false` — dado inconsistente do
    // Verde mesmo (não é erro de parsing nosso), um beco-sem-saída que não
    // é marcado como assunto. Registra como nó informativo (tipo "texto",
    // sem opções) e não desce mais — sem isso o crawl inteiro da categoria
    // abortava por causa de 1 nó sem saída.
    const linha: PerguntaArvore = {
      id: randomUUID(),
      flowId,
      idItemCategoria: params.idItemCategoria ?? null,
      veioDaRespostaId,
      textoPergunta: pergunta,
      tipo: respostas.length === 0 ? "texto" : tipoDaPergunta(respostas),
      opcoes: respostas,
      ordem: ordem++,
    };
    await store.inserirPergunta(linha);
    totalPerguntas += 1;

    for (const resposta of respostas) {
      await visitar({ idItemCategoria: resposta.id }, resposta.id, profundidade + 1);
    }
  }

  await visitar({ idCategoria: idCategoriaAssuntoVerde }, null, 0);
  console.log(`[${nome}] ${totalPerguntas} pergunta(s), ${totalAssuntos} assunto(s)`);
  return { perguntas: totalPerguntas, assuntos: totalAssuntos };
}

async function main(): Promise<void> {
  if (!VERDE_JWT_TOKEN) throw new Error("VERDE_JWT_TOKEN obrigatório — este script fala com o Verde de verdade, sem modo mock");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL obrigatório — sem isso o resultado do crawl não fica salvo em lugar nenhum");

  const alvos: Array<{ flowId: string; idCategoriaAssuntoVerde: number; nome: string }> = [];

  // Único fluxo IMPLEMENTADO com categoria Verde equivalente — pessoa presa
  // não entra aqui, não existe categoria Verde pra ela (ver
  // fluxos/index.ts, idCategoriaAssuntoVerde ausente).
  const vd = fluxosPorId[ID_VIOLENCIA_DOMESTICA];
  if (vd?.idCategoriaAssuntoVerde !== undefined) alvos.push({ flowId: ID_VIOLENCIA_DOMESTICA, idCategoriaAssuntoVerde: vd.idCategoriaAssuntoVerde, nome: vd.nome });

  const planejados = await listarFluxosPlanejados();
  for (const f of planejados) alvos.push({ flowId: f.id, idCategoriaAssuntoVerde: f.idCategoriaAssuntoVerde, nome: f.nome });

  console.log(`crawl iniciado — ${alvos.length} categorias`);
  let totalPerguntas = 0;
  let totalAssuntos = 0;
  const falhas: Array<{ nome: string; erro: string }> = [];

  for (const alvo of alvos) {
    try {
      const resultado = await crawlearFlow(alvo.flowId, alvo.idCategoriaAssuntoVerde, alvo.nome);
      totalPerguntas += resultado.perguntas;
      totalAssuntos += resultado.assuntos;
    } catch (err) {
      const erro = err instanceof Error ? err.message : String(err);
      console.error(`[${alvo.nome}] falhou: ${erro}`);
      falhas.push({ nome: alvo.nome, erro });
    }
  }

  console.log(`crawl concluído: ${totalPerguntas} pergunta(s), ${totalAssuntos} assunto(s), ${falhas.length} falha(s) em ${alvos.length} categorias`);
  if (falhas.length > 0) {
    console.log("categorias com falha (revisar manualmente — pode ser categoria sem árvore no Verde):", falhas.map((f) => f.nome).join(", "));
  }
}

main().catch((erro) => {
  console.error("crawl falhou:", erro);
  process.exit(1);
});
