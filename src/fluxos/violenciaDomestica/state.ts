import { Annotation } from "@langchain/langgraph";
import type { DadosPessoa, DadosProcesso, OrgaosViolenciaDomestica } from "../../shared/types.js";
import { AnnotationTokensAcumulados } from "../../shared/tokensAcumulados.js";

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
  // evita perguntar de novo. Comum aos 2 ramos (com/sem RO) — os dois
  // precisam de idPessoa pra consultar órgão, ver graph.ts.
  cpf: Annotation<string | undefined>,
  dadosPessoa: Annotation<DadosPessoa | undefined>,
  // ids de plantão(ões) vigente(s) agora (consultarPlantaoVigente) — vazio
  // = fora de horário de plantão, usa consulta de órgão normal. Não vazio =
  // usa consultarOrgaosPlantaoViolenciaDomestica em vez da normal.
  plantaoIds: Annotation<number[] | undefined>,
  // resultado de UMA das duas consultas de órgão (normal ou plantão,
  // dependendo de plantaoIds) — o PRIMEIRO item de `orgaos` é sempre o
  // escolhido, Verde já devolve em ordem de prioridade.
  orgaosViolenciaDomestica: Annotation<OrgaosViolenciaDomestica | undefined>,
  // resultado de criarEncaminhamentoViolenciaDomestica (POST real no Verde)
  // — só roda depois de achar órgão. encaminhamentoId preenchido só quando
  // deu certo, vira "protocolo" na mensagem final.
  encaminhamentoId: Annotation<number | undefined>,
  encaminhamentoErro: Annotation<string | undefined>,
  statusFinal: Annotation<"concluido" | "handoff_humano" | undefined>,
  // só preenchido quando statusFinal:"handoff_humano". falha_encaminhamento
  // = achou o órgão certo mas o POST de encaminhamento de verdade falhou —
  // não inventa sucesso pro usuário, manda pra atendente confirmar.
  motivoHandoff: Annotation<"nao_e_vitima" | "sem_orgao_disponivel" | "falha_encaminhamento" | undefined>,
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
  // Soma de TODOS os tokens gastos com IA nesta conversa (issue #35) — ver
  // shared/tokensAcumulados.ts. tokensGastosTotal == entrada + saída sempre
  // (issue #69 — discrimina os 2 porque custam diferente no Bedrock).
  tokensGastosTotal: AnnotationTokensAcumulados(),
  tokensGastosEntrada: AnnotationTokensAcumulados(),
  tokensGastosSaida: AnnotationTokensAcumulados(),
});
