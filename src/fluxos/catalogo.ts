// Fluxos que a Maria já sabe RECONHECER pelo relato (entram na
// classificação do orquestrador, ver rotas/orquestrador.ts), mas que ainda
// NÃO têm código implementado (fluxos/<nome>/graph.ts, registro em
// fluxosPorId). Quando a IA escolhe um destes, o orquestrador não tem grafo
// pra rodar — cai em handoff_humano, mas loga qual fluxo foi identificado.
//
// Serve pra medir demanda real ANTES de codar: dá pra consultar os logs
// (motivo "fluxo_nao_implementado") e saber qual fluxo pedir prioridade de
// implementação, sem precisar já ter o código pronto de todos os fluxos
// planejados pra começar a aprender com o uso real.
//
// Pra "ativar" um fluxo planejado: implementa fluxos/<nome>/{graph,state,api}.ts
// normal, registra em fluxosPorId (fluxos/index.ts) — e REMOVE a entrada
// correspondente daqui (senão fica duplicado nos dois catálogos).
export interface FluxoPlanejado {
  id: string;
  nome: string;
  descricao: string;
}

export const fluxosPlanejados: FluxoPlanejado[] = [
  // exemplo (preencher conforme a lista real de fluxos chegar):
  // { id: "<uuid-novo>", nome: "pensao-alimenticia", descricao: "..." },
];
