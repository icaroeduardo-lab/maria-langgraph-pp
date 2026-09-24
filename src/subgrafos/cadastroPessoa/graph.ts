import { interrupt, StateGraph, START, END } from "@langchain/langgraph";
import { type CadastroPessoaStateType, CadastroPessoaState } from "./state.js";
import type { Pergunta } from "../../shared/types.js";
import { cadastrarPessoa as cadastrarPessoaVerde } from "../../integracoes/verde.js";
import { prepararPergunta } from "../../ia/reescrever.js";

// Issue #171 — subgrafo reaproveitável: cadastra a pessoa no Verde
// (POST /integra/pessoa) quando o CPF informado não tem cadastro ainda.
// Só pede o que falta pro cadastro (nome, data de nascimento) — CPF já foi
// coletado antes pelo fluxo pai (subgrafo identificarAssistido), nunca
// perguntado de novo aqui. Escopo restrito aos 3 campos obrigatórios do
// CadastrarPessoaDTO por decisão registrada na issue — endereço/telefone/
// email/gênero/representante ficam pra melhoria futura.

async function prepararPerguntaNome(): Promise<Partial<CadastroPessoaStateType>> {
  return prepararPergunta("nome", "Não encontrei seu cadastro no sistema. Pra criar um novo, qual o seu nome completo?");
}

async function pedirNome(state: CadastroPessoaStateType): Promise<Partial<CadastroPessoaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? "Não encontrei seu cadastro no sistema. Pra criar um novo, qual o seu nome completo?",
    tipo: "texto",
  });
  return { nome: resposta };
}

async function prepararPerguntaDataNascimento(): Promise<Partial<CadastroPessoaStateType>> {
  return prepararPergunta("dataNascimento", "Qual a sua data de nascimento? (dd/mm/aaaa)");
}

async function pedirDataNascimento(state: CadastroPessoaStateType): Promise<Partial<CadastroPessoaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? "Qual a sua data de nascimento? (dd/mm/aaaa)",
    tipo: "texto",
  });
  return { dataNascimento: resposta };
}

async function cadastrarPessoa(state: CadastroPessoaStateType): Promise<Partial<CadastroPessoaStateType>> {
  const resultado = await cadastrarPessoaVerde({
    nome: state.nome ?? "",
    cpf: state.cpf ?? "",
    dataNascimento: state.dataNascimento ?? "",
  });
  if (!resultado.sucesso) return { cadastroErro: resultado.erro ?? "erro desconhecido" };
  // Mesmo campo/shape que identificarAssistido já preenche quando encontra
  // de primeira — o fluxo pai não precisa saber se a pessoa já existia ou
  // acabou de ser cadastrada, o resto do fluxo é idêntico nos 2 casos.
  return { dadosPessoa: { encontrado: true, idPessoa: resultado.idPessoa, nome: state.nome } };
}

const grafo = new StateGraph(CadastroPessoaState)
  .addNode("prepararPerguntaNome", prepararPerguntaNome)
  .addNode("pedirNome", pedirNome)
  .addNode("prepararPerguntaDataNascimento", prepararPerguntaDataNascimento)
  .addNode("pedirDataNascimento", pedirDataNascimento)
  .addNode("cadastrarPessoa", cadastrarPessoa)
  .addEdge(START, "prepararPerguntaNome")
  .addEdge("prepararPerguntaNome", "pedirNome")
  .addEdge("pedirNome", "prepararPerguntaDataNascimento")
  .addEdge("prepararPerguntaDataNascimento", "pedirDataNascimento")
  .addEdge("pedirDataNascimento", "cadastrarPessoa")
  .addEdge("cadastrarPessoa", END)
  // Sem checkpointer próprio — mesmo racional de subgrafos/identificarAssistido.
  .compile();

export { grafo };
