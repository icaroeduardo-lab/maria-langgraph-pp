import type { FastifyInstance } from "fastify";
import { fluxosPorId } from "../fluxos/index.js";

const fluxoSchema = {
  type: "object",
  properties: { id: { type: "string", format: "uuid" }, nome: { type: "string" } },
} as const;

// GET /fluxos — a "estrutura de busca" de qual fluxo é qual: lista os ids
// (uuid) disponíveis pra usar em /atendimentos/:fluxoId. Hoje lê do objeto
// hardcoded em fluxos/index.ts (sem banco ainda); se um dia isso virar
// tabela, essa rota passa a ler de lá — contrato (GET /fluxos → [{id,nome}])
// não muda.
export function registrarRotaFluxos(app: FastifyInstance): void {
  app.get(
    "/fluxos",
    {
      schema: {
        tags: ["fluxos"],
        security: [{ bearerAuth: [] }],
        summary: "Lista os fluxos disponíveis e seus ids — use o id em /atendimentos/:fluxoId",
        response: { 200: { type: "array", items: fluxoSchema } },
      },
    },
    async () => Object.entries(fluxosPorId).map(([id, cfg]) => ({ id, nome: cfg.nome }))
  );
}
