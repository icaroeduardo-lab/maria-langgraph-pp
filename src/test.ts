import { Command } from "@langchain/langgraph";
import { grafo } from "./graph.js";

const config = { configurable: { thread_id: "teste-3" } };

const r1 = await grafo.invoke({}, config);
console.log("1 - parentesco:", JSON.stringify(r1, null, 2));

const r2 = await grafo.invoke(new Command({ resume: "amigo" }), config);
console.log("2 - tem processo?:", JSON.stringify(r2, null, 2));

const r3 = await grafo.invoke(new Command({ resume: "Não" }), config);
console.log("3 - RG (pulou numeroProcesso):", JSON.stringify(r3, null, 2));

const r4 = await grafo.invoke(new Command({ resume: "281980151" }), config);
console.log("4 - confirma nome:", JSON.stringify(r4, null, 2));

const r5 = await grafo.invoke(new Command({ resume: "Sim" }), config);
console.log("5 - final:", JSON.stringify(r5, null, 2));