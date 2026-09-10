import type { FastifyInstance } from "fastify";
import { buscarFluxo, catalogoParaClassificacao } from "../fluxos/index.js";
import { classificarFluxo } from "../ia/classificarFluxo.js";
import { buscarCandidatos } from "../shared/embeddingsFluxos.js";
import { criarAtendimento } from "./atendimentos.js";

// Quantos candidatos entram no prompt de classificação (ia/classificarFluxo.ts)
// — com o catálogo de hoje (2 fluxos) nunca corta nada; existe pra quando o
// catálogo crescer pra ~80 (ver issue #8). Número redondo, sem tuning fino
// ainda — ajustar se a precisão da classificação incomodar em produção.
const CANDIDATOS_MAXIMOS = 10;

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
      enum: ["nao_identificado"],
      description: "Só presente quando status:handoff_humano — relato não bateu com nenhum fluxo do catálogo (implementado ou planejado)",
    },
    metadados: { type: "object", additionalProperties: true },
    flowId: { type: "string", description: "Fluxo escolhido pela classificação — só presente quando um fluxo IMPLEMENTADO rodou de verdade" },
    _links: { type: "object", additionalProperties: true },
  },
} as const;

const MENSAGEM_NAO_IDENTIFICADO =
  "Não consegui identificar como te ajudar a partir do que você escreveu. Vou encaminhar seu atendimento pra um atendente humano confirmar.";

function respostaHandoffSemFluxo(chatId: string | undefined, motivo: "nao_identificado") {
  return {
    resposta: MENSAGEM_NAO_IDENTIFICADO,
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

      const catalogo = catalogoParaClassificacao();
      const candidatos = await buscarCandidatos(mensagem, CANDIDATOS_MAXIMOS, catalogo);
      req.log.info({ chatId: body?.chatId, totalCatalogo: catalogo.length, candidatos: candidatos.length }, "orquestrador: retrieval de candidatos");
      const classificacao = await classificarFluxo(mensagem, candidatos);

      if (!classificacao.flowId) {
        req.log.info({ chatId: body?.chatId, viaIA: classificacao.viaIA }, "orquestrador: fluxo não identificado, handoff_humano direto");
        return reply.code(200).send(respostaHandoffSemFluxo(body?.chatId, "nao_identificado"));
      }

      const fluxo = buscarFluxo(classificacao.flowId);
      if (!fluxo) {
        // Não deveria acontecer — classificacao.flowId só vem de
        // catalogoParaClassificacao() (fluxosPorId + fluxosPlanejados), e
        // buscarFluxo() resolve os dois (implementado de verdade ou grafo
        // padrão, ver issue #21). Cair aqui é inconsistência real entre os
        // catálogos, não um caminho esperado — trata como não identificado
        // em vez de quebrar o atendimento.
        req.log.error(
          { chatId: body?.chatId, flowId: classificacao.flowId },
          "orquestrador: flowId classificado não existe em nenhum catálogo (inconsistência)"
        );
        return reply.code(200).send(respostaHandoffSemFluxo(body?.chatId, "nao_identificado"));
      }

      // fluxo pode ser um implementado de verdade OU o grafo padrão
      // compartilhado (fluxo planejado sem código ainda, issue #21) — dali
      // em diante o tratamento é IDÊNTICO nos 2 casos, sem branch especial.
      req.log.info({ chatId: body?.chatId, flowId: classificacao.flowId, viaIA: classificacao.viaIA }, "orquestrador: fluxo identificado");
      const resultado = await criarAtendimento(fluxo, classificacao.flowId, body?.chatId, body?.dadosConhecidos, req.log);
      if (resultado.statusCode !== 200) return reply.code(resultado.statusCode).send(resultado.corpo);
      // resultado.corpo já vem com flowId (montarRespostaAtendimento manda
      // sempre, ver rotas/atendimentos.ts) — não precisa injetar de novo.
      return reply.code(200).header("Location", resultado.location).send(resultado.corpo);
    }
  );
}
