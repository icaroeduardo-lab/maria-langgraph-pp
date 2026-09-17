import { interrupt, StateGraph, START, END } from "@langchain/langgraph";
import { type ViolenciaDomesticaStateType, ViolenciaDomesticaState } from "./state.js";
import type { OrgaoAtendimento, Pergunta } from "../../shared/types.js";
import {
  consultarOrgaosPlantaoViolenciaDomestica,
  consultarOrgaosViolenciaDomestica,
  consultarPessoaPorCpf,
  consultarPlantaoVigente,
  consultarProcesso as consultarProcessoVerde,
  criarEncaminhamentoViolenciaDomestica,
} from "../../integracoes/verde.js";
import { prepararPergunta } from "../../ia/reescrever.js";
import { criarCheckpointer } from "../../shared/checkpointer.js";
import { MENSAGEM_CPF_NAO_ENCONTRADO, MENSAGEM_FALHA_ENCAMINHAMENTO, MENSAGEM_NAO_VITIMA, MENSAGEM_SEM_ORGAO_DISPONIVEL } from "./api.js";

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
  return { dadosProcesso: dados, tentativasProcesso: (state.tentativasProcesso ?? 0) + 1 };
}

// Issue #75 — diferente do RG/CPF, processo é só informativo: esgotar as
// tentativas (ou desistir) NUNCA vira handoff, só segue o fluxo sem o
// número confirmado. "temRO" nos 2 casos de desistência (silenciosa na 3ª
// falha, ou depois de responder "não" quer tentar de novo).
function depoisDeConsultarProcesso(state: ViolenciaDomesticaStateType): "temRO" | "tentarNovamente" {
  if (state.dadosProcesso?.encontrado) return "temRO";
  return (state.tentativasProcesso ?? 0) >= 3 ? "temRO" : "tentarNovamente";
}

async function prepararPerguntaTentarNovamenteProcesso(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  return prepararPergunta(
    "tentarNovamenteProcesso",
    `Não encontrei esse número de processo (tentativa ${state.tentativasProcesso ?? 1} de 3). Quer tentar de novo?`
  );
}

async function perguntaTentarNovamenteProcesso(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta:
      state.perguntaAtualTexto ??
      `Não encontrei esse número de processo (tentativa ${state.tentativasProcesso ?? 1} de 3). Quer tentar de novo?`,
    tipo: "sim_nao",
    opcoes: ["Sim", "Não"],
  });
  return { querTentarNovamenteProcesso: respostaEhSim(resposta) };
}

function depoisDePerguntaTentarProcesso(state: ViolenciaDomesticaStateType): "pedirNumeroProcesso" | "temRO" {
  return state.querTentarNovamenteProcesso ? "pedirNumeroProcesso" : "temRO";
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
//
// Bypass só vale na tentativa 0 (issue #72, mesmo racional de
// rgVeioDaExtracao em pessoaPresa/graph.ts) — sem o check de tentativasCpf,
// um retry reusaria o CPF da tentativa anterior (que FALHOU) em vez de
// perguntar de novo.
function cpfVeioDeDadosConhecidos(state: ViolenciaDomesticaStateType): boolean {
  return state.cpf !== undefined && (state.tentativasCpf ?? 0) === 0;
}

async function prepararPerguntaCpf(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  if (cpfVeioDeDadosConhecidos(state)) return {};
  return prepararPergunta("cpf", "Qual o seu CPF? Informe apenas os números.");
}

async function pedirCpf(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  if (cpfVeioDeDadosConhecidos(state)) return {};
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? "Qual o seu CPF? Informe apenas os números.",
    tipo: "texto",
  });
  return { cpf: resposta };
}

async function consultarPessoa(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  const dados = await consultarPessoaPorCpf(state.cpf ?? "");
  return { dadosPessoa: dados, tentativasCpf: (state.tentativasCpf ?? 0) + 1 };
}

// Sem parâmetro nenhum — dá pra rodar em qualquer ponto do fluxo, roda logo
// depois de saber idPessoa pra já decidir qual consulta de órgão usar em
// seguida. Vazio = fora de horário de plantão, segue fluxo normal.
async function consultarPlantao(): Promise<Partial<ViolenciaDomesticaStateType>> {
  const plantoes = await consultarPlantaoVigente();
  return { plantaoIds: plantoes.map((p) => p.id) };
}

// O Verde resolve TUDO pelo idPessoa+RO (endereço cadastrado, regra de
// negócio deles) — ver consultarOrgaosViolenciaDomestica em
// integracoes/verde.ts. Substitui a heurística antiga de comparar município
// contra "Rio de Janeiro" — o Verde já sabe capital x outras cidades, DP x
// Juizado x NUDEM, tudo. Em horário de plantão (plantaoIds não vazio), a
// regra de órgão é outra — usa o endpoint de plantão em vez do normal,
// RO deixa de importar nesse caso (endpoint de plantão nem recebe RO).
async function consultarOrgaos(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  const idPessoa = state.dadosPessoa?.idPessoa ?? 0;
  const plantaoIds = state.plantaoIds ?? [];
  const resultado =
    plantaoIds.length > 0
      ? await consultarOrgaosPlantaoViolenciaDomestica(plantaoIds, idPessoa)
      : await consultarOrgaosViolenciaDomestica(state.temRegistroOcorrencia ?? false, idPessoa);
  return { orgaosViolenciaDomestica: resultado };
}

// Issue #72 — sem órgão encontrado tem 2 causas bem diferentes: (a) a
// pessoa foi encontrada mas genuinamente não tem órgão disponível pra ela
// (comportamento antigo, mensagem/motivo "sem_orgao_disponivel" inalterado),
// ou (b) o CPF não foi encontrado (dadosPessoa.encontrado:false) — nesse
// caso dá até 3 tentativas antes de desistir, em vez de já mandar pro
// atendente com uma mensagem que nem fala a real do problema.
function depoisDeConsultarOrgaos(
  state: ViolenciaDomesticaStateType
): "semOrgao" | "prosseguir" | "tentarCpfNovamente" | "cpfEsgotado" {
  const semOrgao = state.orgaosViolenciaDomestica?.contactarCrc || !state.orgaosViolenciaDomestica?.orgaos.length;
  if (!semOrgao) return "prosseguir";
  if (state.dadosPessoa?.encontrado === false) {
    return (state.tentativasCpf ?? 0) >= 3 ? "cpfEsgotado" : "tentarCpfNovamente";
  }
  return "semOrgao";
}

// Único desfecho "sem órgão" documentado pelo Verde (RO:true sem nenhum
// órgão encontrado, PESSOA encontrada) — mensagemCrc vem pronta deles
// ("...ligar 129"), cai no texto fixo só se por algum motivo não vier.
async function semOrgaoDisponivel(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  return {
    statusFinal: "handoff_humano",
    motivoHandoff: "sem_orgao_disponivel",
    mensagemFinal: state.orgaosViolenciaDomestica?.mensagemCrc ?? MENSAGEM_SEM_ORGAO_DISPONIVEL,
  };
}

async function prepararPerguntaTentarNovamenteCpf(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  return prepararPergunta(
    "tentarNovamenteCpf",
    `Não encontrei ninguém com esse CPF (tentativa ${state.tentativasCpf ?? 1} de 3). Quer tentar de novo?`
  );
}

async function perguntaTentarNovamenteCpf(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta:
      state.perguntaAtualTexto ?? `Não encontrei ninguém com esse CPF (tentativa ${state.tentativasCpf ?? 1} de 3). Quer tentar de novo?`,
    tipo: "sim_nao",
    opcoes: ["Sim", "Não"],
  });
  return { querTentarNovamenteCpf: respostaEhSim(resposta) };
}

function depoisDePerguntaTentarCpf(state: ViolenciaDomesticaStateType): "pedirCpf" | "cpfEsgotado" {
  return state.querTentarNovamenteCpf ? "pedirCpf" : "cpfEsgotado";
}

// Esgotou as 3 tentativas (ou respondeu "não" quer tentar de novo) — motivo
// específico, não confunde com "sem_orgao_disponivel" (issue #72).
async function cpfEsgotado(): Promise<Partial<ViolenciaDomesticaStateType>> {
  return {
    statusFinal: "handoff_humano",
    motivoHandoff: "cpf_nao_encontrado",
    mensagemFinal: MENSAGEM_CPF_NAO_ENCONTRADO,
  };
}

// Executa o encaminhamento de VERDADE (POST no Verde, cria registro real) —
// só roda depois de já saber pra qual órgão vai (consultarOrgaos acima).
// idOrgao/idLocalAtendimento vêm do PRIMEIRO órgão da lista (prioridade do
// Verde); idAssunto não é enviado (confirmado com o time do Verde que não é
// necessário pra esse fluxo).
async function criarEncaminhamento(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  const orgao = state.orgaosViolenciaDomestica?.orgaos[0];
  const resultado = await criarEncaminhamentoViolenciaDomestica({
    idPessoa: state.dadosPessoa?.idPessoa ?? 0,
    idOrgao: orgao?.id ?? 0,
    idLocalAtendimento: orgao?.enderecos?.[0]?.idLocalAtendimento,
    urgente: !!state.temRegistroOcorrencia,
  });
  return resultado.sucesso
    ? { encaminhamentoId: resultado.id }
    : { encaminhamentoErro: resultado.erro ?? "erro desconhecido" };
}

function depoisDeCriarEncaminhamento(state: ViolenciaDomesticaStateType): "concluir" | "falhou" {
  return state.encaminhamentoId !== undefined ? "concluir" : "falhou";
}

// Achou o órgão certo, mas o POST de encaminhamento de verdade falhou —
// NÃO diz pro usuário que deu certo (mentira), manda pra atendente confirmar
// manualmente. state.orgaosViolenciaDomestica ainda tem o órgão pretendido,
// útil pro atendente ver nos metadados mesmo sem ter sido criado de fato.
async function falhaEncaminhamento(): Promise<Partial<ViolenciaDomesticaStateType>> {
  return {
    statusFinal: "handoff_humano",
    motivoHandoff: "falha_encaminhamento",
    mensagemFinal: MENSAGEM_FALHA_ENCAMINHAMENTO,
  };
}

function montarMensagemEncaminhamento(orgao: OrgaoAtendimento, urgente: boolean, encaminhamentoId: number | undefined): string {
  const municipio = orgao.enderecos?.[0]?.municipio;
  const localizacao = municipio ? ` (${municipio})` : "";
  const protocolo = encaminhamentoId !== undefined ? ` Protocolo: ${encaminhamentoId}.` : "";
  return urgente
    ? `Como você já tem Boletim de Ocorrência, vou encaminhar seu atendimento com urgência para ${orgao.nome}${localizacao} — sem necessidade de agendamento.${protocolo}`
    : `Vou encaminhar seu caso para ${orgao.nome}${localizacao}.${protocolo}`;
}

// tipoEncaminhamento "urgente" x "padrao" ainda é útil pra Tykhe (prioridade
// de atendimento), mas o ÓRGÃO em si (nome/endereço) já vem certo do Verde —
// não precisamos mais decidir NUDEM x Defensoria da Vítima aqui. Só chega
// aqui depois de criarEncaminhamento ter dado certo de verdade.
async function concluir(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  const orgao = state.orgaosViolenciaDomestica?.orgaos[0];
  const urgente = !!state.temRegistroOcorrencia;
  return {
    statusFinal: "concluido",
    tipoEncaminhamento: urgente ? "urgente" : "padrao",
    mensagemFinal: orgao ? montarMensagemEncaminhamento(orgao, urgente, state.encaminhamentoId) : MENSAGEM_SEM_ORGAO_DISPONIVEL,
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
  .addNode("prepararPerguntaTentarNovamenteProcesso", prepararPerguntaTentarNovamenteProcesso)
  .addNode("perguntaTentarNovamenteProcesso", perguntaTentarNovamenteProcesso)
  .addNode("prepararPerguntaTemRO", prepararPerguntaTemRO)
  .addNode("pedirTemRO", pedirTemRO)
  .addNode("prepararPerguntaCpf", prepararPerguntaCpf)
  .addNode("pedirCpf", pedirCpf)
  .addNode("consultarPessoa", consultarPessoa)
  .addNode("consultarPlantao", consultarPlantao)
  .addNode("consultarOrgaos", consultarOrgaos)
  .addNode("semOrgaoDisponivel", semOrgaoDisponivel)
  .addNode("prepararPerguntaTentarNovamenteCpf", prepararPerguntaTentarNovamenteCpf)
  .addNode("perguntaTentarNovamenteCpf", perguntaTentarNovamenteCpf)
  .addNode("cpfEsgotado", cpfEsgotado)
  .addNode("criarEncaminhamento", criarEncaminhamento)
  .addNode("falhaEncaminhamento", falhaEncaminhamento)
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
  .addConditionalEdges("consultarProcesso", depoisDeConsultarProcesso, {
    temRO: "prepararPerguntaTemRO",
    tentarNovamente: "prepararPerguntaTentarNovamenteProcesso",
  })
  .addEdge("prepararPerguntaTentarNovamenteProcesso", "perguntaTentarNovamenteProcesso")
  .addConditionalEdges("perguntaTentarNovamenteProcesso", depoisDePerguntaTentarProcesso, {
    pedirNumeroProcesso: "prepararPerguntaNumeroProcesso",
    temRO: "prepararPerguntaTemRO",
  })
  .addEdge("prepararPerguntaTemRO", "pedirTemRO")
  .addEdge("pedirTemRO", "prepararPerguntaCpf")
  .addEdge("prepararPerguntaCpf", "pedirCpf")
  .addEdge("pedirCpf", "consultarPessoa")
  .addEdge("consultarPessoa", "consultarPlantao")
  .addEdge("consultarPlantao", "consultarOrgaos")
  .addConditionalEdges("consultarOrgaos", depoisDeConsultarOrgaos, {
    semOrgao: "semOrgaoDisponivel",
    prosseguir: "criarEncaminhamento",
    tentarCpfNovamente: "prepararPerguntaTentarNovamenteCpf",
    cpfEsgotado: "cpfEsgotado",
  })
  .addEdge("semOrgaoDisponivel", END)
  .addEdge("prepararPerguntaTentarNovamenteCpf", "perguntaTentarNovamenteCpf")
  .addConditionalEdges("perguntaTentarNovamenteCpf", depoisDePerguntaTentarCpf, {
    pedirCpf: "prepararPerguntaCpf",
    cpfEsgotado: "cpfEsgotado",
  })
  .addEdge("cpfEsgotado", END)
  .addConditionalEdges("criarEncaminhamento", depoisDeCriarEncaminhamento, {
    concluir: "concluir",
    falhou: "falhaEncaminhamento",
  })
  .addEdge("falhaEncaminhamento", END)
  .addEdge("concluir", END)
  .compile({ checkpointer: await criarCheckpointer() });

export { grafo };
