import { interrupt, StateGraph, START, END } from "@langchain/langgraph";
import { type OrquestradorStateType, OrquestradorState, type CandidatoOrquestrador } from "./state.js";
import type { Pergunta } from "../shared/types.js";
import { buscarCandidatos } from "../shared/embeddingsFluxos.js";
import { classificarFluxosPlausiveis } from "../ia/classificarFluxos.js";
import { gerarPerguntaDesambiguacao } from "../ia/desambiguar.js";
import { sumarizarRelato } from "../ia/sumarizar.js";
import { criarCheckpointer } from "../shared/checkpointer.js";
import { catalogoParaClassificacao } from "../fluxos/index.js";
import { obterPerguntasStore, type PerguntaArvore } from "../shared/perguntasDb.js";

// Mesmo valor de antes da issue #28 (era CANDIDATOS_MAXIMOS em
// rotas/orquestrador.ts) — quantos candidatos entram no prompt de
// classificação/retrieval na 1ª rodada.
const CANDIDATOS_MAXIMOS = 10;

// Quantas rodadas de desambiguação no máximo antes de desistir e cair pra
// "não identificado" (handoff_humano) — evita loop infinito se o relato
// continuar ambíguo mesmo depois de perguntar. Subido de 3 pra 5 (issue
// #43, 2026-09-14) — com 76 categorias no catálogo (vs. 2 quando 3 foi
// escolhido, issue #28), relatos ambíguos entre categorias parecidas
// levam mais idas e vindas pra convergir; achado ao vivo um caso real
// batendo exatamente no limite de 3.
const LIMITE_RODADAS = 5;

// Issue #47 — a partir desta rodada (inclusive), classificar/prepararPerguntaDesambiguacao
// usam resumo + última resposta em vez do histórico bruto inteiro
// (`mensagem`, que só cresce a cada rodada). Sugestão da própria issue.
const LIMITE_RODADAS_SUMARIZACAO = 3;

// Texto efetivo pra mandar pra classificação/desambiguação: enquanto não
// sumarizou ainda (resumoRelato undefined), é o histórico bruto completo
// (comportamento de sempre). Depois de sumarizar, é resumo (do que veio
// ANTES) + última resposta (verbatim) — bem menor que o bruto acumulado,
// sem perder o que acabou de ser dito.
function textoParaClassificacao(state: OrquestradorStateType): string {
  if (state.resumoRelato === undefined) return state.mensagem;
  return `${state.resumoRelato}\n${state.ultimaResposta ?? ""}`;
}

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
  const { ids, tokensTotal } = await classificarFluxosPlausiveis(textoParaClassificacao(state), pool);
  const porId = new Map(catalogoCompleto.map((c) => [c.id, c]));
  const plausiveis = ids.map((id) => porId.get(id)).filter((c): c is CandidatoOrquestrador => c !== undefined);
  // Sempre 1º nó da rodada — sobrescreve (não soma) de propósito, é o
  // início da contagem desta rodada (issue #34). tokensGastosTotalConversa
  // tem reducer de soma (issue #35) — aqui é só o DELTA desta chamada.
  return { candidatosRestantes: plausiveis, tokensGastosRodada: tokensTotal, tokensGastosTotalConversa: tokensTotal ?? 0 };
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

// Mesmo conjunto de respostas (texto, sem depender de ordem) — critério pra
// considerar 2 perguntas raiz do Verde como "a mesma pergunta de verdade",
// não só coincidência de texto (issue #32).
function mesmoConjuntoDeOpcoes(a: PerguntaArvore["opcoes"], b: PerguntaArvore["opcoes"]): boolean {
  if (a.length !== b.length) return false;
  const textosA = a.map((o) => o.resposta.trim().toUpperCase()).sort();
  const textosB = b.map((o) => o.resposta.trim().toUpperCase()).sort();
  return textosA.every((t, i) => t === textosB[i]);
}

// Issue #32: quando TODOS os candidatos restantes compartilham literalmente
// a mesma pergunta raiz do Verde (mesmo texto + mesmas opções), usa esse
// texto real em vez de gerar uma pergunta genérica por IA. Achado rodando o
// crawl da #20 contra os 71 fluxos planejados: só ~3 grupos de categorias
// compartilham pergunta raiz (ex: "O ATENDIMENTO É PARA:" em 16 categorias)
// — a maioria não tem par, cai no fallback de IA normalmente, é esperado.
// Só olha `ordem = 0` (raiz) de propósito — descer mais na árvore fica pra
// depois, cobre só o caso mais simples/comum por ora.
async function buscarPerguntaRealCompartilhada(candidatos: CandidatoOrquestrador[]): Promise<string | undefined> {
  if (candidatos.length < 2) return undefined;
  const store = await obterPerguntasStore();
  const raizes = await Promise.all(candidatos.map((c) => store.buscarPerguntaRaiz(c.id)));
  const primeira = raizes[0];
  if (!primeira) return undefined;
  const todasIguais = raizes.every(
    (r) => r !== undefined && r.textoPergunta === primeira.textoPergunta && mesmoConjuntoDeOpcoes(r.opcoes, primeira.opcoes)
  );
  return todasIguais ? primeira.textoPergunta : undefined;
}

// undefined + undefined = undefined (nenhuma chamada real aconteceu, não é
// "custou 0" — é "não sei") — só soma de verdade quando pelo menos 1 dos 2
// lados teve chamada de IA de fato (issue #34).
function somarTokens(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

async function prepararPerguntaDesambiguacao(state: OrquestradorStateType): Promise<Partial<OrquestradorStateType>> {
  const candidatos = state.candidatosRestantes ?? [];
  const perguntaDoBanco = await buscarPerguntaRealCompartilhada(candidatos);
  // Match no banco não gasta token nenhum (não chama IA) — tokensGastosRodada
  // não entra no retorno, mantém o que "classificar" já escreveu.
  if (perguntaDoBanco) return { perguntaAtualTexto: perguntaDoBanco };
  const { pergunta, tokensTotal } = await gerarPerguntaDesambiguacao(textoParaClassificacao(state), candidatos);
  return {
    perguntaAtualTexto: pergunta,
    tokensGastosRodada: somarTokens(state.tokensGastosRodada, tokensTotal),
    tokensGastosTotalConversa: tokensTotal ?? 0,
  };
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
  const novaRodada = (state.rodada ?? 0) + 1;
  // candidatosRestantes NÃO é tocado aqui de propósito — próxima rodada de
  // "classificar" reaproveita o mesmo subconjunto, só com a mensagem maior.
  // mensagem bruto continua acumulando SEMPRE (registro/auditoria completo,
  // issue #47) — quem decide o que vai pra classificação é textoParaClassificacao,
  // não este campo. Código roda depois do interrupt() resolver, seguro
  // chamar IA aqui (só o código ANTES do interrupt reexecuta em resume).
  const mensagem = `${state.mensagem}\n${resposta}`;
  if (novaRodada < LIMITE_RODADAS_SUMARIZACAO) {
    return { mensagem, rodada: novaRodada };
  }
  // A partir do limite: sumariza tudo que veio ANTES desta resposta (resumo
  // anterior + última resposta da rodada passada, ou o bruto se essa é a
  // 1ª vez cruzando o limite) — a resposta ATUAL fica de fora do resumo,
  // guardada verbatim em ultimaResposta.
  const { resumo, tokensTotal } = await sumarizarRelato(textoParaClassificacao(state));
  return {
    mensagem,
    resumoRelato: resumo,
    ultimaResposta: resposta,
    rodada: novaRodada,
    tokensGastosRodada: somarTokens(state.tokensGastosRodada, tokensTotal),
    tokensGastosTotalConversa: tokensTotal ?? 0,
  };
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
