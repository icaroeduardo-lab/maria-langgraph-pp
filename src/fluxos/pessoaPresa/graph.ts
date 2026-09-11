import { interrupt, StateGraph, START, END } from "@langchain/langgraph";
import { z } from "zod";
import { type PessoaPresaStateType, PessoaPresaState } from "./state.js";
import type { Pergunta } from "../../shared/types.js";
import { consultarApenadoPorRg, consultarProcesso as consultarProcessoVerde } from "../../integracoes/verde.js";
import { prepararPergunta } from "../../ia/reescrever.js";
import { extrairCamposLivre } from "../../ia/extrair.js";
import { criarCheckpointer } from "../../shared/checkpointer.js";

// Guard da extração livre — desligada por padrão, liga só com a env var
// explícita. Esse guard decide se o grafo ENTRA no ramo de extração no
// START (roteamentoInicial); com ele false, comportamento idêntico a antes
// dessa feature existir. Só checa EXTRACAO_LIVRE_IA, NÃO NODE_ENV — o guard
// de "não gastar Bedrock de verdade em teste" já mora dentro de
// extrairCamposLivre (ia/extrair.ts), mesmo padrão de reescreverPergunta.
// Duplicar o check de NODE_ENV aqui faria a flag nunca funcionar durante
// `pnpm test` (que roda com NODE_ENV=test sempre) — bug real, achado pelos
// testes de roteamento abaixo.
function extracaoLivreHabilitada(): boolean {
  return process.env.EXTRACAO_LIVRE_IA === "true";
}

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

// Pergunta livre no início do fluxo (opcional, ver extracaoLivreHabilitada)
// — deixa a pessoa contar a situação com as próprias palavras. A extração
// roda DEPOIS do interrupt() resolver, no mesmo nó que pausa (mesmo padrão
// dos outros "pedir": pós-processar a resposta depois de retomar é seguro,
// só o código ANTES do interrupt() reexecuta em todo resume — ver
// prepararPergunta() em ia/reescrever.ts). Por isso não precisa de um nó
// "preparar" + "extrair" separados feito as outras perguntas: a chamada de
// extração já é o pós-processamento, roda só 1x.
async function prepararPerguntaLivre(): Promise<Partial<PessoaPresaStateType>> {
  return prepararPergunta(
    "relatoLivre",
    "Pode me contar a situação com suas palavras? Se já souber, pode falar o número do processo, o RG da pessoa presa e seu parentesco com ela — tudo de uma vez."
  );
}

async function pedirLivre(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta:
      state.perguntaAtualTexto ??
      "Pode me contar a situação com suas palavras? Se já souber, pode falar o número do processo, o RG da pessoa presa e seu parentesco com ela — tudo de uma vez.",
    tipo: "texto",
  });
  const extraido = await extrairCamposLivre(resposta);
  return {
    ...(extraido.temProcesso !== undefined ? { temProcesso: extraido.temProcesso } : {}),
    ...(extraido.numeroProcesso !== undefined ? { numeroProcesso: extraido.numeroProcesso } : {}),
    ...(extraido.rg !== undefined ? { rg: extraido.rg } : {}),
    ...(extraido.parentesco !== undefined ? { parentesco: extraido.parentesco } : {}),
    // único nó deste fluxo que chama IA fora de prepararPergunta() — soma o
    // delta manualmente (issue #35).
    tokensGastosTotal: extraido.tokensTotal ?? 0,
  };
}

function roteamentoInicial(): "comExtracao" | "semExtracao" {
  return extracaoLivreHabilitada() ? "comExtracao" : "semExtracao";
}

// temProcesso já pode vir preenchido da extração livre (pedirLivre, acima)
// — bypass evita perguntar de novo o que a pessoa já contou. Com a extração
// desligada (padrão), state.temProcesso nunca chega aqui definido antes da
// hora, então esse `if` nunca dispara — comportamento idêntico a antes da
// extração livre existir.
async function prepararPerguntaTemProcesso(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  if (state.temProcesso !== undefined) return {};
  return prepararPergunta("temProcesso", "Você tem o número do processo da pessoa que está presa?");
}

async function pedirTemProcesso(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  if (state.temProcesso !== undefined) return {};
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

async function prepararPerguntaNumeroProcesso(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  if (state.numeroProcesso !== undefined) return {};
  return prepararPergunta("numeroProcesso", "Qual o número do processo? Informe apenas os números.");
}

async function pedirNumeroProcesso(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  if (state.numeroProcesso !== undefined) return {};
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

// rg é reescrito a cada volta do retry loop (pedirRg roda de novo quando
// tentativasRg>=1, ver perguntaTentarNovamente/depoisDePerguntaTentar) — um
// bypass ingênuo tipo "if state.rg definido, pula" quebraria o retry (rg da
// tentativa anterior, que FALHOU, faria pular a próxima pergunta). Bypass só
// vale na tentativa 0 (RG ainda não tentado nenhuma vez) — é o único caso
// em que "rg definido" significa "veio da extração", não "tentativa anterior".
function rgVeioDaExtracao(state: PessoaPresaStateType): boolean {
  return state.rg !== undefined && (state.tentativasRg ?? 0) === 0;
}

async function prepararPerguntaRg(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  if (rgVeioDaExtracao(state)) return {};
  return prepararPergunta("rg", "Qual o RG da pessoa presa? Informe apenas os números.");
}

async function pedirRg(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  if (rgVeioDaExtracao(state)) return {};
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? "Qual o RG da pessoa presa? Informe apenas os números.",
    tipo: "texto",
  });
  return { rg: resposta };
}

function depoisDeTemProcesso(state: PessoaPresaStateType): "pedirNumeroProcesso" | "pedirRg" {
  return state.temProcesso ? "pedirNumeroProcesso" : "pedirRg";
}

// Valida o FORMATO do RG antes de gastar uma chamada no Verde — só dígitos
// (o mesmo texto da pergunta já pede "apenas os números"). Diferente do
// retry de "RG não encontrado" (tentativasRg/perguntaTentarNovamente,
// abaixo): aqui nunca chegou a consultar nada, é rejeição local.
const RgSchema = z.string().trim().regex(/^\d+$/);

function rgFormatoValido(rg: string): boolean {
  return RgSchema.safeParse(rg).success;
}

function depoisDePedirRg(state: PessoaPresaStateType): "valido" | "invalido" {
  return rgFormatoValido(state.rg ?? "") ? "valido" : "invalido";
}

// Limpa `rg` de volta pra undefined antes de perguntar de novo — sem isso,
// rgVeioDaExtracao (acima) veria rg definido (o valor inválido) na tentativa
// 0 e pularia a pergunta de novo, achando que "veio da extração".
async function prepararPerguntaRgInvalido(): Promise<Partial<PessoaPresaStateType>> {
  const preparado = await prepararPergunta(
    "rgInvalido",
    "O RG deve conter apenas números. Qual o RG da pessoa presa? Informe apenas os números."
  );
  return { ...preparado, rg: undefined };
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

async function prepararPerguntaParentesco(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  if (state.parentesco !== undefined) return {};
  return prepararPergunta("parentesco", "Qual seu parentesco com a pessoa presa?");
}

export async function pedirParentesco(state: PessoaPresaStateType): Promise<Partial<PessoaPresaStateType>> {
  if (state.parentesco !== undefined) return {};
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
  .addNode("prepararPerguntaLivre", prepararPerguntaLivre)
  .addNode("pedirLivre", pedirLivre)
  .addNode("prepararPerguntaTemProcesso", prepararPerguntaTemProcesso)
  .addNode("pedirTemProcesso", pedirTemProcesso)
  .addNode("prepararPerguntaNumeroProcesso", prepararPerguntaNumeroProcesso)
  .addNode("pedirNumeroProcesso", pedirNumeroProcesso)
  .addNode("consultarProcesso", consultarProcesso)
  .addNode("prepararPerguntaRg", prepararPerguntaRg)
  .addNode("pedirRg", pedirRg)
  .addNode("prepararPerguntaRgInvalido", prepararPerguntaRgInvalido)
  .addNode("consultarApenado", consultarApenado)
  .addNode("prepararPerguntaTentarNovamente", prepararPerguntaTentarNovamente)
  .addNode("perguntaTentarNovamente", perguntaTentarNovamente)
  .addNode("prepararPerguntaConfirmaNome", prepararPerguntaConfirmaNome)
  .addNode("pedirConfirmaNome", pedirConfirmaNome)
  .addNode("prepararPerguntaParentesco", prepararPerguntaParentesco)
  .addNode("pedirParentesco", pedirParentesco)
  .addNode("concluir", concluir)
  .addNode("naoConfirmado", naoConfirmado)
  // Roteamento condicional (não .addEdge fixo) é o que garante que, com a
  // extração desligada (padrão), o grafo nem entra no ramo novo — vai direto
  // pra prepararPerguntaTemProcesso, exatamente como antes dessa feature.
  .addConditionalEdges(START, roteamentoInicial, {
    comExtracao: "prepararPerguntaLivre",
    semExtracao: "prepararPerguntaTemProcesso",
  })
  .addEdge("prepararPerguntaLivre", "pedirLivre")
  .addEdge("pedirLivre", "prepararPerguntaTemProcesso")
  .addEdge("prepararPerguntaTemProcesso", "pedirTemProcesso")
  .addConditionalEdges("pedirTemProcesso", depoisDeTemProcesso, {
    pedirNumeroProcesso: "prepararPerguntaNumeroProcesso",
    pedirRg: "prepararPerguntaRg",
  })
  .addEdge("prepararPerguntaNumeroProcesso", "pedirNumeroProcesso")
  .addEdge("pedirNumeroProcesso", "consultarProcesso")
  .addEdge("consultarProcesso", "prepararPerguntaRg")
  .addEdge("prepararPerguntaRg", "pedirRg")
  .addConditionalEdges("pedirRg", depoisDePedirRg, {
    valido: "consultarApenado",
    invalido: "prepararPerguntaRgInvalido",
  })
  .addEdge("prepararPerguntaRgInvalido", "pedirRg")
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
