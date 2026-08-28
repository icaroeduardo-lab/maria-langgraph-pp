import { interrupt, StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { type PessoaPresaStateType, type Pergunta, PessoaPresaState } from "./state.js";
import { consultarApenadoPorRg } from "./verde.js";


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
  return { dadosApenado: dados };
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
  .addEdge("consultarApenado", "pedirConfirmaNome")
  .addConditionalEdges("pedirConfirmaNome", depoisDeConfirmarNome, {
    concluir: "pedirParentesco",
    naoConfirmado: "naoConfirmado",
  })
  .addEdge("pedirParentesco", "concluir")
  .addEdge("naoConfirmado", END)
  .addEdge("concluir", END)
  .compile({ checkpointer: new MemorySaver() });

export { grafo };
