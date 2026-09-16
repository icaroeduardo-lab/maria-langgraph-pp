import { classificarMultiploEntreOpcoes, type ResultadoClassificacaoMultipla } from "./classificar.js";

export interface FluxoParaClassificar {
  id: string;
  nome: string;
  // ver FluxoConfig.descricao em fluxos/index.ts — cada fluxo novo só
  // precisa preencher isso pra já entrar na classificação automática.
  descricao: string;
}

// Classifica o relato livre entre os fluxos cadastrados — devolve TODOS os
// plausíveis (issue #28), não só 1: o orquestrador (src/orquestrador/graph.ts)
// decide o que fazer com 0 (handoff), 1 (segue direto) ou vários (pergunta
// pra desambiguar). Substitui a versão anterior (ia/classificarFluxo.ts,
// escolha única) — único chamador era rotas/orquestrador.ts, que agora usa
// o grafo do orquestrador em vez de chamar isso direto.
//
// A chamada real (prompt + IA) mora em ia/classificar.ts::classificarMultiploEntreOpcoes
// (núcleo reaproveitável, issue #8/#28) — este arquivo só monta o prompt
// específico de "escolher fluxo de atendimento" e mantém o guard de teste.
export async function classificarFluxosPlausiveis(mensagem: string, fluxos: FluxoParaClassificar[]): Promise<ResultadoClassificacaoMultipla> {
  // NODE_ENV=test nunca chama Bedrock de verdade — mesmo padrão do resto do
  // repo. MOCK_CLASSIFICACAO_FLOWIDS (plural, novo) é a lista completa de
  // ids plausíveis, separados por vírgula — testa o caminho de ambiguidade.
  // MOCK_CLASSIFICACAO_FLOWID (singular, já existia antes da issue #28)
  // continua funcionando como fallback — vira lista de 1 item, preserva os
  // testes antigos sem precisar reescrever todos pro nome novo.
  if (process.env.NODE_ENV === "test") {
    const mockIds = process.env.MOCK_CLASSIFICACAO_FLOWIDS;
    if (mockIds !== undefined) {
      const lista = mockIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return { ids: lista, viaIA: false };
    }
    const mockId = process.env.MOCK_CLASSIFICACAO_FLOWID;
    return { ids: mockId ? [mockId] : [], viaIA: false };
  }
  const ids = fluxos.map((f) => f.id);
  const descricoes = fluxos.map((f) => `- id "${f.id}" (${f.nome}): ${f.descricao}`).join("\n");
  const sistema = `Você tria o relato de alguém buscando atendimento na Defensoria Pública do RJ, decidindo quais fluxos de atendimento PODEM resolver o caso.
Fluxos disponíveis:
${descricoes}
Regras: devolva os ids de TODOS os fluxos que plausivelmente atendem ao relato — nenhum (lista vazia) se não bater com confiança em nenhum, 1 só se for claro, ou vários se o relato for genuinamente ambíguo entre mais de um. Nunca invente id fora da lista.`;
  return classificarMultiploEntreOpcoes(mensagem, sistema, ids);
}
