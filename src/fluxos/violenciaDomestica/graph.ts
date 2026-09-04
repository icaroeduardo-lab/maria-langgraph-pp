import { interrupt, StateGraph, START, END } from "@langchain/langgraph";
import { type ViolenciaDomesticaStateType, ViolenciaDomesticaState } from "./state.js";
import type { OrgaoAtendimento, Pergunta } from "../../shared/types.js";
import {
  consultarOrgaosViolenciaDomestica,
  consultarPessoaPorCpf,
  consultarProcesso as consultarProcessoVerde,
} from "../../integracoes/verde.js";
import { prepararPergunta } from "../../ia/reescrever.js";
import { criarCheckpointer } from "../../shared/checkpointer.js";
import { MENSAGEM_NAO_VITIMA, MENSAGEM_SEM_ORGAO_DISPONIVEL } from "./api.js";

// Mesma tolerância de respostas sim_nao de fluxos/pessoaPresa/graph.ts — a
// Tykhe às vezes repassa "Sim"/"Não" literal em vez de "true"/"false" (bug
// real achado ao vivo 2026-08-31, ver respostaEhSim lá). Duplicado aqui (não
// extraído pra shared/) porque é pequeno e específico o bastante — mesmo
// racional de "repo pequeno não justifica abstração" usado em ia/extrair.ts.
function respostaEhSim(resposta: string): boolean {
  const normalizado = resposta
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  return normalizado === "true" || normalizado === "sim" || normalizado === "s" || normalizado === "yes";
}

// Gate de elegibilidade — primeira pergunta do fluxo (decisão de design:
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

// cpf normalmente já vem em dadosConhecidos (ver rotas/atendimentos.ts) — só
// pergunta se não veio. Comum aos 2 ramos (com/sem RO) — os dois precisam de
// idPessoa pra consultar órgão (ver consultarOrgaos abaixo), diferente do
// desenho anterior em que só o ramo sem RO pedia CPF.
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

// O Verde resolve TUDO pelo idPessoa+RO (endereço cadastrado, regra de
// negócio deles) — ver consultarOrgaosViolenciaDomestica em
// integracoes/verde.ts. Substitui a heurística antiga de comparar município
// contra "Rio de Janeiro" — o Verde já sabe capital x outras cidades, DP x
// Juizado x NUDEM, tudo.
async function consultarOrgaos(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  const idPessoa = state.dadosPessoa?.idPessoa ?? 0;
  const resultado = await consultarOrgaosViolenciaDomestica(state.temRegistroOcorrencia ?? false, idPessoa);
  return { orgaosViolenciaDomestica: resultado };
}

function depoisDeConsultarOrgaos(state: ViolenciaDomesticaStateType): "semOrgao" | "concluir" {
  const semOrgao = state.orgaosViolenciaDomestica?.contactarCrc || !state.orgaosViolenciaDomestica?.orgaos.length;
  return semOrgao ? "semOrgao" : "concluir";
}

// Único desfecho "sem órgão" documentado pelo Verde (RO:true sem nenhum
// órgão encontrado) — mensagemCrc vem pronta deles ("...ligar 129"), cai no
// texto fixo só se por algum motivo não vier.
async function semOrgaoDisponivel(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  return {
    statusFinal: "handoff_humano",
    motivoHandoff: "sem_orgao_disponivel",
    mensagemFinal: state.orgaosViolenciaDomestica?.mensagemCrc ?? MENSAGEM_SEM_ORGAO_DISPONIVEL,
  };
}

function montarMensagemEncaminhamento(orgao: OrgaoAtendimento, urgente: boolean): string {
  const municipio = orgao.enderecos?.[0]?.municipio;
  const localizacao = municipio ? ` (${municipio})` : "";
  return urgente
    ? `Como você já tem Boletim de Ocorrência, vou encaminhar seu atendimento com urgência para ${orgao.nome}${localizacao} — sem necessidade de agendamento.`
    : `Vou encaminhar seu caso para ${orgao.nome}${localizacao}.`;
}

// tipoEncaminhamento "urgente" x "padrao" ainda é útil pra Tykhe (prioridade
// de atendimento), mas o ÓRGÃO em si (nome/endereço) já vem certo do Verde —
// não precisamos mais decidir NUDEM x Defensoria da Vítima aqui.
async function concluir(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  const orgao = state.orgaosViolenciaDomestica?.orgaos[0];
  const urgente = !!state.temRegistroOcorrencia;
  return {
    statusFinal: "concluido",
    tipoEncaminhamento: urgente ? "urgente" : "padrao",
    mensagemFinal: orgao ? montarMensagemEncaminhamento(orgao, urgente) : MENSAGEM_SEM_ORGAO_DISPONIVEL,
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
  .addNode("prepararPerguntaCpf", prepararPerguntaCpf)
  .addNode("pedirCpf", pedirCpf)
  .addNode("consultarPessoa", consultarPessoa)
  .addNode("consultarOrgaos", consultarOrgaos)
  .addNode("semOrgaoDisponivel", semOrgaoDisponivel)
  .addNode("concluir", concluir)
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
  .addEdge("pedirTemRO", "prepararPerguntaCpf")
  .addEdge("prepararPerguntaCpf", "pedirCpf")
  .addEdge("pedirCpf", "consultarPessoa")
  .addEdge("consultarPessoa", "consultarOrgaos")
  .addConditionalEdges("consultarOrgaos", depoisDeConsultarOrgaos, {
    semOrgao: "semOrgaoDisponivel",
    concluir: "concluir",
  })
  .addEdge("semOrgaoDisponivel", END)
  .addEdge("concluir", END)
  .compile({ checkpointer: await criarCheckpointer() });

export { grafo };
