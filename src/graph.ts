import { interrupt, StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { type PessoaPresaStateType, type Pergunta, PessoaPresaState } from "./state.js";
import { consultarApenadoPorRg } from "./verde.js";
import { reescreverPergunta } from "./reescrever.js";

// Sem DATABASE_URL (ex: rodando os testes, que não carregam .env) cai pro
// MemorySaver — checkpoint em memória, morre com o processo, mas mantém os
// testes rápidos/isolados sem precisar de Postgres no ar. Com DATABASE_URL
// (server.ts real), persiste de verdade — sobrevive a reinício/deploy.
async function criarCheckpointer(): Promise<BaseCheckpointSaver> {
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

// Todas as 6 perguntas seguem o MESMO padrão de 2 nós: um "preparar" (chama
// a IA, roda 1x, escreve o texto pronto em perguntaAtual*) e um "pedir" (só
// lê o que já foi escrito e pausa em interrupt()).
//
// Por quê 2 nós, não 1: código ANTES de interrupt() no MESMO nó roda de novo
// toda vez que aquela pausa é retomada (gotcha real do LangGraph — "resume"
// replay o nó do início; interrupt() só para de pausar depois de já ter
// devolvido o valor uma vez). Se a chamada à IA tivesse dentro do nó que
// pausa, ela rodaria de novo (gastando Bedrock à toa) em toda resposta.
//
// Os campos perguntaAtualTexto/ViaIA/TokensTotal são COMPARTILHADOS entre
// as 6 perguntas (não 1 campo por pergunta) — só uma fica pendente por vez,
// o valor é sempre "a reescrita da pergunta que está prestes a pausar agora".
async function prepararPergunta(campo: string, textoBase: string): Promise<Partial<PessoaPresaStateType>> {
  const { texto, viaIA, tokensTotal } = await reescreverPergunta(campo, textoBase);
  return { perguntaAtualTexto: texto, perguntaAtualViaIA: viaIA, perguntaAtualTokensTotal: tokensTotal };
}

async function prepararPerguntaTemProcesso(): Promise<Partial<PessoaPresaStateType>> {
  return prepararPergunta("temProcesso", "Você tem o número do processo da pessoa que está presa?");
}

async function pedirTemProcesso(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  // resume:boolean quebra no LangGraph quando o valor é `false` (bug real:
  // graph.invoke() trata resume falsy como "nenhum resume" — Command({resume:
  // false}) explode com "Received empty Command input"). Resume como string
  // "true"/"false" (a Tykhe manda literal isso, não texto em português).
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? "Você tem o número do processo da pessoa que está presa?",
    tipo: "sim_nao",
    opcoes: ["Sim", "Não"],
  });
  return { temProcesso: resposta === "true" };
}

async function prepararPerguntaNumeroProcesso(): Promise<Partial<PessoaPresaStateType>> {
  return prepararPergunta("numeroProcesso", "Qual o número do processo? Informe apenas os números.");
}

async function pedirNumeroProcesso(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? "Qual o número do processo? Informe apenas os números.",
    tipo: "texto",
  });
  return { numeroProcesso: resposta };
}

async function prepararPerguntaRg(): Promise<Partial<PessoaPresaStateType>> {
  return prepararPergunta("rg", "Qual o RG da pessoa presa? Informe apenas os números.");
}

async function pedirRg(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? "Qual o RG da pessoa presa? Informe apenas os números.",
    tipo: "texto",
  });
  return { rg: resposta };
}

function depoisDeTemProcesso(state: PessoaPresaStateType): "pedirNumeroProcesso" | "pedirRg" {
  return state.temProcesso ? "pedirNumeroProcesso" : "pedirRg";
}

async function consultarApenado(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  const dados = await consultarApenadoPorRg(state.rg ?? "");
  return { dadosApenado: dados, tentativasRg: (state.tentativasRg ?? 0) + 1 };
}

// 3 tentativas de RG no total. Não encontrado com tentativa < 3: pergunta se
// quer tentar de novo (perguntaTentarNovamente). Na 3ª falha, esgotou —
// direto pro atendente, sem perguntar de novo (não sobra tentativa).
function depoisDeConsultarApenado(state: PessoaPresaStateType): "pedirConfirmaNome" | "perguntaTentarNovamente" | "naoConfirmado" {
  if (state.dadosApenado?.encontrado) return "pedirConfirmaNome";
  if ((state.tentativasRg ?? 0) >= 3) return "naoConfirmado";
  return "perguntaTentarNovamente";
}

async function prepararPerguntaTentarNovamente(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  return prepararPergunta(
    "tentarNovamenteRg",
    `Não encontrei ninguém com esse RG (tentativa ${state.tentativasRg ?? 1} de 3). Quer tentar de novo?`
  );
}

async function perguntaTentarNovamente(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta:
      state.perguntaAtualTexto ??
      `Não encontrei ninguém com esse RG (tentativa ${state.tentativasRg ?? 1} de 3). Quer tentar de novo?`,
    tipo: "sim_nao",
    opcoes: ["Sim", "Não"],
  });
  return { querTentarNovamente: resposta === "true" };
}

function depoisDePerguntaTentar(state: PessoaPresaStateType): "pedirRg" | "naoConfirmado" {
  return state.querTentarNovamente ? "pedirRg" : "naoConfirmado";
}

async function prepararPerguntaConfirmaNome(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  const nome = state.dadosApenado?.nome ?? "essa pessoa";
  return prepararPergunta("confirmaNome", `Confirma que a pessoa presa é ${nome}?`);
}

async function pedirConfirmaNome(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  const nome = state.dadosApenado?.nome ?? "essa pessoa";
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? `Confirma que a pessoa presa é ${nome}?`,
    tipo: "sim_nao",
    opcoes: ["Sim", "Não"],
  });
  return { confirmaNome: resposta === "true" };
}

async function prepararPerguntaParentesco(): Promise<Partial<PessoaPresaStateType>> {
  return prepararPergunta("parentesco", "Qual seu parentesco com a pessoa presa?");
}

export async function pedirParentesco(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? "Qual seu parentesco com a pessoa presa?",
    tipo: "texto",
  });
  return { parentesco: resposta };
}

async function concluir(): Promise<Partial<PessoaPresaStateType>> {
  return { statusFinal: "concluido" };
}

// naoConfirmado é o dead-end compartilhado por 2 caminhos diferentes:
// esgotou as 3 tentativas de RG (dadosApenado nunca encontrado) ou achou a
// pessoa mas não confirmou o nome. O motivo não vem por parâmetro (LangGraph
// não passa argumento extra pro nó, só o state) — dá pra deduzir olhando o
// que já está no estado: se NÃO achou ninguém, é falta de RG; se achou mas
// confirmaNome é false, é nome não confirmado.
async function naoConfirmado(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  const motivoHandoff = state.dadosApenado?.encontrado ? "nome_nao_confirmado" : "rg_nao_encontrado";
  return { statusFinal: "handoff_humano", motivoHandoff };
}

function depoisDeConfirmarNome(state: PessoaPresaStateType): "concluir" | "naoConfirmado" {
  return state.confirmaNome ? "concluir" : "naoConfirmado";
}

const grafo = new StateGraph(PessoaPresaState)
  .addNode("prepararPerguntaTemProcesso", prepararPerguntaTemProcesso)
  .addNode("pedirTemProcesso", pedirTemProcesso)
  .addNode("prepararPerguntaNumeroProcesso", prepararPerguntaNumeroProcesso)
  .addNode("pedirNumeroProcesso", pedirNumeroProcesso)
  .addNode("prepararPerguntaRg", prepararPerguntaRg)
  .addNode("pedirRg", pedirRg)
  .addNode("consultarApenado", consultarApenado)
  .addNode("prepararPerguntaTentarNovamente", prepararPerguntaTentarNovamente)
  .addNode("perguntaTentarNovamente", perguntaTentarNovamente)
  .addNode("prepararPerguntaConfirmaNome", prepararPerguntaConfirmaNome)
  .addNode("pedirConfirmaNome", pedirConfirmaNome)
  .addNode("prepararPerguntaParentesco", prepararPerguntaParentesco)
  .addNode("pedirParentesco", pedirParentesco)
  .addNode("concluir", concluir)
  .addNode("naoConfirmado", naoConfirmado)
  .addEdge(START, "prepararPerguntaTemProcesso")
  .addEdge("prepararPerguntaTemProcesso", "pedirTemProcesso")
  .addConditionalEdges("pedirTemProcesso", depoisDeTemProcesso, {
    pedirNumeroProcesso: "prepararPerguntaNumeroProcesso",
    pedirRg: "prepararPerguntaRg",
  })
  .addEdge("prepararPerguntaNumeroProcesso", "pedirNumeroProcesso")
  .addEdge("pedirNumeroProcesso", "prepararPerguntaRg")
  .addEdge("prepararPerguntaRg", "pedirRg")
  .addEdge("pedirRg", "consultarApenado")
  .addConditionalEdges("consultarApenado", depoisDeConsultarApenado, {
    pedirConfirmaNome: "prepararPerguntaConfirmaNome",
    perguntaTentarNovamente: "prepararPerguntaTentarNovamente",
    naoConfirmado: "naoConfirmado",
  })
  .addEdge("prepararPerguntaTentarNovamente", "perguntaTentarNovamente")
  .addConditionalEdges("perguntaTentarNovamente", depoisDePerguntaTentar, {
    pedirRg: "prepararPerguntaRg",
    naoConfirmado: "naoConfirmado",
  })
  .addEdge("prepararPerguntaConfirmaNome", "pedirConfirmaNome")
  .addConditionalEdges("pedirConfirmaNome", depoisDeConfirmarNome, {
    concluir: "prepararPerguntaParentesco",
    naoConfirmado: "naoConfirmado",
  })
  .addEdge("prepararPerguntaParentesco", "pedirParentesco")
  .addEdge("pedirParentesco", "concluir")
  .addEdge("naoConfirmado", END)
  .addEdge("concluir", END)
  .compile({ checkpointer: await criarCheckpointer() });

export { grafo };
