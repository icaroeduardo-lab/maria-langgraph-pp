import { interrupt, StateGraph, START, END } from "@langchain/langgraph";
import { type PessoaPresaStateType, PessoaPresaState } from "./state.js";
import type { Pergunta } from "../../shared/types.js";
import { consultarApenadoPorRg, consultarProcesso as consultarProcessoVerde } from "../../integracoes/verde.js";
import { prepararPergunta } from "../../ia/reescrever.js";
import { criarCheckpointer } from "../../shared/checkpointer.js";

// Normaliza a resposta de uma pergunta sim_nao. O contrato original previa
// só "true"/"false" crus (a Tykhe manda isso) — mas na prática o fluxo dela
// às vezes repassa o texto literal que o usuário digitou/clicou ("Sim"/
// "Não", com acento/maiúscula variável), sem traduzir pra "true"/"false".
// Achado ao vivo 2026-08-31: "Sim" literal caindo em `resposta === "true"`
// vira false, confirmação de nome nega errado, manda pro handoff sem
// motivo. Aceita as duas formas — tolerante ao cliente real, não só ao
// contrato "correto" no papel.
function respostaEhSim(resposta: string): boolean {
  const normalizado = resposta
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos (ã→a, ó→o...)
    .trim()
    .toLowerCase();
  return normalizado === "true" || normalizado === "sim" || normalizado === "s" || normalizado === "yes";
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
  return { temProcesso: respostaEhSim(resposta) };
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

// Consulta o processo no Verde logo depois de coletar o número — informativo,
// não trava o fluxo (diferente do RG/apenado, que tem retry e gate de
// confirmação). Erro ou não encontrado só fica em dadosProcesso.encontrado,
// segue pra pergunta do RG normalmente de qualquer jeito.
async function consultarProcesso(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  const dados = await consultarProcessoVerde(state.numeroProcesso ?? "");
  return { dadosProcesso: dados };
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
  return { querTentarNovamente: respostaEhSim(resposta) };
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
  return { confirmaNome: respostaEhSim(resposta) };
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
  .addNode("consultarProcesso", consultarProcesso)
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
  .addEdge("pedirNumeroProcesso", "consultarProcesso")
  .addEdge("consultarProcesso", "prepararPerguntaRg")
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
