import type { FastifyInstance } from "fastify";
import { buscarFluxo, buscarFluxoPlanejado, catalogoParaClassificacao } from "../fluxos/index.js";
import { classificarFluxo } from "../ia/classificarFluxo.js";
import { criarAtendimento } from "./atendimentos.js";

const erroSchema = { type: "object", properties: { erro: { type: "string" } } } as const;

const respostaOrquestradorSchema = {
  type: "object",
  properties: {
    resposta: { type: "string" },
    tipoResposta: { type: "string", enum: ["texto", "sim_nao", "opcoes"] },
    opcoes: { type: "array", items: { type: "string" } },
    status: { type: "string", enum: ["em_andamento", "concluido", "handoff_humano"] },
    motivoHandoff: {
      type: "string",
      enum: ["nao_identificado", "fluxo_nao_implementado"],
      description: "Só presente quando status:handoff_humano SEM fluxo rodando (nenhum grafo chamado)",
    },
    metadados: { type: "object", additionalProperties: true },
    flowId: { type: "string", description: "Fluxo escolhido pela classificação — só presente quando um fluxo IMPLEMENTADO rodou de verdade" },
    _links: { type: "object", additionalProperties: true },
  },
} as const;

const MENSAGEM_NAO_IDENTIFICADO =
  "Não consegui identificar como te ajudar a partir do que você escreveu. Vou encaminhar seu atendimento pra um atendente humano confirmar.";
// Mesma mensagem pro usuário nos 2 casos de handoff sem fluxo — a diferença
// (identificado mas sem código vs não identificado) importa pra NÓS
// (telemetria de demanda, ver motivoHandoff/log), não pra experiência dele.
const MENSAGEM_FLUXO_NAO_IMPLEMENTADO = MENSAGEM_NAO_IDENTIFICADO;

function respostaHandoffSemFluxo(chatId: string | undefined, motivo: "nao_identificado" | "fluxo_nao_implementado") {
  return {
    resposta: motivo === "fluxo_nao_implementado" ? MENSAGEM_FLUXO_NAO_IMPLEMENTADO : MENSAGEM_NAO_IDENTIFICADO,
    tipoResposta: "texto",
    status: "handoff_humano",
    motivoHandoff: motivo,
    _links: { self: { href: chatId ? `/atendimentos/${chatId}` : undefined } },
  };
}

// POST /atendimentos/orquestrador — alternativa a POST /atendimentos pra
// quem NÃO sabe de antemão qual flowId usar: manda um relato livre
// (`mensagem`) em vez de `flowId`, a Maria classifica com IA
// (ia/classificarFluxo.ts) qual fluxo atende o caso e cria o atendimento
// normalmente nele — dali em diante é o MESMO atendimento de sempre
// (GET/POST /atendimentos/respostas funcionam igual, já registrado na
// tabela chatId→flowId).
//
// Criação manual (POST /atendimentos com flowId explícito) continua
// existindo do lado dela, sem mudança — esta rota é só um jeito A MAIS de
// chegar no mesmo lugar.
//
// A classificação usa o CATÁLOGO COMPLETO (fluxos/index.ts::catalogoParaClassificacao)
// — implementados (fluxosPorId, com grafo de verdade) + planejados
// (fluxos/catalogo.ts, só descrição, sem código ainda). Isso deixa a IA
// "reconhecer" um fluxo que ainda não foi codado — útil pra medir demanda
// real antes de implementar (ver fluxos/catalogo.ts). Quando isso acontece,
// motivoHandoff:"fluxo_nao_implementado" e loga qual fluxo foi identificado.
export function registrarRotaOrquestrador(app: FastifyInstance): void {
  app.post(
    "/atendimentos/orquestrador",
    {
      schema: {
        tags: ["atendimentos"],
        security: [{ bearerAuth: [] }],
        summary: "Cria um atendimento identificando o fluxo automaticamente a partir de um relato livre",
        body: {
          type: "object",
          properties: {
            chatId: { type: "string", description: "Id atribuído pela Tykhe — obrigatório fora de NODE_ENV=test" },
            mensagem: { type: "string", description: "Relato livre — usado pra identificar qual fluxo atende o caso" },
            dadosConhecidos: {
              type: "object",
              additionalProperties: true,
              description: "Mesmo campo de POST /atendimentos — só é usado se um fluxo IMPLEMENTADO for identificado.",
            },
          },
          required: ["mensagem"],
        },
        response: { 200: respostaOrquestradorSchema, 400: erroSchema, 409: erroSchema },
      },
    },
    async (req, reply) => {
      const body = req.body as
        | { chatId?: string; mensagem?: string; dadosConhecidos?: Record<string, unknown> }
        | undefined;

      const mensagem = body?.mensagem;
      if (!mensagem) return reply.code(400).send({ erro: "mensagem obrigatória" });

      const classificacao = await classificarFluxo(mensagem, catalogoParaClassificacao());

      if (!classificacao.flowId) {
        req.log.info({ chatId: body?.chatId, viaIA: classificacao.viaIA }, "orquestrador: fluxo não identificado, handoff_humano direto");
        return reply.code(200).send(respostaHandoffSemFluxo(body?.chatId, "nao_identificado"));
      }

      const fluxo = buscarFluxo(classificacao.flowId);
      if (!fluxo) {
        // IA identificou um fluxo PLANEJADO (fluxos/catalogo.ts) — reconhece
        // a demanda, mas não tem grafo pra rodar ainda. Log estruturado
        // (nível info — é esperado, não bug) serve pra medir qual fluxo
        // priorizar implementar; buscarFluxoPlanejado só pra enriquecer o
        // log com o nome, se achar.
        const planejado = buscarFluxoPlanejado(classificacao.flowId);
        req.log.info(
          { chatId: body?.chatId, flowId: classificacao.flowId, nome: planejado?.nome, viaIA: classificacao.viaIA },
          "orquestrador: fluxo identificado mas ainda não implementado"
        );
        return reply.code(200).send(respostaHandoffSemFluxo(body?.chatId, "fluxo_nao_implementado"));
      }

      req.log.info({ chatId: body?.chatId, flowId: classificacao.flowId, viaIA: classificacao.viaIA }, "orquestrador: fluxo identificado");
      const resultado = await criarAtendimento(fluxo, classificacao.flowId, body?.chatId, body?.dadosConhecidos, req.log);
      if (resultado.statusCode !== 200) return reply.code(resultado.statusCode).send(resultado.corpo);
      // resultado.corpo já vem com flowId (montarRespostaAtendimento manda
      // sempre, ver rotas/atendimentos.ts) — não precisa injetar de novo.
      return reply.code(200).header("Location", resultado.location).send(resultado.corpo);
    }
  );
}
