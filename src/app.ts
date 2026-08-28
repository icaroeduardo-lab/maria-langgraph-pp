import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { Command } from "@langchain/langgraph";
import { grafo } from "./graph.js";

// Monta o Fastify sem chamar listen() — assim os testes usam app.inject()
// direto, sem precisar subir servidor de verdade numa porta. Quem quer
// rodar de verdade importa daqui e chama listen() (ver server.ts).
export function montarApp() {
  // logger:true liga o pino (padrão do Fastify) — cada linha sai em JSON,
  // com `reqId` gerado automático (correlação por REQUISIÇÃO — trocado pra
  // UUID em vez do padrão sequencial "req-1"/"req-2", que reseta a cada
  // restart do processo e pode colidir/confundir em logs agregados de
  // múltiplas instâncias). Como uma conversa é várias requisições separadas
  // no tempo, incluímos `chatId` manualmente em todo log — é ele que
  // correlaciona TODAS as chamadas de uma mesma conversa entre si (reqId
  // sozinho não faz isso, é só por requisição individual).
  const app = Fastify({ logger: true, genReqId: () => randomUUID() });

  app.post("/mensagem", async (req, reply) => {
    const body = req.body as { chatId?: string; mensagem?: string };
    // chatId é obrigatório SEMPRE (produção E desenvolvimento) — é a Tykhe
    // quem manda, contrato real, sem gerar UUID escondido pra disfarçar um
    // erro dela. Só NODE_ENV=test relaxa isso (gera UUID), pra facilitar
    // teste automatizado/manual sem precisar inventar chatId toda hora —
    // ver test/server.test.ts.
    if (!body.chatId) {
      if (process.env.NODE_ENV !== "test") {
        return reply.code(400).send({ erro: "chatId obrigatório" });
      }
    }
    const chatIdGerado = !body.chatId;
    const chatId = body.chatId || randomUUID();
    if (chatIdGerado) req.log.warn({ chatId }, "chatId ausente na requisição — gerado UUID (só permitido em NODE_ENV=test)");

    const config = { configurable: { thread_id: chatId } };
    const estadoAnterior = await grafo.getState(config);
    const isResuming = (estadoAnterior.next?.length ?? 0) > 0;
    req.log.info({ chatId, isResuming }, "mensagem recebida");

    // resume sempre como string crua — pras perguntas sim_nao, a Tykhe manda
    // literalmente "true"/"false" (não texto em português), e o nó
    // (pedirTemProcesso/pedirConfirmaNome em graph.ts) compara === "true".
    // Nada de resume:boolean aqui — Command({resume:false}) quebra no
    // LangGraph (bug real, ver comentário em graph.ts).
    const resultado = isResuming
      ? await grafo.invoke(new Command({ resume: body.mensagem ?? "" }), config)
      : await grafo.invoke({}, config);

    const interrupt = (
      resultado as { __interrupt__?: Array<{ value: { pergunta: string; tipo: string; opcoes?: string[] } }> }
    ).__interrupt__?.[0]?.value;

    if (interrupt) {
      // perguntaParentescoViaIA/Tokens só existem no state depois que
      // prepararPerguntaParentesco rodou (única pergunta reescrita por IA
      // hoje) — undefined pras outras 5 perguntas, ainda fixas.
      const { perguntaParentescoViaIA: viaIA, perguntaParentescoTokensTotal: tokensTotal } = resultado as {
        perguntaParentescoViaIA?: boolean;
        perguntaParentescoTokensTotal?: number;
      };
      req.log.info({ chatId, tipoResposta: interrupt.tipo, viaIA: viaIA ?? false, tokensTotal }, "pergunta enviada");
      return { resposta: interrupt.pergunta, tipoResposta: interrupt.tipo, opcoes: interrupt.opcoes, status: "em_andamento" };
    }

    const status = (resultado as { statusFinal?: string }).statusFinal ?? "concluido";
    const mensagem =
      status === "concluido"
        ? "Show! Já confirmei os dados da pessoa presa. Vou seguir com o encaminhamento a partir daqui."
        : "Não consegui confirmar os dados da pessoa presa. Vou encaminhar seu atendimento pra equipe verificar com mais calma.";
    req.log.info({ chatId, status }, "conversa finalizada");
    return { resposta: mensagem, tipoResposta: "texto", status };
  });

  return app;
}
