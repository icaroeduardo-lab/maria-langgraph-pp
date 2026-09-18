import { Annotation } from "@langchain/langgraph";
import type { DadosPessoa, DadosProcesso, OrgaosViolenciaDomestica } from "../../shared/types.js";
import { AnnotationTokensGastos } from "../../shared/tokensAcumulados.js";

export type ViolenciaDomesticaStateType = typeof ViolenciaDomesticaState.State;

export const ViolenciaDomesticaState = Annotation.Root({
  ehVitima: Annotation<boolean | undefined>,
  temProcesso: Annotation<boolean | undefined>,
  numeroProcesso: Annotation<string | undefined>,
  // consulta informativa (não trava o fluxo) — mesmo padrão de
  // fluxos/pessoaPresa/state.ts.
  dadosProcesso: Annotation<DadosProcesso | undefined>,
  // Issue #75 — até 3 tentativas se o processo não for encontrado, mesmo
  // padrão de tentativasCpf/tentativasRg. Diferente de CPF/RG: desistir
  // NÃO vira handoff (processo é só informativo) — só segue o fluxo sem
  // o número confirmado.
  tentativasProcesso: Annotation<number | undefined>,
  querTentarNovamenteProcesso: Annotation<boolean | undefined>,
  // Issue #77 — mesmo racional de digitouCpfDireto, pro número de processo.
  digitouProcessoDireto: Annotation<boolean | undefined>,
  temRegistroOcorrencia: Annotation<boolean | undefined>,
  // vem pronto no `dadosConhecidos` do POST /atendimentos (contrato Tykhe:
  // { cpf, idPessoa, nome, email }) — ver rotas/atendimentos.ts. Bypass
  // evita perguntar de novo. Comum aos 2 ramos (com/sem RO) — os dois
  // precisam de idPessoa pra consultar órgão, ver graph.ts.
  cpf: Annotation<string | undefined>,
  dadosPessoa: Annotation<DadosPessoa | undefined>,
  // Issue #72 — quantas vezes já tentou consultar o CPF (incrementado em
  // consultarPessoa a cada chamada) — dá até 3 tentativas antes de desistir,
  // mesmo padrão de tentativasRg em pessoaPresa/state.ts.
  tentativasCpf: Annotation<number | undefined>,
  querTentarNovamenteCpf: Annotation<boolean | undefined>,
  // Issue #77 — CPF digitado direto na pergunta "quer tentar de novo?" (em
  // vez de "Sim") já é reconhecido pelo formato, mesmo padrão de
  // digitouRgDireto em pessoaPresa/state.ts (issue #54).
  digitouCpfDireto: Annotation<boolean | undefined>,
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
  // cpf_nao_encontrado (issue #72) = esgotou as 3 tentativas de CPF sem
  // achar a pessoa — motivo específico, não confunde com "sem_orgao_disponivel"
  // (que é pra pessoa ENCONTRADA sem órgão disponível pra ela).
  motivoHandoff: Annotation<"nao_e_vitima" | "sem_orgao_disponivel" | "falha_encaminhamento" | "cpf_nao_encontrado" | undefined>,
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
  // Soma de TODOS os tokens gastos com IA nesta conversa (issue #35),
  // discriminando entrada/saída (issue #69) — issue #92 agrupa os 3 num
  // objeto único em vez de 3 campos soltos. Ver shared/tokensAcumulados.ts.
  tokensGastos: AnnotationTokensGastos(),
});
