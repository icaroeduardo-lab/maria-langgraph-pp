import { interrupt, StateGraph, START, END } from "@langchain/langgraph";
import { type ViolenciaDomesticaStateType, ViolenciaDomesticaState } from "./state.js";
import type { Pergunta } from "../../shared/types.js";
import { consultarPessoaPorCpf, consultarProcesso as consultarProcessoVerde } from "../../integracoes/verde.js";
import { prepararPergunta } from "../../ia/reescrever.js";
import { criarCheckpointer } from "../../shared/checkpointer.js";
import {
  MENSAGEM_DEFENSORIA_VITIMA_JUIZADO,
  MENSAGEM_NAO_VITIMA,
  MENSAGEM_NUDEM,
  MENSAGEM_URGENTE_JUIZADO,
} from "./api.js";

// Mesma tolerância de respostas sim_nao de fluxos/pessoaPresa/graph.ts — a
// Tykhe às vezes repassa "Sim"/"Não" literal em vez de "true"/"false" (bug
// real achado ao vivo 2026-08-31, ver respostaEhSim lá). Duplicado aqui (não
// extraído pra shared/) porque é pequeno e specific o bastante — mesmo
// racional de "repo pequeno não justifica abstração" usado em ia/extrair.ts.
function respostaEhSim(resposta: string): boolean {
  const normalizado = resposta
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  return normalizado === "true" || normalizado === "sim" || normalizado === "s" || normalizado === "yes";
}

// Compara município ignorando acento/maiúscula — mesma ideia de
// respostaEhSim, o Verde pode devolver "Rio de Janeiro", "RIO DE JANEIRO" etc.
function ehCapital(municipio: string | undefined): boolean {
  const normalizado = (municipio ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  return normalizado === "rio de janeiro";
}

// Gate de elegibilidade — primeira pergunta do fluxo (ver decisão de design:
// perguntar isso ANTES de processo, pra não gastar pergunta à toa quando a
// resposta for "não").
async function prepararPerguntaEhVitima(): Promise<Partial<ViolenciaDomesticaStateType>> {
  return prepararPergunta("ehVitima", "Você é a vítima de violência doméstica?");
}

async function pedirEhVitima(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? "Você é a vítima de violência doméstica?",
    tipo: "sim_nao",
    opcoes: ["Sim", "Não"],
  });
  return { ehVitima: respostaEhSim(resposta) };
}

function depoisDeEhVitima(state: ViolenciaDomesticaStateType): "temProcesso" | "naoEhVitima" {
  return state.ehVitima ? "temProcesso" : "naoEhVitima";
}

async function naoEhVitima(): Promise<Partial<ViolenciaDomesticaStateType>> {
  return { statusFinal: "handoff_humano", motivoHandoff: "nao_e_vitima", mensagemFinal: MENSAGEM_NAO_VITIMA };
}

// Só informativo — não muda o caminho do fluxo (decisão de design confirmada:
// mesmo padrão non-blocking de consultarProcesso em pessoaPresa/graph.ts).
async function prepararPerguntaTemProcesso(): Promise<Partial<ViolenciaDomesticaStateType>> {
  return prepararPergunta("temProcesso", "Existe algum processo relacionado ao seu caso?");
}

async function pedirTemProcesso(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? "Existe algum processo relacionado ao seu caso?",
    tipo: "sim_nao",
    opcoes: ["Sim", "Não"],
  });
  return { temProcesso: respostaEhSim(resposta) };
}

function depoisDeTemProcesso(state: ViolenciaDomesticaStateType): "pedirNumeroProcesso" | "pedirTemRO" {
  return state.temProcesso ? "pedirNumeroProcesso" : "pedirTemRO";
}

async function prepararPerguntaNumeroProcesso(): Promise<Partial<ViolenciaDomesticaStateType>> {
  return prepararPergunta("numeroProcesso", "Qual o número do processo? Informe apenas os números.");
}

async function pedirNumeroProcesso(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? "Qual o número do processo? Informe apenas os números.",
    tipo: "texto",
  });
  return { numeroProcesso: resposta };
}

async function consultarProcesso(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  const dados = await consultarProcessoVerde(state.numeroProcesso ?? "");
  return { dadosProcesso: dados };
}

async function prepararPerguntaTemRO(): Promise<Partial<ViolenciaDomesticaStateType>> {
  return prepararPergunta("temRegistroOcorrencia", "Você já registrou o Boletim de Ocorrência (RO) na delegacia?");
}

async function pedirTemRO(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? "Você já registrou o Boletim de Ocorrência (RO) na delegacia?",
    tipo: "sim_nao",
    opcoes: ["Sim", "Não"],
  });
  return { temRegistroOcorrencia: respostaEhSim(resposta) };
}

function depoisDeTemRO(state: ViolenciaDomesticaStateType): "urgente" | "pedirCpf" {
  return state.temRegistroOcorrencia ? "urgente" : "pedirCpf";
}

// Tem RO: urgente, encaminhamento imediato, sem agendamento — não precisa de
// CPF/município aqui (a resolução automática de qual Juizado, pelo Verde,
// fica de fora por enquanto — ver conversa de design, API de encaminhamento
// ainda não integrada).
async function urgente(): Promise<Partial<ViolenciaDomesticaStateType>> {
  return { statusFinal: "concluido", tipoEncaminhamento: "urgente_juizado", mensagemFinal: MENSAGEM_URGENTE_JUIZADO };
}

// cpf normalmente já vem em dadosConhecidos (ver rotas/atendimentos.ts) — só
// pergunta se por algum motivo não veio (Tykhe não mandou). Só é alcançado
// no ramo "sem RO" (precisa do município pra decidir capital x outras
// cidades) — mesmo padrão de bypass condicional de pessoaPresa/graph.ts.
async function prepararPerguntaCpf(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  if (state.cpf !== undefined) return {};
  return prepararPergunta("cpf", "Qual o seu CPF? Informe apenas os números.");
}

async function pedirCpf(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  if (state.cpf !== undefined) return {};
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? "Qual o seu CPF? Informe apenas os números.",
    tipo: "texto",
  });
  return { cpf: resposta };
}

async function consultarPessoa(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  const dados = await consultarPessoaPorCpf(state.cpf ?? "");
  return { dadosPessoa: dados };
}

function depoisDeConsultarPessoa(state: ViolenciaDomesticaStateType): "nudem" | "defensoriaVitimaJuizado" {
  return ehCapital(state.dadosPessoa?.enderecoDetalhado?.municipio) ? "nudem" : "defensoriaVitimaJuizado";
}

async function nudem(): Promise<Partial<ViolenciaDomesticaStateType>> {
  return { statusFinal: "concluido", tipoEncaminhamento: "nudem", mensagemFinal: MENSAGEM_NUDEM };
}

async function defensoriaVitimaJuizado(): Promise<Partial<ViolenciaDomesticaStateType>> {
  return {
    statusFinal: "concluido",
    tipoEncaminhamento: "defensoria_vitima_juizado",
    mensagemFinal: MENSAGEM_DEFENSORIA_VITIMA_JUIZADO,
  };
}

const grafo = new StateGraph(ViolenciaDomesticaState)
  .addNode("prepararPerguntaEhVitima", prepararPerguntaEhVitima)
  .addNode("pedirEhVitima", pedirEhVitima)
  .addNode("naoEhVitima", naoEhVitima)
  .addNode("prepararPerguntaTemProcesso", prepararPerguntaTemProcesso)
  .addNode("pedirTemProcesso", pedirTemProcesso)
  .addNode("prepararPerguntaNumeroProcesso", prepararPerguntaNumeroProcesso)
  .addNode("pedirNumeroProcesso", pedirNumeroProcesso)
  .addNode("consultarProcesso", consultarProcesso)
  .addNode("prepararPerguntaTemRO", prepararPerguntaTemRO)
  .addNode("pedirTemRO", pedirTemRO)
  .addNode("urgente", urgente)
  .addNode("prepararPerguntaCpf", prepararPerguntaCpf)
  .addNode("pedirCpf", pedirCpf)
  .addNode("consultarPessoa", consultarPessoa)
  .addNode("nudem", nudem)
  .addNode("defensoriaVitimaJuizado", defensoriaVitimaJuizado)
  .addEdge(START, "prepararPerguntaEhVitima")
  .addEdge("prepararPerguntaEhVitima", "pedirEhVitima")
  .addConditionalEdges("pedirEhVitima", depoisDeEhVitima, {
    temProcesso: "prepararPerguntaTemProcesso",
    naoEhVitima: "naoEhVitima",
  })
  .addEdge("naoEhVitima", END)
  .addEdge("prepararPerguntaTemProcesso", "pedirTemProcesso")
  .addConditionalEdges("pedirTemProcesso", depoisDeTemProcesso, {
    pedirNumeroProcesso: "prepararPerguntaNumeroProcesso",
    pedirTemRO: "prepararPerguntaTemRO",
  })
  .addEdge("prepararPerguntaNumeroProcesso", "pedirNumeroProcesso")
  .addEdge("pedirNumeroProcesso", "consultarProcesso")
  .addEdge("consultarProcesso", "prepararPerguntaTemRO")
  .addEdge("prepararPerguntaTemRO", "pedirTemRO")
  .addConditionalEdges("pedirTemRO", depoisDeTemRO, {
    urgente: "urgente",
    pedirCpf: "prepararPerguntaCpf",
  })
  .addEdge("urgente", END)
  .addEdge("prepararPerguntaCpf", "pedirCpf")
  .addEdge("pedirCpf", "consultarPessoa")
  .addConditionalEdges("consultarPessoa", depoisDeConsultarPessoa, {
    nudem: "nudem",
    defensoriaVitimaJuizado: "defensoriaVitimaJuizado",
  })
  .addEdge("nudem", END)
  .addEdge("defensoriaVitimaJuizado", END)
  .compile({ checkpointer: await criarCheckpointer() });

export { grafo };
