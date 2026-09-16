// Shape do campo `metadados` pra este fluxo — mesmo padrão dos outros
// fluxos/*/api.ts. Não coleta nada (o grafo conclui sem perguntar), então
// fica vazio — existe só pra bater o contrato de FluxoConfig.
export interface MetadadosPadrao {
  [key: string]: never;
}

export const metadadosSchemaPadrao = {
  type: "object",
  properties: {},
} as const;

export function extrairMetadadosPadrao(): MetadadosPadrao {
  return {};
}

// Mensagem única — cobre qualquer categoria planejada que caia neste grafo
// (issue #21). Texto revisável depois com uso real; ajustes específicos por
// categoria (ex: RECLAMAÇÃO TRABALHISTA/LOAS redirecionando pra outro órgão
// em vez de "em construção", ver issues #22/#23) ficam pra depois.
export const MENSAGEM_CONCLUIDO =
  "Esse tipo de atendimento ainda está sendo construído na Maria. Por enquanto, vou encaminhar você pra um canal de atendimento alternativo.";

// Nunca deveria disparar de verdade (este grafo só tem desfecho "concluido"),
// mas FluxoConfig exige o campo — texto genérico de segurança.
export const MENSAGEM_HANDOFF = "Vou encaminhar seu atendimento para um atendente humano.";
