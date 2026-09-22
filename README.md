# Maria

Ponte entre a **Tykhe** (chatbot) e o **Verde** (sistema da Defensoria Pública do RJ), construída com [LangGraph](https://langchain-ai.github.io/langgraphjs/) — cada fluxo de atendimento é um grafo de estados com pausa/retomada nativa.

Vai contribuir? Ver [`CONTRIBUTING.md`](CONTRIBUTING.md) (fluxo de issue/branch/commit/PR).

## Documentação

- [`docs/arquitetura.md`](docs/arquitetura.md) — visão geral, decisões de infra (e o porquê de cada uma), persistência, observabilidade.
- [`docs/fluxo-pessoa-presa.md`](docs/fluxo-pessoa-presa.md) — regras de negócio do fluxo pessoa presa.
- [`docs/fluxo-violencia-domestica.md`](docs/fluxo-violencia-domestica.md) — regras de negócio do fluxo violência doméstica.
- [`docs/integracao-verde.md`](docs/integracao-verde.md) — cada endpoint do Verde usado, shape real de resposta, bugs já encontrados ao vivo.
- [`docs/contrato-tykhe.md`](docs/contrato-tykhe.md) — o que a API expõe pra Tykhe, schema da resposta.
- [`docs/testes.md`](docs/testes.md) — como os testes são organizados e rodados, modo mock, o que roda no CI.
- [`docs/padroes-issues.md`](docs/padroes-issues.md), [`docs/padroes-branch.md`](docs/padroes-branch.md), [`docs/padroes-commits.md`](docs/padroes-commits.md), [`docs/padroes-pull-request.md`](docs/padroes-pull-request.md) — convenções de contribuição (ver [`CONTRIBUTING.md`](CONTRIBUTING.md)).

## Rodando local

```bash
pnpm install
echo "API_KEY=dev-local" > .env   # sem VERDE_JWT_TOKEN/DATABASE_URL, cai em modo mock (memória, sem Postgres/Verde real)
pnpm dev
```

Variáveis principais (todas opcionais em dev — ausentes = modo mock): `VERDE_API_URL`, `VERDE_JWT_TOKEN`, `VERDE_CLIENT_ID`, `DATABASE_URL`, `API_KEY` (obrigatória, sem default). `EXTRACAO_LIVRE_IA=true` liga a extração por IA opcional no fluxo pessoa presa (desligada por padrão).

`GET /docs` — Swagger UI com o contrato HTTP completo. `pnpm test` — testes (não precisa de `.env`, roda em modo mock/memória; detalhes em [`docs/testes.md`](docs/testes.md)).

## Estrutura

```
src/fluxos/<nome>/       # 1 fluxo = 1 grafo LangGraph (graph.ts + state.ts + api.ts)
src/integracoes/verde.ts # toda chamada HTTP pro Verde
src/rotas/               # HTTP (Fastify)
src/shared/              # persistência, logger, checkpointer
infra/terraform/         # infra AWS
infra/grafana/           # dashboards/alertas versionados
```

Detalhes em [`docs/arquitetura.md`](docs/arquitetura.md).
