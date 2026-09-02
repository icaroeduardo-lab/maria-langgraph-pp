import pino from "pino";

// Instância única, compartilhada entre Fastify (via loggerInstance em
// app.ts) e módulos sem acesso a req.log (ia/, integracoes/,
// shared/checkpointer.ts). Sem isso, esses módulos caíam em console.* —
// texto puro, sem correlação, e scripts/logs-prod.sh (que assume toda
// linha JSON) apagava a linha inteira.
export const logger = pino();
