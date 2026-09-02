import { interrupt, StateGraph, START, END } from "@langchain/langgraph";
import { type ViolenciaDomesticaStateType, ViolenciaDomesticaState } from "./state.js";
import type { Pergunta } from "../../shared/types.js";
import { prepararPergunta } from "../../ia/reescrever.js";
import { criarCheckpointer } from "../../shared/checkpointer.js";

// Esqueleto de fluxo — só 1 pergunta (relato livre) + conclusão. Existe pra
// provar a estrutura fluxos/<nome>/{graph,state}.ts com um 2º fluxo real
// plugado no registry (rotas/atendimentos.ts + app.ts), reaproveitando
// prepararPergunta/criarCheckpointer compartilhados. Perguntas de
// triagem/risco de verdade — as que fazem esse fluxo útil de fato — ainda
// não foram desenhadas.
async function prepararPerguntaRelato(): Promise<Partial<ViolenciaDomesticaStateType>> {
  return prepararPergunta("relato", "Pode me contar, com suas palavras, o que está acontecendo?");
}

async function pedirRelato(state: ViolenciaDomesticaStateType): Promise<Partial<ViolenciaDomesticaStateType>> {
  const resposta = interrupt<Pergunta, string>({
    pergunta: state.perguntaAtualTexto ?? "Pode me contar, com suas palavras, o que está acontecendo?",
    tipo: "texto",
  });
  return { relato: resposta };
}

async function concluir(): Promise<Partial<ViolenciaDomesticaStateType>> {
  return { statusFinal: "concluido" };
}

const grafo = new StateGraph(ViolenciaDomesticaState)
  .addNode("prepararPerguntaRelato", prepararPerguntaRelato)
  .addNode("pedirRelato", pedirRelato)
  .addNode("concluir", concluir)
  .addEdge(START, "prepararPerguntaRelato")
  .addEdge("prepararPerguntaRelato", "pedirRelato")
  .addEdge("pedirRelato", "concluir")
  .addEdge("concluir", END)
  .compile({ checkpointer: await criarCheckpointer() });

export { grafo };
