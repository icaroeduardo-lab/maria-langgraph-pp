import Fastify from "fastify";
import { Command } from "@langchain/langgraph";
import { grafo } from "./graph.js";

// Monta o Fastify sem chamar listen() — assim os testes usam app.inject()
// direto, sem precisar subir servidor de verdade numa porta. Quem quer
// rodar de verdade importa daqui e chama listen() (ver server.ts).
export function montarApp() {
  const app = Fastify();

  app.post("/mensagem", async (req, reply) => {
    const body = req.body as { chatId?: string; mensagem?: string };
    if (!body.chatId) return reply.code(400).send({ erro: "chatId obrigatório" });

    const config = { configurable: { thread_id: body.chatId } };
    const estadoAnterior = await grafo.getState(config);
    const isResuming = (estadoAnterior.next?.length ?? 0) > 0;

    // resume sempre como string crua — pras perguntas sim_nao, a Tykhe manda
    // literalmente "true"/"false" (não texto em português), e o nó
    // (pedirTemProcesso/pedirConfirmaNome em graph.ts) compara === "true".
    // Nada de resume:boolean aqui — Command({resume:false}) quebra no
    // LangGraph (bug real, ver comentário em graph.ts).
    const resultado = isResuming
      ? await grafo.invoke(new Command({ resume: body.mensagem ?? "" }), config)
      : await grafo.invoke({}, config);

    const interrupt = (resultado as { __interrupt__?: Array<{ value: { pergunta: string; tipo: string; opcoes?: string[] } }> })
      .__interrupt__?.[0]?.value;

    if (interrupt) {
      return { resposta: interrupt.pergunta, tipoResposta: interrupt.tipo, opcoes: interrupt.opcoes, status: "em_andamento" };
    }

    const status = (resultado as { statusFinal?: string }).statusFinal ?? "concluido";
    const mensagem =
      status === "concluido"
        ? "Show! Já confirmei os dados da pessoa presa. Vou seguir com o encaminhamento a partir daqui."
        : "Não consegui confirmar os dados da pessoa presa. Vou encaminhar seu atendimento pra equipe verificar com mais calma.";
    return { resposta: mensagem, tipoResposta: "texto", status };
  });

  return app;
}
