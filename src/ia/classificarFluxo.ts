import { classificarEntreOpcoes } from "./classificar.js";

export interface FluxoParaClassificar {
  id: string;
  nome: string;
  // ver FluxoConfig.descricao em fluxos/index.ts — cada fluxo novo só
  // precisa preencher isso pra entrar na classificação automaticamente,
  // sem tocar neste arquivo.
  descricao: string;
}

export interface ResultadoClassificacao {
  // undefined = não identificado — a IA achou "nenhum" fluxo bater com
  // confiança, ou a chamada falhou. rotas/orquestrador.ts trata isso como
  // handoff_humano, nunca "chuta" um fluxo errado.
  flowId: string | undefined;
  viaIA: boolean;
}

// Classifica o relato livre num dos fluxos cadastrados — usado só pela rota
// do orquestrador (rotas/orquestrador.ts), que existe ao LADO da criação
// manual (POST /atendimentos com flowId explícito, que continua igual).
//
// A chamada real (prompt + IA) mora em ia/classificar.ts::classificarEntreOpcoes
// (núcleo reaproveitável, issue #8) — este arquivo só monta o prompt
// específico de "escolher fluxo de atendimento" e mantém o guard de teste.
export async function classificarFluxo(mensagem: string, fluxos: FluxoParaClassificar[]): Promise<ResultadoClassificacao> {
  // NODE_ENV=test nunca chama Bedrock de verdade — mesmo padrão de
  // ia/reescrever.ts e ia/extrair.ts (suíte rápida, sem custo, sem
  // variabilidade). MOCK_CLASSIFICACAO_FLOWID deixa o teste escolher o
  // resultado (vazio/ausente = "nenhum", igual à IA responder "nenhum").
  if (process.env.NODE_ENV === "test") {
    const mockId = process.env.MOCK_CLASSIFICACAO_FLOWID;
    return { flowId: mockId || undefined, viaIA: false };
  }
  const ids = fluxos.map((f) => f.id);
  const descricoes = fluxos.map((f) => `- id "${f.id}" (${f.nome}): ${f.descricao}`).join("\n");
  const sistema = `Você tria o relato de alguém buscando atendimento na Defensoria Pública do RJ, escolhendo qual fluxo de atendimento resolve o caso.
Fluxos disponíveis:
${descricoes}
Regras: escolha "nenhum" se o relato não bater CLARAMENTE com nenhuma descrição acima — nunca force um encaixe, nunca invente. Ambiguidade real (ex: pode ser mais de um fluxo) também é "nenhum".`;
  const resultado = await classificarEntreOpcoes(mensagem, sistema, ids);
  return { flowId: resultado.escolhaId, viaIA: resultado.viaIA };
}
