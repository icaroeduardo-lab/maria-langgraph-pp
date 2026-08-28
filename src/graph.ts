import { interrupt, StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { type PessoaPresaStateType, type Pergunta, PessoaPresaState } from "./state.js";
import { consultarApenadoPorRg } from "./verde.js";

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


export async function pedirParentesco(): Promise<Partial<PessoaPresaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta: "Qual seu parentesco com a pessoa presa?",
    tipo: "texto",
  });
  return { parentesco: resposta };
}

async function pedirTemProcesso(): Promise<Partial<PessoaPresaStateType>> {
  // resume:boolean quebra no LangGraph quando o valor é `false` (bug real:
  // graph.invoke() trata resume falsy como "nenhum resume" — Command({resume:
  // false}) explode com "Received empty Command input"). Resume como string
  // "true"/"false" (a Tykhe manda literal isso, não texto em português).
  const resposta = interrupt<Pergunta, string>({
    pergunta: "Você tem o número do processo da pessoa que está presa?",
    tipo: "sim_nao",
    opcoes: ["Sim", "Não"],
  });
  return { temProcesso: resposta === "true" };
}

async function pedirNumeroProcesso(): Promise<Partial<PessoaPresaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta: "Qual o número do processo? Informe apenas os números.",
    tipo: "texto",
  });
  return { numeroProcesso: resposta };
}

async function pedirRg(): Promise<Partial<PessoaPresaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta: "Qual o RG da pessoa presa? Informe apenas os números.",
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

async function perguntaTentarNovamente(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta: `Não encontrei ninguém com esse RG (tentativa ${state.tentativasRg ?? 1} de 3). Quer tentar de novo?`,
    tipo: "sim_nao",
    opcoes: ["Sim", "Não"],
  });
  return { querTentarNovamente: resposta === "true" };
}

function depoisDePerguntaTentar(state: PessoaPresaStateType): "pedirRg" | "naoConfirmado" {
  return state.querTentarNovamente ? "pedirRg" : "naoConfirmado";
}

async function pedirConfirmaNome(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  const nome = state.dadosApenado?.nome ?? "essa pessoa";
  const resposta = interrupt<Pergunta, string>({
    pergunta: `Confirma que a pessoa presa é ${nome}?`,
    tipo: "sim_nao",
    opcoes: ["Sim", "Não"],
  });
  return { confirmaNome: resposta === "true" };
}

async function concluir(): Promise<Partial<PessoaPresaStateType>> {
  return { statusFinal: "concluido" };
}

async function naoConfirmado(): Promise<Partial<PessoaPresaStateType>> {
  return { statusFinal: "handoff_humano" };
}

function depoisDeConfirmarNome(state: PessoaPresaStateType): "concluir" | "naoConfirmado" {
  return state.confirmaNome ? "concluir" : "naoConfirmado";
}

const grafo = new StateGraph(PessoaPresaState)
  .addNode("pedirParentesco", pedirParentesco)
  .addNode("pedirTemProcesso", pedirTemProcesso)
  .addNode("pedirNumeroProcesso", pedirNumeroProcesso)
  .addNode("pedirRg", pedirRg)
  .addNode("consultarApenado", consultarApenado)
  .addNode("perguntaTentarNovamente", perguntaTentarNovamente)
  .addNode("pedirConfirmaNome", pedirConfirmaNome)
  .addNode("concluir", concluir)
  .addNode("naoConfirmado", naoConfirmado)
  .addEdge(START, "pedirTemProcesso")
  .addConditionalEdges("pedirTemProcesso", depoisDeTemProcesso, {
    pedirNumeroProcesso: "pedirNumeroProcesso",
    pedirRg: "pedirRg",
  })
  .addEdge("pedirNumeroProcesso", "pedirRg")
  .addEdge("pedirRg", "consultarApenado")
  .addConditionalEdges("consultarApenado", depoisDeConsultarApenado, {
    pedirConfirmaNome: "pedirConfirmaNome",
    perguntaTentarNovamente: "perguntaTentarNovamente",
    naoConfirmado: "naoConfirmado",
  })
  .addConditionalEdges("perguntaTentarNovamente", depoisDePerguntaTentar, {
    pedirRg: "pedirRg",
    naoConfirmado: "naoConfirmado",
  })
  .addConditionalEdges("pedirConfirmaNome", depoisDeConfirmarNome, {
    concluir: "pedirParentesco",
    naoConfirmado: "naoConfirmado",
  })
  .addEdge("pedirParentesco", "concluir")
  .addEdge("naoConfirmado", END)
  .addEdge("concluir", END)
  .compile({ checkpointer: await criarCheckpointer() });

export { grafo };
