export interface MetadadosViolenciaDomestica {
  relato?: string;
}

export const metadadosSchemaViolenciaDomestica = {
  type: "object",
  properties: {
    relato: { type: "string" },
  },
} as const;

export function extrairMetadadosViolenciaDomestica(values: Record<string, unknown>): MetadadosViolenciaDomestica {
  const v = values as { relato?: string };
  return { relato: v.relato };
}

// Textos provisórios — sem status de handoff desenhado ainda (esqueleto só
// tem o caminho "concluido").
export const MENSAGEM_CONCLUIDO = "Obrigada por compartilhar. Vou seguir com o encaminhamento a partir daqui.";
export const MENSAGEM_HANDOFF = "Vou encaminhar seu atendimento pra equipe.";
