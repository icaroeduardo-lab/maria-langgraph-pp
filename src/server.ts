import "dotenv/config";
import { montarApp } from "./app.js";

const app = await montarApp();
// host 0.0.0.0 — padrão do Fastify é 127.0.0.1, que funciona local mas não
// dentro de container (ALB conecta na interface real da task, não loopback).
app.listen({ port: 3001, host: "0.0.0.0" }, () => console.log("rodando em http://localhost:3001"));
