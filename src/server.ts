import "dotenv/config";
import { montarApp } from "./app.js";

const app = montarApp();
app.listen({ port: 3001 }, () => console.log("rodando em http://localhost:3001"));
