import { Annotation } from "@langchain/langgraph";
import type { DadosPessoa, DadosProcesso, OrgaosViolenciaDomestica } from "../../shared/types.js";

export type ViolenciaDomesticaStateType = typeof ViolenciaDomesticaState.State;

export const ViolenciaDomesticaState = Annotation.Root({
  ehVitima: Annotation<boolean | undefined>,
  temProcesso: Annotation<boolean | undefined>,
  numeroProcesso: Annotation<string | undefined>,
  // consulta informativa (não trava o fluxo) — mesmo padrão de
  // fluxos/pessoaPresa/state.ts.
  dadosProcesso: Annotation<DadosProcesso | undefined>,
  temRegistroOcorrencia: Annotation<boolean | undefined>,
  // vem pronto no `dadosConhecidos` do POST /atendimentos (contrato Tykhe:
  // { cpf, idPessoa, nome, email }) — ver rotas/atendimentos.ts. Bypass
  // evita perguntar de novo. Agora comum aos 2 ramos (com/sem RO) — os dois
  // precisam de idPessoa pra consultar órgão, ver graph.ts.
  cpf: Annotation<string | undefined>,
  dadosPessoa: Annotation<DadosPessoa | undefined>,
  // resultado de consultarOrgaosViolenciaDomestica (integracoes/verde.ts) —
  // o PRIMEIRO item de `orgaos` é sempre o escolhido pra mensagem final,
  // Verde já devolve em ordem de prioridade.
  orgaosViolenciaDomestica: Annotation<OrgaosViolenciaDomestica | undefined>,
  statusFinal: Annotation<"concluido" | "handoff_humano" | undefined>,
  // só preenchido quando statusFinal:"handoff_humano".
  motivoHandoff: Annotation<"nao_e_vitima" | "sem_orgao_disponivel" | undefined>,
  // só preenchido quando statusFinal:"concluido".
  tipoEncaminhamento: Annotation<"padrao" | "urgente" | undefined>,
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
