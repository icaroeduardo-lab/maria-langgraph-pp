import { Annotation } from "@langchain/langgraph";
import type { DadosPessoa, DadosProcesso } from "../../shared/types.js";

export type ViolenciaDomesticaStateType = typeof ViolenciaDomesticaState.State;

export const ViolenciaDomesticaState = Annotation.Root({
  ehVitima: Annotation<boolean | undefined>,
  temProcesso: Annotation<boolean | undefined>,
  numeroProcesso: Annotation<string | undefined>,
  // consulta informativa (não trava o fluxo) — mesmo padrão de
  // fluxos/pessoaPresa/state.ts.
  dadosProcesso: Annotation<DadosProcesso | undefined>,
  temRegistroOcorrencia: Annotation<boolean | undefined>,
  // vem pronto no `dadosConhecidos` do POST /atendimentos/:fluxoId (contrato
  // Tykhe: { cpf, idPessoa, nome, email }) — ver rotas/atendimentos.ts. Bypass
  // evita perguntar de novo; só é LIDO no ramo "sem RO" (decide capital x
  // outras cidades pelo município), ver graph.ts.
  cpf: Annotation<string | undefined>,
  dadosPessoa: Annotation<DadosPessoa | undefined>,
  statusFinal: Annotation<"concluido" | "handoff_humano" | undefined>,
  // só preenchido quando statusFinal:"handoff_humano".
  motivoHandoff: Annotation<"nao_e_vitima" | undefined>,
  // só preenchido quando statusFinal:"concluido" — os 3 desfechos possíveis
  // do fluxo (ver graph.ts), cada um com mensagemFinal própria.
  tipoEncaminhamento: Annotation<"nudem" | "defensoria_vitima_juizado" | "urgente_juizado" | undefined>,
  // texto final específico do desfecho — sobrescreve o texto genérico
  // fluxo.mensagemConcluido/mensagemHandoff (ver
  // rotas/atendimentos.ts::montarRespostaAtendimento). Todo desfecho deste
  // fluxo seta isso; os textos genéricos ficam só de fallback de contrato.
  mensagemFinal: Annotation<string | undefined>,
  // mesmo padrão compartilhado de pessoaPresa/state.ts — ver ia/reescrever.ts.
  perguntaAtualTexto: Annotation<string | undefined>,
  perguntaAtualViaIA: Annotation<boolean | undefined>,
  perguntaAtualTokensTotal: Annotation<number | undefined>,
});
