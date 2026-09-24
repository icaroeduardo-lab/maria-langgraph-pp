import { interrupt, StateGraph, START, END } from "@langchain/langgraph";
import { type IdentificarAssistidoStateType, IdentificarAssistidoState } from "./state.js";
import type { Pergunta } from "../../shared/types.js";
import { consultarPessoaPorCpf } from "../../integracoes/verde.js";
import { prepararPergunta } from "../../ia/reescrever.js";

// Issue #171 — subgrafo reaproveitável: pergunta CPF, consulta o Verde, dá
// até 3 tentativas antes de desistir. Termina em 2 desfechos possíveis (o
// grafo pai decide o que fazer com cada um, olhando `dadosPessoa.encontrado`
// depois que esse subgrafo retornar):
// - encontrado: dadosPessoa.encontrado === true
// - esgotado: dadosPessoa.encontrado === false, 3 tentativas usadas
// Nenhum dos dois vira handoff AQUI — isso é responsabilidade de quem
// embute este subgrafo (cada fluxo pai decide, ex: violenciaDomestica manda
// pro subgrafo cadastroPessoa quando esgota).

function cpfFormatoValido(valor: string): boolean {
  return valor.replace(/\D/g, "").length === 11;
}

function respostaEhSim(resposta: string): boolean {
  const normalizado = resposta
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  return normalizado === "true" || normalizado === "sim" || normalizado === "s" || normalizado === "yes";
}

// Bypass só vale na tentativa 0 (mesmo racional de rgVeioDaExtracao em
// pessoaPresa/graph.ts) — sem o check de tentativasCpf, um retry reusaria o
// CPF da tentativa anterior (que FALHOU) em vez de perguntar de novo.
function cpfVeioDeDadosConhecidos(state: IdentificarAssistidoStateType): boolean {
  return state.cpf !== undefined && (state.tentativasCpf ?? 0) === 0;
}

async function prepararPerguntaCpf(state: IdentificarAssistidoStateType): Promise<Partial<IdentificarAssistidoStateType>> {
  if (cpfVeioDeDadosConhecidos(state)) return {};
  return prepararPergunta("cpf", "Qual o seu CPF? Informe apenas os números.");
}

async function pedirCpf(state: IdentificarAssistidoStateType): Promise<Partial<IdentificarAssistidoStateType>> {
  if (cpfVeioDeDadosConhecidos(state)) return {};
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? "Qual o seu CPF? Informe apenas os números.",
    tipo: "texto",
  });
  return { cpf: resposta };
}

async function consultarPessoa(state: IdentificarAssistidoStateType): Promise<Partial<IdentificarAssistidoStateType>> {
  const dados = await consultarPessoaPorCpf(state.cpf ?? "");
  return { dadosPessoa: dados, tentativasCpf: (state.tentativasCpf ?? 0) + 1 };
}

function depoisDeConsultarPessoa(state: IdentificarAssistidoStateType): "encontrado" | "tentarNovamente" | "esgotado" {
  if (state.dadosPessoa?.encontrado) return "encontrado";
  return (state.tentativasCpf ?? 0) >= 3 ? "esgotado" : "tentarNovamente";
}

async function prepararPerguntaTentarNovamenteCpf(state: IdentificarAssistidoStateType): Promise<Partial<IdentificarAssistidoStateType>> {
  return prepararPergunta("tentarNovamenteCpf", `Não encontrei ninguém com esse CPF (tentativa ${state.tentativasCpf ?? 1} de 3). Quer tentar de novo?`);
}

async function perguntaTentarNovamenteCpf(state: IdentificarAssistidoStateType): Promise<Partial<IdentificarAssistidoStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? `Não encontrei ninguém com esse CPF (tentativa ${state.tentativasCpf ?? 1} de 3). Quer tentar de novo?`,
    tipo: "sim_nao",
    opcoes: ["Sim", "Não"],
  });
  if (cpfFormatoValido(resposta)) {
    return { querTentarNovamenteCpf: true, cpf: resposta, digitouCpfDireto: true };
  }
  return { querTentarNovamenteCpf: respostaEhSim(resposta), digitouCpfDireto: false };
}

function depoisDePerguntaTentarCpf(state: IdentificarAssistidoStateType): "pedirCpf" | "esgotado" | "consultarPessoa" {
  if (!state.querTentarNovamenteCpf) return "esgotado";
  return state.digitouCpfDireto ? "consultarPessoa" : "pedirCpf";
}

const grafo = new StateGraph(IdentificarAssistidoState)
  .addNode("prepararPerguntaCpf", prepararPerguntaCpf)
  .addNode("pedirCpf", pedirCpf)
  .addNode("consultarPessoa", consultarPessoa)
  .addNode("prepararPerguntaTentarNovamenteCpf", prepararPerguntaTentarNovamenteCpf)
  .addNode("perguntaTentarNovamenteCpf", perguntaTentarNovamenteCpf)
  .addEdge(START, "prepararPerguntaCpf")
  .addEdge("prepararPerguntaCpf", "pedirCpf")
  .addEdge("pedirCpf", "consultarPessoa")
  .addConditionalEdges("consultarPessoa", depoisDeConsultarPessoa, {
    encontrado: END,
    esgotado: END,
    tentarNovamente: "prepararPerguntaTentarNovamenteCpf",
  })
  .addEdge("prepararPerguntaTentarNovamenteCpf", "perguntaTentarNovamenteCpf")
  .addConditionalEdges("perguntaTentarNovamenteCpf", depoisDePerguntaTentarCpf, {
    pedirCpf: "prepararPerguntaCpf",
    esgotado: END,
    // CPF digitado direto na pergunta de retry — pula prepararPerguntaCpf,
    // consulta o Verde de novo direto.
    consultarPessoa: "consultarPessoa",
  })
  // Sem checkpointer próprio — subgrafo embutido como nó num fluxo pai
  // (fluxos/violenciaDomestica/graph.ts) herda a persistência do checkpointer
  // do PAI. Passar um checkpointer aqui criaria uma 2ª camada de persistência
  // desconectada do thread_id real da conversa.
  .compile();

export { grafo };
