import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { Command } from "@langchain/langgraph";
import { buscarFluxo, type FluxoConfig } from "../fluxos/index.js";
import { obterAtendimentosStore } from "../shared/atendimentosDb.js";

export interface InterruptValue {
  pergunta: string;
  tipo: string;
  opcoes?: string[];
}

interface Links {
  self: { href: string };
  responder?: { href: string; method: "POST" };
}

export interface RespostaAtendimento {
  resposta: string;
  tipoResposta: string;
  opcoes?: string[];
  status: string;
  metadados?: object;
  _links: Links;
}

type ValoresAtendimento = Record<string, unknown> & { statusFinal?: string; mensagemFinal?: string };

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

// Nem self nem responder carregam flowId — a tabela `atendimentos`
// (shared/atendimentosDb.ts) resolve flowId a partir do chatId sozinha, GET
// e POST /respostas não precisam mais que o cliente mande de novo.
function montarLinks(chatId: string, status: string): Links {
  const links: Links = { self: { href: `/atendimentos/${chatId}` } };
  if (status === "em_andamento") {
    links.responder = { href: `/atendimentos/respostas`, method: "POST" };
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
// sabe em runtime, lendo flowId. Docs ficam genéricas aqui (não dá pra
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
      description: "Shape depende do fluxo (flowId, ver GET /fluxos) — só presente quando status !== em_andamento",
    },
    _links: linksSchema,
  },
} as const;

const flowIdSchema = { type: "string", format: "uuid", description: "Id do fluxo — ver GET /fluxos" } as const;

const paramsComChatIdSchema = {
  type: "object",
  properties: { chatId: { type: "string" } },
  required: ["chatId"],
} as const;

// Compartilhado entre POST base, GET :chatId e POST /respostas — os 3
// terminam no MESMO shape de resposta, só muda como chegam no
// `interrupt`/`values`.
function montarRespostaAtendimento(
  fluxo: FluxoConfig,
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
      _links: montarLinks(chatId, "em_andamento"),
    };
  }
  const status = values.statusFinal ?? "concluido";
  // mensagemFinal (opcional, por fluxo) sobrescreve o texto genérico — usado
  // por fluxos com mais de 1 desfecho possível de "concluido"/"handoff_humano"
  // (ex: violenciaDomestica, que tem 3 tipos de encaminhamento com mensagens
  // diferentes — ver fluxos/violenciaDomestica/graph.ts). Ausente (undefined),
  // cai no texto único fluxo.mensagemConcluido/mensagemHandoff — comportamento
  // idêntico a antes desse campo existir (pessoaPresa nunca seta isso).
  const mensagem = values.mensagemFinal ?? (status === "concluido" ? fluxo.mensagemConcluido : fluxo.mensagemHandoff);
  return {
    resposta: mensagem,
    tipoResposta: "texto",
    status,
    metadados: fluxo.extrairMetadados(values),
    _links: montarLinks(chatId, status),
  };
}

export type ResultadoCriarAtendimento =
  | { statusCode: 400 | 409; corpo: { erro: string } }
  | { statusCode: 200; corpo: RespostaAtendimento; location: string };

// Núcleo de "criar (ou retomar) um atendimento" — extraído pra ser
// reaproveitado tanto pela criação manual (POST /atendimentos, flowId
// explícito) quanto pelo orquestrador (rotas/orquestrador.ts, flowId vem de
// classificação por IA a partir de texto livre). As duas rotas resolvem
// fluxoId de um jeito diferente, mas a partir daí o comportamento é
// idêntico — idempotência, registro na tabela chatId→flowId, tudo aqui.
export async function criarAtendimento(
  fluxo: FluxoConfig,
  fluxoId: string,
  chatIdBody: string | undefined,
  dadosConhecidos: Record<string, unknown> | undefined,
  log: FastifyBaseLogger
): Promise<ResultadoCriarAtendimento> {
  if (!chatIdBody && process.env.NODE_ENV !== "test") {
    return { statusCode: 400, corpo: { erro: "chatId obrigatório" } };
  }
  const chatIdGerado = !chatIdBody;
  const chatId = chatIdBody || randomUUID();
  if (chatIdGerado) log.warn({ fluxoId, chatId }, "chatId ausente na requisição — gerado UUID (só permitido em NODE_ENV=test)");

  // Registra chatId→flowId ANTES de tocar no grafo — se esse chatId já
  // pertence a outro flowId, 409 aqui, sem chegar perto do checkpoint (ver
  // comentário grande em registrarRotasAtendimento). Mesmo chatId+flowId de
  // novo é idempotente (ok:true), cai no fluxo normal abaixo — que já sabe
  // lidar com "chatId já existe" via getState.
  const store = await obterAtendimentosStore();
  const registro = await store.registrar(chatId, fluxoId);
  if (!registro.ok) {
    log.warn({ chatId, fluxoId, flowIdExistente: registro.flowIdExistente }, "chatId já pertence a outro flowId");
    return { statusCode: 409, corpo: { erro: `chatId já está em uso pelo flowId ${registro.flowIdExistente}` } };
  }

  // fluxoId vai junto no configurable — é isso que deixa contextoAtual()
  // (shared/contexto.ts) correlacionar os logs de dentro dos nós do grafo
  // (verde.ts/reescrever.ts/extrair.ts) com o fluxo certo, além do chatId
  // (thread_id).
  const config = { configurable: { thread_id: chatId, fluxoId } };

  // Idempotente: se esse chatId JÁ tem atendimento em andamento, devolve o
  // estado atual (igual ao GET) — NUNCA chama invoke({}) de novo. Bug real
  // achado ao vivo 2026-08-31: invoke({}) num thread_id existente reinicia
  // o grafo do zero, apagando todo o progresso da conversa se a Tykhe
  // chamar POST de novo (retry, reconexão) em vez de GET.
  const estadoAnterior = await fluxo.grafo.getState(config);
  const interruptAnterior = estadoAnterior.tasks?.[0]?.interrupts?.[0]?.value;
  const valoresAnteriores = (estadoAnterior.values ?? {}) as ValoresAtendimento;
  const jaExiste = !!interruptAnterior || Object.keys(valoresAnteriores).length > 0;

  if (jaExiste) {
    log.warn({ fluxoId, chatId }, "POST em chatId que já existe — devolvendo estado atual, sem reiniciar");
    return {
      statusCode: 200,
      location: `/atendimentos/${chatId}`,
      corpo: montarRespostaAtendimento(fluxo, chatId, interruptAnterior, valoresAnteriores),
    };
  }

  log.info({ fluxoId, chatId }, "atendimento criado");
  const resultado = await fluxo.grafo.invoke(dadosConhecidos ?? {}, config);

  const interrupt = extrairInterruptDoInvoke(resultado);
  const { perguntaAtualViaIA: viaIA, perguntaAtualTokensTotal: tokensTotal } = resultado as {
    perguntaAtualViaIA?: boolean;
    perguntaAtualTokensTotal?: number;
  };
  log.info({ fluxoId, chatId, tipoResposta: interrupt?.tipo, viaIA: viaIA ?? false, tokensTotal }, "pergunta enviada");

  return {
    statusCode: 200,
    location: `/atendimentos/${chatId}`,
    corpo: montarRespostaAtendimento(fluxo, chatId, interrupt, resultado as ValoresAtendimento),
  };
}

// Nível 3 de Richardson (HATEOAS): toda resposta carrega `_links` com as
// próximas ações válidas dado o estado ATUAL — não fixo por rota. Enquanto
// `em_andamento`, existe "responder"; concluído/handoff, só sobra "self".
//
// Rota é a MESMA pra qualquer fluxo — /atendimentos/... — flowId (uuid, ver
// fluxos/index.ts) escolhe o grafo. Só é OBRIGATÓRIO na criação (é o único
// momento em que o servidor não tem como saber sozinho qual fluxo é); GET e
// POST /respostas resolvem flowId a partir do chatId via a tabela
// `atendimentos` (shared/atendimentosDb.ts) — decisão de design 2026-09-02,
// depois de identificar que o checkpointer do LangGraph indexa só por
// thread_id=chatId, sem separar por fluxo: sem essa tabela, o mesmo chatId
// usado em 2 flowIds diferentes colidiria no mesmo checkpoint. A chave
// primária chat_id da tabela bloqueia esse caso na criação (ver 409 abaixo).
export function registrarRotasAtendimento(app: FastifyInstance): void {
  // POST /atendimentos — cria um atendimento novo (1ª pergunta do fluxo).
  // chatId vem no corpo (é a Tykhe quem atribui esse id, não nós) — SEMPRE
  // obrigatório (produção E desenvolvimento); só NODE_ENV=test relaxa (gera
  // UUID), pra facilitar teste sem inventar chatId toda hora. flowId é
  // sempre obrigatório, em qualquer ambiente.
  app.post(
    "/atendimentos",
    {
      schema: {
        tags: ["atendimentos"],
        security: [{ bearerAuth: [] }],
        summary: "Cria um atendimento novo (1ª pergunta do fluxo)",
        body: {
          type: "object",
          properties: {
            chatId: { type: "string", description: "Id atribuído pela Tykhe — obrigatório fora de NODE_ENV=test" },
            flowId: flowIdSchema,
            dadosConhecidos: {
              type: "object",
              additionalProperties: true,
              description:
                "Campos que a Tykhe já sabe sobre quem está conversando (ex: cpf, idPessoa, nome, email) — pré-preenche o state inicial do grafo pra evitar perguntar de novo o que já é conhecido. Cada fluxo só lê os campos que declara no próprio state (fluxos/<nome>/state.ts); os demais são ignorados.",
            },
          },
        },
        response: { 200: respostaAtendimentoSchema, 400: erroSchema, 404: erroSchema, 409: erroSchema },
      },
    },
    async (req, reply) => {
      const body = req.body as
        | { chatId?: string; flowId?: string; dadosConhecidos?: Record<string, unknown> }
        | undefined;

      const fluxoId = body?.flowId;
      if (!fluxoId) return reply.code(400).send({ erro: "flowId obrigatório" });
      const fluxo = buscarFluxo(fluxoId);
      if (!fluxo) return reply.code(404).send({ erro: "fluxo não encontrado — ver GET /fluxos" });

      const resultado = await criarAtendimento(fluxo, fluxoId, body?.chatId, body?.dadosConhecidos, req.log);
      if (resultado.statusCode !== 200) return reply.code(resultado.statusCode).send(resultado.corpo);
      // 200, não 201 — a Tykhe só reconhece 200 como padrão de sucesso
      // (pedido explícito, evita trabalho extra do lado deles). Abre mão do
      // 201/Location "correto" do REST nível 3 em troca de compatibilidade
      // com o consumidor real.
      return reply.code(200).header("Location", resultado.location).send(resultado.corpo);
    }
  );

  // GET /atendimentos/:chatId — consulta o estado ATUAL, sem avançar nada
  // (não chama invoke, só lê o checkpoint). flowId vem da tabela
  // `atendimentos` a partir do chatId — 404 se esse chatId nunca foi criado.
  app.get(
    "/atendimentos/:chatId",
    {
      schema: {
        tags: ["atendimentos"],
        security: [{ bearerAuth: [] }],
        summary: "Consulta o estado atual (sem avançar o fluxo)",
        params: paramsComChatIdSchema,
        response: { 200: respostaAtendimentoSchema, 404: erroSchema },
      },
    },
    async (req, reply) => {
      const { chatId } = req.params as { chatId: string };
      const store = await obterAtendimentosStore();
      const fluxoId = await store.buscarFlowId(chatId);
      if (!fluxoId) return reply.code(404).send({ erro: "atendimento não encontrado" });
      const fluxo = buscarFluxo(fluxoId);
      if (!fluxo) return reply.code(404).send({ erro: "fluxo não encontrado — ver GET /fluxos" });

      // fluxoId vai junto no configurable — é isso que deixa contextoAtual()
      // (shared/contexto.ts) correlacionar os logs de dentro dos nós do
      // grafo (verde.ts/reescrever.ts/extrair.ts) com o fluxo certo, além
      // do chatId (thread_id).
      const config = { configurable: { thread_id: chatId, fluxoId } };
      const estado = await fluxo.grafo.getState(config);
      const interrupt = estado.tasks?.[0]?.interrupts?.[0]?.value;
      const valores = (estado.values ?? {}) as ValoresAtendimento;
      const existe = !!interrupt || Object.keys(valores).length > 0;
      if (!existe) return reply.code(404).send({ erro: "atendimento não encontrado" });
      return montarRespostaAtendimento(fluxo, chatId, interrupt, valores);
    }
  );

  // POST /atendimentos/respostas — envia uma resposta, avança o fluxo.
  // chatId vai no BODY (não na URL); flowId vem da tabela `atendimentos` a
  // partir do chatId, não precisa mandar de novo. 404 se o chatId nunca foi
  // criado (nunca passou pela tabela); 409 se já existe mas não tem pergunta
  // pendente (já concluiu) — status certo em vez de só um campo `status` no
  // corpo, é a diferença entre nível 2 e nível 3 do REST.
  app.post(
    "/atendimentos/respostas",
    {
      schema: {
        tags: ["atendimentos"],
        security: [{ bearerAuth: [] }],
        summary: "Envia uma resposta, avança o fluxo pra próxima pergunta (ou conclui)",
        body: {
          type: "object",
          properties: {
            chatId: { type: "string" },
            resposta: { type: "string", description: "\"true\"/\"false\" pra sim_nao, texto livre pras demais" },
          },
        },
        response: { 200: respostaAtendimentoSchema, 400: erroSchema, 404: erroSchema, 409: erroSchema },
      },
    },
    async (req, reply) => {
      const body = req.body as { chatId?: string; resposta?: string } | undefined;

      const chatId = body?.chatId;
      if (!chatId) return reply.code(400).send({ erro: "chatId obrigatório" });

      const store = await obterAtendimentosStore();
      const fluxoId = await store.buscarFlowId(chatId);
      if (!fluxoId) return reply.code(404).send({ erro: "atendimento não encontrado" });
      const fluxo = buscarFluxo(fluxoId);
      if (!fluxo) return reply.code(404).send({ erro: "fluxo não encontrado — ver GET /fluxos" });

      // fluxoId vai junto no configurable — é isso que deixa contextoAtual()
      // (shared/contexto.ts) correlacionar os logs de dentro dos nós do
      // grafo (verde.ts/reescrever.ts/extrair.ts) com o fluxo certo, além
      // do chatId (thread_id).
      const config = { configurable: { thread_id: chatId, fluxoId } };
      const estadoAnterior = await fluxo.grafo.getState(config);
      const isResuming = (estadoAnterior.next?.length ?? 0) > 0;
      if (!isResuming) {
        return reply.code(409).send({ erro: "atendimento já foi concluído — nada esperando resposta" });
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
      return montarRespostaAtendimento(fluxo, chatId, interrupt, resultado as ValoresAtendimento);
    }
  );
}
