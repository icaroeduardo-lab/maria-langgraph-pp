import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { Command } from "@langchain/langgraph";
import { grafo } from "./graph.js";
import type { DadosApenado } from "./state.js";

interface InterruptValue {
  pergunta: string;
  tipo: string;
  opcoes?: string[];
}

interface Links {
  self: { href: string };
  responder?: { href: string; method: "POST" };
}

// Nível 3 de Richardson (HATEOAS): toda resposta carrega `_links` com as
// próximas ações válidas dado o estado ATUAL — não fixo por rota. Enquanto
// `em_andamento`, existe "responder"; concluído/handoff, só sobra "self"
// (não tem mais o que fazer nesse atendimento pela API). O cliente decide o
// que fazer olhando os links, não hardcoding regra de URL.
function montarLinks(chatId: string, status: string): Links {
  const links: Links = { self: { href: `/atendimentos/${chatId}` } };
  if (status === "em_andamento") {
    links.responder = { href: `/atendimentos/${chatId}/respostas`, method: "POST" };
  }
  return links;
}

interface MetadadosAtendimento {
  parentesco?: string;
  temProcesso?: boolean;
  numeroProcesso?: string;
  rg?: string;
  dadosApenado?: DadosApenado;
  motivoHandoff?: string;
}

interface RespostaAtendimento {
  resposta: string;
  tipoResposta: string;
  opcoes?: string[];
  status: string;
  // só presente quando status !== "em_andamento" — no meio da conversa os
  // dados ainda estão incompletos, não faz sentido a Tykhe consumir isso
  // antes do fluxo terminar. Em concluido/handoff_humano, é o que a Tykhe
  // precisa pra seguir (agendamento ou repassar pro atendente humano) sem
  // ter que reperguntar tudo de novo.
  metadados?: MetadadosAtendimento;
  _links: Links;
}

type ValoresAtendimento = Partial<PessoaPresaValores>;
interface PessoaPresaValores {
  statusFinal: string;
  parentesco: string;
  temProcesso: boolean;
  numeroProcesso: string;
  rg: string;
  dadosApenado: DadosApenado;
  motivoHandoff: string;
}

// Compartilhado entre POST /atendimentos, GET /atendimentos/:chatId e
// POST /atendimentos/:chatId/respostas — os 3 terminam no MESMO shape de
// resposta, só muda como chegam no `interrupt`/`values`.
function montarRespostaAtendimento(chatId: string, interrupt: InterruptValue | undefined, values: ValoresAtendimento): RespostaAtendimento {
  if (interrupt) {
    return {
      resposta: interrupt.pergunta,
      tipoResposta: interrupt.tipo,
      opcoes: interrupt.opcoes,
      status: "em_andamento",
      _links: montarLinks(chatId, "em_andamento"),
    };
  }
  const status = values.statusFinal ?? "concluido";
  const mensagem =
    status === "concluido"
      ? "Show! Já confirmei os dados da pessoa presa. Vou seguir com o encaminhamento a partir daqui."
      : "Não consegui confirmar os dados da pessoa presa. Vou encaminhar seu atendimento pra equipe verificar com mais calma.";
  const metadados: MetadadosAtendimento = {
    parentesco: values.parentesco,
    temProcesso: values.temProcesso,
    numeroProcesso: values.numeroProcesso,
    rg: values.rg,
    dadosApenado: values.dadosApenado,
    ...(values.motivoHandoff ? { motivoHandoff: values.motivoHandoff } : {}),
  };
  return { resposta: mensagem, tipoResposta: "texto", status, metadados, _links: montarLinks(chatId, status) };
}

function extrairInterruptDoInvoke(resultado: unknown): InterruptValue | undefined {
  return (resultado as { __interrupt__?: Array<{ value: InterruptValue }> }).__interrupt__?.[0]?.value;
}

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

  // POST /atendimentos — cria um atendimento novo (1ª pergunta do fluxo).
  // chatId vem no corpo (é a Tykhe quem atribui esse id, não nós) — SEMPRE
  // obrigatório (produção E desenvolvimento); só NODE_ENV=test relaxa (gera
  // UUID), pra facilitar teste sem inventar chatId toda hora.
  app.post("/atendimentos", async (req, reply) => {
    const body = req.body as { chatId?: string } | undefined;
    if (!body?.chatId && process.env.NODE_ENV !== "test") {
      return reply.code(400).send({ erro: "chatId obrigatório" });
    }
    const chatIdGerado = !body?.chatId;
    const chatId = body?.chatId || randomUUID();
    if (chatIdGerado) req.log.warn({ chatId }, "chatId ausente na requisição — gerado UUID (só permitido em NODE_ENV=test)");

    const config = { configurable: { thread_id: chatId } };
    req.log.info({ chatId }, "atendimento criado");
    const resultado = await grafo.invoke({}, config);

    const interrupt = extrairInterruptDoInvoke(resultado);
    const { perguntaAtualViaIA: viaIA, perguntaAtualTokensTotal: tokensTotal } = resultado as {
      perguntaAtualViaIA?: boolean;
      perguntaAtualTokensTotal?: number;
    };
    req.log.info({ chatId, tipoResposta: interrupt?.tipo, viaIA: viaIA ?? false, tokensTotal }, "pergunta enviada");

    reply.code(201).header("Location", `/atendimentos/${chatId}`);
    return montarRespostaAtendimento(chatId, interrupt, resultado as ValoresAtendimento);
  });

  // GET /atendimentos/:chatId — consulta o estado ATUAL, sem avançar nada
  // (não chama invoke, só lê o checkpoint). 404 se esse chatId nunca foi
  // criado (nunca teve um POST /atendimentos com esse id).
  app.get("/atendimentos/:chatId", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    const config = { configurable: { thread_id: chatId } };
    const estado = await grafo.getState(config);
    const interrupt = estado.tasks?.[0]?.interrupts?.[0]?.value as InterruptValue | undefined;
    const valores = (estado.values ?? {}) as ValoresAtendimento;
    const existe = !!interrupt || Object.keys(valores).length > 0;
    if (!existe) return reply.code(404).send({ erro: "atendimento não encontrado" });
    return montarRespostaAtendimento(chatId, interrupt, valores);
  });

  // POST /atendimentos/:chatId/respostas — envia uma resposta, avança o
  // fluxo. 409 se esse chatId não existe ou já concluiu (não tem pergunta
  // pendente esperando resposta) — HTTP status certo em vez de só um campo
  // `status` no corpo, é a diferença entre nível 2 e nível 3 do REST.
  app.post("/atendimentos/:chatId/respostas", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    const body = req.body as { resposta?: string } | undefined;

    const config = { configurable: { thread_id: chatId } };
    const estadoAnterior = await grafo.getState(config);
    const isResuming = (estadoAnterior.next?.length ?? 0) > 0;
    if (!isResuming) {
      return reply.code(409).send({ erro: "atendimento não existe ou já foi concluído — nada esperando resposta" });
    }
    req.log.info({ chatId }, "resposta recebida");

    // resume sempre como string crua — pras perguntas sim_nao, a Tykhe manda
    // literalmente "true"/"false" (não texto em português), e o nó
    // (pedirTemProcesso/pedirConfirmaNome em graph.ts) compara === "true".
    // Nada de resume:boolean aqui — Command({resume:false}) quebra no
    // LangGraph (bug real, ver comentário em graph.ts).
    const resultado = await grafo.invoke(new Command({ resume: body?.resposta ?? "" }), config);

    const interrupt = extrairInterruptDoInvoke(resultado);
    if (interrupt) {
      const { perguntaAtualViaIA: viaIA, perguntaAtualTokensTotal: tokensTotal } = resultado as {
        perguntaAtualViaIA?: boolean;
        perguntaAtualTokensTotal?: number;
      };
      req.log.info({ chatId, tipoResposta: interrupt.tipo, viaIA: viaIA ?? false, tokensTotal }, "pergunta enviada");
    } else {
      const status = (resultado as ValoresAtendimento).statusFinal ?? "concluido";
      req.log.info({ chatId, status }, "atendimento finalizado");
    }
    return montarRespostaAtendimento(chatId, interrupt, resultado as ValoresAtendimento);
  });

  return app;
}
