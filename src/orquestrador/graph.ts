import { interrupt, StateGraph, START, END } from "@langchain/langgraph";
import { type OrquestradorStateType, OrquestradorState, type CandidatoOrquestrador } from "./state.js";
import type { Pergunta } from "../shared/types.js";
import { buscarCandidatos } from "../shared/embeddingsFluxos.js";
import { classificarFluxosPlausiveis } from "../ia/classificarFluxos.js";
import { gerarPerguntaDesambiguacao } from "../ia/desambiguar.js";
import { criarCheckpointer } from "../shared/checkpointer.js";
import { catalogoParaClassificacao } from "../fluxos/index.js";

// Mesmo valor de antes da issue #28 (era CANDIDATOS_MAXIMOS em
// rotas/orquestrador.ts) — quantos candidatos entram no prompt de
// classificação/retrieval na 1ª rodada.
const CANDIDATOS_MAXIMOS = 10;

// Quantas rodadas de desambiguação no máximo antes de desistir e cair pra
// "não identificado" (handoff_humano) — evita loop infinito se o relato
// continuar ambíguo mesmo depois de perguntar.
const LIMITE_RODADAS = 3;

// 1ª rodada: busca no catálogo completo (retrieval, issue #8) e classifica.
// Rodadas seguintes: classifica de novo, mas só DENTRO do que já sobrou —
// nunca alarga de volta pro catálogo todo.
async function classificar(state: OrquestradorStateType): Promise<Partial<OrquestradorStateType>> {
  // Lookup contra o catálogo INTEIRO (não só o pool retornado pelo
  // retrieval) — em modo real, os ids que voltam de classificarFluxosPlausiveis
  // já são garantidos como subconjunto do pool (enum do schema restringe
  // isso); resolver contra o catálogo completo é só defensivo e não muda
  // nada nesse caminho. Importa mesmo pro modo de teste: o mock
  // (MOCK_CLASSIFICACAO_FLOWID/FLOWIDS) devolve um id fixo sem ligar pro
  // pool — se o filtro fosse feito só dentro do pool (que em teste vem de
  // embedding fake, sem significado semântico real), o id mockado podia
  // simplesmente não estar lá, quebrando o teste por sorte de hash.
  const catalogoCompleto = await catalogoParaClassificacao();
  const pool: CandidatoOrquestrador[] = state.candidatosRestantes ?? (await buscarCandidatos(state.mensagem, CANDIDATOS_MAXIMOS, catalogoCompleto));
  const { ids } = await classificarFluxosPlausiveis(state.mensagem, pool);
  const porId = new Map(catalogoCompleto.map((c) => [c.id, c]));
  const plausiveis = ids.map((id) => porId.get(id)).filter((c): c is CandidatoOrquestrador => c !== undefined);
  return { candidatosRestantes: plausiveis };
}

// Esgotar o limite de rodadas com >1 candidato ainda ambíguo vira "nenhum"
// (handoff_humano) — nunca fica perguntando pra sempre.
function depoisDeClassificar(state: OrquestradorStateType): "nenhum" | "um" | "muitos" {
  const n = state.candidatosRestantes?.length ?? 0;
  if (n === 0) return "nenhum";
  if (n === 1) return "um";
  if ((state.rodada ?? 0) >= LIMITE_RODADAS) return "nenhum";
  return "muitos";
}

async function identificado(state: OrquestradorStateType): Promise<Partial<OrquestradorStateType>> {
  return { statusFinal: "identificado", flowIdEscolhido: state.candidatosRestantes?.[0]?.id };
}

async function naoIdentificado(): Promise<Partial<OrquestradorStateType>> {
  return { statusFinal: "nao_identificado" };
}

async function prepararPerguntaDesambiguacao(state: OrquestradorStateType): Promise<Partial<OrquestradorStateType>> {
  const candidatos = state.candidatosRestantes ?? [];
  const { pergunta } = await gerarPerguntaDesambiguacao(state.mensagem, candidatos);
  return { perguntaAtualTexto: pergunta };
}

// tipo "texto" (não "opcoes") de propósito — decisão 2026-09-11: mostrar os
// nomes internos dos candidatos como menu de opção soava técnico/estranho
// pro usuário real (ver relato ao vivo). Deixa a pessoa responder com as
// próprias palavras — igual já funciona bem no resto do sistema (retrieval +
// keywords) — em vez de tentar advinhar rótulos naturais pra cada candidato.
async function pedirDesambiguacao(state: OrquestradorStateType): Promise<Partial<OrquestradorStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? "Pra te ajudar melhor, pode contar com mais detalhes o que você precisa?",
    tipo: "texto",
  });
  // candidatosRestantes NÃO é tocado aqui de propósito — próxima rodada de
  // "classificar" reaproveita o mesmo subconjunto, só com a mensagem maior.
  return { mensagem: `${state.mensagem}\n${resposta}`, rodada: (state.rodada ?? 0) + 1 };
}

const grafo = new StateGraph(OrquestradorState)
  .addNode("classificar", classificar)
  .addNode("identificado", identificado)
  .addNode("naoIdentificado", naoIdentificado)
  .addNode("prepararPerguntaDesambiguacao", prepararPerguntaDesambiguacao)
  .addNode("pedirDesambiguacao", pedirDesambiguacao)
  .addEdge(START, "classificar")
  .addConditionalEdges("classificar", depoisDeClassificar, {
    nenhum: "naoIdentificado",
    um: "identificado",
    muitos: "prepararPerguntaDesambiguacao",
  })
  .addEdge("prepararPerguntaDesambiguacao", "pedirDesambiguacao")
  .addEdge("pedirDesambiguacao", "classificar")
  .addEdge("identificado", END)
  .addEdge("naoIdentificado", END)
  .compile({ checkpointer: await criarCheckpointer() });

export { grafo };
