---
name: padroes-pull-request
description: Regras de destino, título, template e merge de pull request deste repositório. Use antes de abrir qualquer PR.
---

# Padrões de pull request

A versão completa está em [`docs/padroes-pull-request.md`](../../../docs/padroes-pull-request.md) — este arquivo é o resumo que a skill carrega.

## Regras gerais

- Destino padrão: `develop` (`hotfix/*` → `main`).
- Um PR = uma issue; pequeno e focado.
- Idioma: pt-BR (título e corpo).
- CI passando antes do merge; apagar branch depois.
- Merge: **squash** para branch de trabalho → `develop`; **merge commit** (nunca squash) para release `develop` → `main`.

## Título

```
:emoji: tipo: Descrição curta e objetiva
```

## Corpo (template obrigatório)

```markdown
## Resumo

## Issue relacionada
Closes #<numero>

## O que foi feito

## Como testar

## Observações (opcional)
```

## Checklist antes de abrir

Branch conforme padrão · título `:emoji: tipo:` · `Closes #N` · testes passando · critérios de aceitação da issue atendidos · sem segredos no diff.
