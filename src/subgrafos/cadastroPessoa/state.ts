import { Annotation } from "@langchain/langgraph";
import type { DadosPessoa } from "../../shared/types.js";
import { AnnotationTokensGastos } from "../../shared/tokensAcumulados.js";

export type CadastroPessoaStateType = typeof CadastroPessoaState.State;

// Issue #171 — roda quando o fluxo pai não encontrou a pessoa no Verde
// (ex: subgrafo identificarAssistido esgotou tentativas). `cpf` é
// compartilhado com o pai (mesmo nome de canal) — NUNCA perguntado de novo
// aqui, já foi coletado antes. `dadosPessoa` também é o mesmo campo que o
// pai já usa pra saber se a pessoa foi encontrada — depois de um cadastro
// com sucesso, o pai lê esse MESMO campo pra continuar o fluxo normalmente
// (idêntico ao caminho de "encontrado de primeira"), sem nó de tradução.
export const CadastroPessoaState = Annotation.Root({
  cpf: Annotation<string | undefined>,
  nome: Annotation<string | undefined>,
  dataNascimento: Annotation<string | undefined>,
  dadosPessoa: Annotation<DadosPessoa | undefined>,
  // preenchido só se o POST /integra/pessoa falhar — pai decide o que fazer
  // (ver falhaCadastro em fluxos/violenciaDomestica/graph.ts).
  cadastroErro: Annotation<string | undefined>,
  perguntaAtualTexto: Annotation<string | undefined>,
  perguntaAtualViaIA: Annotation<boolean | undefined>,
  perguntaAtualTokensTotal: Annotation<number | undefined>,
  tokensGastos: AnnotationTokensGastos(),
});
