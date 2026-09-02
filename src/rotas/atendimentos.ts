import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Command } from "@langchain/langgraph";
import { buscarFluxo, type FluxoConfig } from "../fluxos/index.js";

export interface InterruptValue {
  pergunta: string;
  tipo: string;
  opcoes?: string[];
}

interface Links {
  self: { href: string };
  responder?: { href: string; method: "POST" };
}

interface RespostaAtendimento {
  resposta: string;
  tipoResposta: string;
  opcoes?: string[];
  status: string;
  metadados?: object;
  _links: Links;
}

type ValoresAtendimento = Record<string, unknown> & { statusFinal?: string };

// Contrato mínimo que qualquer grafo compilado do LangGraph precisa cumprir
// pra plugar nessas rotas — evita amarrar esse módulo aos generics internos
// do CompiledStateGraph (cada fluxo tem um state type diferente). Quem
// registra em fluxos/index.ts faz o cast.
export interface GrafoAtendimento {
  invoke(input: unknown, config: unknown): Promise<unknown>;
  getState(config: unknown): Promise<{
    tasks?: Array<{ interrupts?: Array<{ value: InterruptValue }> }>;
    values?: unknown;
    next?: unknown[];
  }>;
}

function montarLinks(fluxoId: string, chatId: string, status: string): Links {
  const links: Links = { self: { href: `/atendimentos/${fluxoId}/${chatId}` } };
  if (status === "em_andamento") {
    links.responder = { href: `/atendimentos/${fluxoId}/${chatId}/respostas`, method: "POST" };
  }
  return links;
}

function extrairInterruptDoInvoke(resultado: unknown): InterruptValue | undefined {
  return (resultado as { __interrupt__?: Array<{ value: InterruptValue }> }).__interrupt__?.[0]?.value;
}

const linksSchema = {
  type: "object",
  properties: {
    self: { type: "object", properties: { href: { type: "string" } } },
    responder: {
      type: "object",
      properties: { href: { type: "string" }, method: { type: "string", enum: ["POST"] } },
    },
  },
} as const;

const erroSchema = { type: "object", properties: { erro: { type: "string" } } } as const;

// metadados varia por fluxo — QUAL grafo (portanto qual schema exato) só se
// sabe em runtime, lendo :fluxoId. Docs ficam genéricas aqui (não dá pra
// declarar um schema fixo por rota quando a rota atende qualquer fluxo); ver
// fluxos/*/api.ts pro shape real de cada um.
const respostaAtendimentoSchema = {
  type: "object",
  properties: {
    resposta: { type: "string", description: "Texto da pergunta (se em_andamento) ou mensagem final" },
    tipoResposta: { type: "string", enum: ["texto", "sim_nao", "opcoes"] },
    opcoes: { type: "array", items: { type: "string" } },
    status: { type: "string", enum: ["em_andamento", "concluido", "handoff_humano"] },
    metadados: {
      type: "object",
      additionalProperties: true,
      description: "Shape depende do fluxo (:fluxoId, ver GET /fluxos) — só presente quando status !== em_andamento",
    },
    _links: linksSchema,
  },
} as const;

const paramsComFluxoSchema = {
  type: "object",
  properties: { fluxoId: { type: "string", format: "uuid", description: "Id do fluxo — ver GET /fluxos" } },
  required: ["fluxoId"],
} as const;

const paramsComFluxoEChatIdSchema = {
  type: "object",
  properties: {
    fluxoId: { type: "string", format: "uuid", description: "Id do fluxo — ver GET /fluxos" },
    chatId: { type: "string" },
  },
  required: ["fluxoId", "chatId"],
} as const;

// Compartilhado entre POST base, GET :chatId e POST :chatId/respostas — os
// 3 terminam no MESMO shape de resposta, só muda como chegam no
// `interrupt`/`values`.
function montarRespostaAtendimento(
  fluxo: FluxoConfig,
  fluxoId: string,
  chatId: string,
  interrupt: InterruptValue | undefined,
  values: ValoresAtendimento
): RespostaAtendimento {
  if (interrupt) {
    return {
      resposta: interrupt.pergunta,
      tipoResposta: interrupt.tipo,
      opcoes: interrupt.opcoes,
      status: "em_andamento",
      _links: montarLinks(fluxoId, chatId, "em_andamento"),
    };
  }
  const status = values.statusFinal ?? "concluido";
  const mensagem = status === "concluido" ? fluxo.mensagemConcluido : fluxo.mensagemHandoff;
  return {
    resposta: mensagem,
    tipoResposta: "texto",
    status,
    metadados: fluxo.extrairMetadados(values),
    _links: montarLinks(fluxoId, chatId, status),
  };
}

// Nível 3 de Richardson (HATEOAS): toda resposta carrega `_links` com as
// próximas ações válidas dado o estado ATUAL — não fixo por rota. Enquanto
// `em_andamento`, existe "responder"; concluído/handoff, só sobra "self".
//
// Rota é a MESMA pra qualquer fluxo — /atendimentos/:fluxoId/... — o
// :fluxoId (uuid, ver fluxos/index.ts) escolhe qual grafo/schema usar em
// runtime, via buscarFluxo(). Um fluxoId desconhecido dá 404 antes de
// qualquer coisa (não confundir com o 404 de chatId — motivos diferentes).
export function registrarRotasAtendimento(app: FastifyInstance): void {
  // POST /atendimentos/:fluxoId — cria um atendimento novo (1ª pergunta do
  // fluxo). chatId vem no corpo (é a Tykhe quem atribui esse id, não nós) —
  // SEMPRE obrigatório (produção E desenvolvimento); só NODE_ENV=test relaxa
  // (gera UUID), pra facilitar teste sem inventar chatId toda hora.
  app.post(
    "/atendimentos/:fluxoId",
    {
      schema: {
        tags: ["atendimentos"],
        security: [{ bearerAuth: [] }],
        summary: "Cria um atendimento novo (1ª pergunta do fluxo)",
        params: paramsComFluxoSchema,
        body: {
          type: "object",
          properties: { chatId: { type: "string", description: "Id atribuído pela Tykhe — obrigatório fora de NODE_ENV=test" } },
        },
        response: { 200: respostaAtendimentoSchema, 400: erroSchema, 404: erroSchema },
      },
    },
    async (req, reply) => {
      const { fluxoId } = req.params as { fluxoId: string };
      const fluxo = buscarFluxo(fluxoId);
      if (!fluxo) return reply.code(404).send({ erro: "fluxo não encontrado — ver GET /fluxos" });

      const body = req.body as { chatId?: string } | undefined;
      if (!body?.chatId && process.env.NODE_ENV !== "test") {
        return reply.code(400).send({ erro: "chatId obrigatório" });
      }
      const chatIdGerado = !body?.chatId;
      const chatId = body?.chatId || randomUUID();
      if (chatIdGerado) req.log.warn({ fluxoId, chatId }, "chatId ausente na requisição — gerado UUID (só permitido em NODE_ENV=test)");

      const config = { configurable: { thread_id: chatId } };

      // Idempotente: se esse chatId JÁ tem atendimento em andamento, devolve
      // o estado atual (igual ao GET) — NUNCA chama invoke({}) de novo. Bug
      // real achado ao vivo 2026-08-31: invoke({}) num thread_id existente
      // reinicia o grafo do zero, apagando todo o progresso da conversa se a
      // Tykhe chamar POST de novo (retry, reconexão) em vez de GET.
      const estadoAnterior = await fluxo.grafo.getState(config);
      const interruptAnterior = estadoAnterior.tasks?.[0]?.interrupts?.[0]?.value;
      const valoresAnteriores = (estadoAnterior.values ?? {}) as ValoresAtendimento;
      const jaExiste = !!interruptAnterior || Object.keys(valoresAnteriores).length > 0;

      if (jaExiste) {
        req.log.warn({ fluxoId, chatId }, "POST em chatId que já existe — devolvendo estado atual, sem reiniciar");
        reply.code(200).header("Location", `/atendimentos/${fluxoId}/${chatId}`);
        return montarRespostaAtendimento(fluxo, fluxoId, chatId, interruptAnterior, valoresAnteriores);
      }

      req.log.info({ fluxoId, chatId }, "atendimento criado");
      const resultado = await fluxo.grafo.invoke({}, config);

      const interrupt = extrairInterruptDoInvoke(resultado);
      const { perguntaAtualViaIA: viaIA, perguntaAtualTokensTotal: tokensTotal } = resultado as {
        perguntaAtualViaIA?: boolean;
        perguntaAtualTokensTotal?: number;
      };
      req.log.info({ fluxoId, chatId, tipoResposta: interrupt?.tipo, viaIA: viaIA ?? false, tokensTotal }, "pergunta enviada");

      // 200, não 201 — a Tykhe só reconhece 200 como padrão de sucesso
      // (pedido explícito, evita trabalho extra do lado deles). Abre mão do
      // 201/Location "correto" do REST nível 3 em troca de compatibilidade
      // com o consumidor real.
      reply.code(200).header("Location", `/atendimentos/${fluxoId}/${chatId}`);
      return montarRespostaAtendimento(fluxo, fluxoId, chatId, interrupt, resultado as ValoresAtendimento);
    }
  );

  // GET /atendimentos/:fluxoId/:chatId — consulta o estado ATUAL, sem
  // avançar nada (não chama invoke, só lê o checkpoint). 404 se esse
  // fluxoId/chatId nunca foi criado.
  app.get(
    "/atendimentos/:fluxoId/:chatId",
    {
      schema: {
        tags: ["atendimentos"],
        security: [{ bearerAuth: [] }],
        summary: "Consulta o estado atual (sem avançar o fluxo)",
        params: paramsComFluxoEChatIdSchema,
        response: { 200: respostaAtendimentoSchema, 404: erroSchema },
      },
    },
    async (req, reply) => {
      const { fluxoId, chatId } = req.params as { fluxoId: string; chatId: string };
      const fluxo = buscarFluxo(fluxoId);
      if (!fluxo) return reply.code(404).send({ erro: "fluxo não encontrado — ver GET /fluxos" });

      const config = { configurable: { thread_id: chatId } };
      const estado = await fluxo.grafo.getState(config);
      const interrupt = estado.tasks?.[0]?.interrupts?.[0]?.value;
      const valores = (estado.values ?? {}) as ValoresAtendimento;
      const existe = !!interrupt || Object.keys(valores).length > 0;
      if (!existe) return reply.code(404).send({ erro: "atendimento não encontrado" });
      return montarRespostaAtendimento(fluxo, fluxoId, chatId, interrupt, valores);
    }
  );

  // POST /atendimentos/:fluxoId/:chatId/respostas — envia uma resposta,
  // avança o fluxo. 409 se esse chatId não existe ou já concluiu (não tem
  // pergunta pendente esperando resposta) — HTTP status certo em vez de só
  // um campo `status` no corpo, é a diferença entre nível 2 e nível 3 do
  // REST.
  app.post(
    "/atendimentos/:fluxoId/:chatId/respostas",
    {
      schema: {
        tags: ["atendimentos"],
        security: [{ bearerAuth: [] }],
        summary: "Envia uma resposta, avança o fluxo pra próxima pergunta (ou conclui)",
        params: paramsComFluxoEChatIdSchema,
        body: {
          type: "object",
          properties: {
            resposta: { type: "string", description: "\"true\"/\"false\" pra sim_nao, texto livre pras demais" },
          },
        },
        response: { 200: respostaAtendimentoSchema, 404: erroSchema, 409: erroSchema },
      },
    },
    async (req, reply) => {
      const { fluxoId, chatId } = req.params as { fluxoId: string; chatId: string };
      const fluxo = buscarFluxo(fluxoId);
      if (!fluxo) return reply.code(404).send({ erro: "fluxo não encontrado — ver GET /fluxos" });

      const body = req.body as { resposta?: string } | undefined;

      const config = { configurable: { thread_id: chatId } };
      const estadoAnterior = await fluxo.grafo.getState(config);
      const isResuming = (estadoAnterior.next?.length ?? 0) > 0;
      if (!isResuming) {
        return reply.code(409).send({ erro: "atendimento não existe ou já foi concluído — nada esperando resposta" });
      }
      req.log.info({ fluxoId, chatId }, "resposta recebida");

      // resume sempre como string crua — pras perguntas sim_nao, a Tykhe
      // manda literalmente "true"/"false" (não texto em português), e o nó
      // compara === "true"/normaliza. Nada de resume:boolean aqui —
      // Command({resume:false}) quebra no LangGraph.
      const resultado = await fluxo.grafo.invoke(new Command({ resume: body?.resposta ?? "" }), config);

      const interrupt = extrairInterruptDoInvoke(resultado);
      if (interrupt) {
        const { perguntaAtualViaIA: viaIA, perguntaAtualTokensTotal: tokensTotal } = resultado as {
          perguntaAtualViaIA?: boolean;
          perguntaAtualTokensTotal?: number;
        };
        req.log.info({ fluxoId, chatId, tipoResposta: interrupt.tipo, viaIA: viaIA ?? false, tokensTotal }, "pergunta enviada");
      } else {
        const status = (resultado as ValoresAtendimento).statusFinal ?? "concluido";
        req.log.info({ fluxoId, chatId, status }, "atendimento finalizado");
      }
      return montarRespostaAtendimento(fluxo, fluxoId, chatId, interrupt, resultado as ValoresAtendimento);
    }
  );
}
