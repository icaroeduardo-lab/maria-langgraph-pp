# Padrões de criação de issues

Toda issue: clara, acionável, testável, com contexto suficiente para ser entendida sem esclarecimentos adicionais. Idioma: pt-BR.

**Rastreio com o Coilab**: issue derivada de um card do Coilab recebe a label `#<numero-do-card>` (ex: `#20260106`; cor `7c3aed`, descrição = nome do card — criar a label se não existir) e cita o card no corpo. Issues sem card não levam label de card.

## Título

```
[TYPE] Descrição curta e objetiva
```

Tipos: `[FEATURE]` (novo recurso), `[ENHANCEMENT]` (melhoria de recurso existente), `[BUG]` (comportamento inesperado), `[TECH]` (infra, arquitetura, manutenção interna).

Exemplos:

- `[FEATURE] Criar página de configurações do usuário`
- `[BUG] Login falha quando a senha contém caracteres especiais`

## Estrutura obrigatória do corpo

1. **Contexto de Negócio** — por que este trabalho é necessário.
2. **Declaração do Problema** — situação atual (problema antes da solução).
3. **Solução Esperada** — comportamento desejado.
4. **Critérios de Aceitação** — checklist objetivo e testável (`- [ ]`).

## Seções quando aplicável

- **Cenários BDD** — sempre que houver comportamento descrito, incluir cenário de sucesso e de erro:

```gherkin
Cenário: <nome>
  Dado algum contexto inicial
  Quando uma ação ocorrer
  Então um resultado esperado deve acontecer
```

- **Requisitos Não Funcionais** — performance (ex: API < 500ms), segurança (permissões, dados sensíveis), acessibilidade (teclado, leitores de tela, WCAG), observabilidade (logs, métricas).
- **Dependências** — endpoints necessários, serviços, migrações de banco.
- **Fora de Escopo** — o que explicitamente NÃO está incluído.

## DoR / DoD

- **Ready**: objetivo de negócio definido, escopo claro, critérios de aceitação existem, dependências identificadas, restrições técnicas documentadas.
- **Done**: implementação finalizada, critérios atendidos, testes passando, code review aprovado, documentação atualizada, sem defeito crítico aberto.

## Regras para o assistente de IA

- Linguagem orientada ao negócio; separar requisito de negócio de implementação técnica.
- Gerar critérios de aceitação quando ausentes; gerar BDD quando houver comportamento.
- Identificar ambiguidades e informações ausentes ANTES de implementar — nunca assumir requisitos não informados.
- Issues concisas mas completas; cada issue entendível de forma independente e validável por critérios objetivos.

## Checklist antes de criar/aprovar

Objetivo de negócio claro · problema declarado · escopo definido · critérios de aceitação · BDD quando aplicável · dependências documentadas · fora de escopo documentado · issue independente · testável · pronta para implementação.
