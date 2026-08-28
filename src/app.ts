import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import fastifyBearerAuth from "@fastify/bearer-auth";
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

// Schema JSON (não Zod) — @fastify/swagger dynamic mode lê isso direto dos
// options de cada rota pra montar o /docs. Espelha as interfaces acima à
// mão (não tem geração automática TS→JSON Schema aqui, repo pequeno).
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

const metadadosSchema = {
  type: "object",
  properties: {
    parentesco: { type: "string" },
    temProcesso: { type: "boolean" },
    numeroProcesso: { type: "string" },
    rg: { type: "string" },
    dadosApenado: {
      type: "object",
      properties: {
        encontrado: { type: "boolean" },
        idSeap: { type: "number" },
        idPessoa: { type: "number" },
        nome: { type: "string" },
        situacao: { type: "string" },
      },
    },
    motivoHandoff: { type: "string", enum: ["nome_nao_confirmado", "rg_nao_encontrado"] },
  },
} as const;

const respostaAtendimentoSchema = {
  type: "object",
  properties: {
    resposta: { type: "string", description: "Texto da pergunta (se em_andamento) ou mensagem final" },
    tipoResposta: { type: "string", enum: ["texto", "sim_nao", "opcoes"] },
    opcoes: { type: "array", items: { type: "string" } },
    status: { type: "string", enum: ["em_andamento", "concluido", "handoff_humano"] },
    metadados: { ...metadadosSchema, description: "Só presente quando status !== em_andamento" },
    _links: linksSchema,
  },
} as const;

const erroSchema = { type: "object", properties: { erro: { type: "string" } } } as const;

// Monta o Fastify sem chamar listen() — assim os testes usam app.inject()
// direto, sem precisar subir servidor de verdade numa porta. Quem quer
// rodar de verdade importa daqui e chama listen() (ver server.ts).
export async function montarApp() {
  // logger:true liga o pino (padrão do Fastify) — cada linha sai em JSON,
  // com `reqId` gerado automático (correlação por REQUISIÇÃO — trocado pra
  // UUID em vez do padrão sequencial "req-1"/"req-2", que reseta a cada
  // restart do processo e pode colidir/confundir em logs agregados de
  // múltiplas instâncias). Como uma conversa é várias requisições separadas
  // no tempo, incluímos `chatId` manualmente em todo log — é ele que
  // correlaciona TODAS as chamadas de uma mesma conversa entre si (reqId
  // sozinho não faz isso, é só por requisição individual).
  const app = Fastify({ logger: true, genReqId: () => randomUUID() });

  // Code-first (gera o spec a partir do schema de cada rota, não de um yaml
  // mantido à mão) — repo pequeno/experimental, sem o guard de CI que o back
  // principal tem (test/openapi.test.ts lá). Registra ANTES das rotas: o
  // plugin dynamic mode escuta o hook onRoute, que só pega rota declarada
  // depois dele estar no ar.
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Pessoa Presa — API (LangGraph nativo)",
        description: "Ponte Tykhe↔Verde pro fluxo de identificação da pessoa presa. Nível 3 de Richardson (HATEOAS) — siga os `_links` de cada resposta.",
        version: "0.1.0",
      },
      tags: [{ name: "atendimentos", description: "Ciclo de vida de um atendimento (thread do grafo)" }],
    },
  });
  await app.register(fastifySwaggerUi, { routePrefix: "/docs" });

  // GET /health — health check do target group do ALB (ECS). Sem side
  // effect, não toca no grafo/banco — só confirma que o processo responde.
  // Fica FORA do bloco protegido abaixo — o ALB não manda Bearer token.
  app.get("/health", { schema: { hide: true } }, async () => ({ status: "ok" }));

  // Rotas de negócio, protegidas por Bearer token — Tykhe é o único
  // consumidor esperado (chamada servidor-a-servidor). API_KEY obrigatório
  // (sem default silencioso — erra alto na subida se não setado, nunca sobe
  // a API "aberta" por engano). register() encapsulado: o hook de auth do
  // @fastify/bearer-auth só se aplica às rotas declaradas AQUI dentro, não
  // em /health nem /docs (fora deste bloco).
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY obrigatório (.env local ou secret em produção)");
  await app.register(async (protegido) => {
    await protegido.register(fastifyBearerAuth, { keys: new Set([apiKey]) });

    // POST /atendimentos — cria um atendimento novo (1ª pergunta do fluxo).
    // chatId vem no corpo (é a Tykhe quem atribui esse id, não nós) — SEMPRE
    // obrigatório (produção E desenvolvimento); só NODE_ENV=test relaxa (gera
    // UUID), pra facilitar teste sem inventar chatId toda hora.
    protegido.post(
    "/atendimentos",
    {
      schema: {
        tags: ["atendimentos"],
        summary: "Cria um atendimento novo (1ª pergunta do fluxo)",
        body: {
          type: "object",
          properties: { chatId: { type: "string", description: "Id atribuído pela Tykhe — obrigatório fora de NODE_ENV=test" } },
        },
        response: { 201: respostaAtendimentoSchema, 400: erroSchema },
      },
    },
    async (req, reply) => {
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
    }
  );

  // GET /atendimentos/:chatId — consulta o estado ATUAL, sem avançar nada
  // (não chama invoke, só lê o checkpoint). 404 se esse chatId nunca foi
  // criado (nunca teve um POST /atendimentos com esse id).
    protegido.get(
    "/atendimentos/:chatId",
    {
      schema: {
        tags: ["atendimentos"],
        summary: "Consulta o estado atual (sem avançar o fluxo)",
        params: { type: "object", properties: { chatId: { type: "string" } }, required: ["chatId"] },
        response: { 200: respostaAtendimentoSchema, 404: erroSchema },
      },
    },
    async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    const config = { configurable: { thread_id: chatId } };
    const estado = await grafo.getState(config);
    const interrupt = estado.tasks?.[0]?.interrupts?.[0]?.value as InterruptValue | undefined;
    const valores = (estado.values ?? {}) as ValoresAtendimento;
    const existe = !!interrupt || Object.keys(valores).length > 0;
    if (!existe) return reply.code(404).send({ erro: "atendimento não encontrado" });
    return montarRespostaAtendimento(chatId, interrupt, valores);
    }
  );

  // POST /atendimentos/:chatId/respostas — envia uma resposta, avança o
  // fluxo. 409 se esse chatId não existe ou já concluiu (não tem pergunta
  // pendente esperando resposta) — HTTP status certo em vez de só um campo
  // `status` no corpo, é a diferença entre nível 2 e nível 3 do REST.
    protegido.post(
    "/atendimentos/:chatId/respostas",
    {
      schema: {
        tags: ["atendimentos"],
        summary: "Envia uma resposta, avança o fluxo pra próxima pergunta (ou conclui)",
        params: { type: "object", properties: { chatId: { type: "string" } }, required: ["chatId"] },
        body: {
          type: "object",
          properties: {
            resposta: { type: "string", description: "\"true\"/\"false\" pra sim_nao, texto livre pras demais" },
          },
        },
        response: { 200: respostaAtendimentoSchema, 409: erroSchema },
      },
    },
    async (req, reply) => {
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
    }
  );
  });

  return app;
}
