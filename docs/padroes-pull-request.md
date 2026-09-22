# Padrões de pull request

## Regras gerais

- Destino padrão: `develop` (`hotfix/*` → `main`).
- Um PR = uma issue; pequeno e focado.
- Idioma: pt-BR (título e corpo).
- CI passando antes do merge; apagar branch depois.
- Merge: **squash** para branch de trabalho → `develop`; **merge commit** (nunca squash) para release `develop` → `main` — squash no release reescreve commits compartilhados e gera conflito no próximo.

## Título

Mesmo formato dos commits (ver [`padroes-commits.md`](padroes-commits.md)):

```
:emoji: tipo: Descrição curta e objetiva
```

Ex: `:sparkles: feat: Cliente HTTP com token por env`

## Corpo (template obrigatório)

```markdown
## Resumo

O que este PR faz e por quê, em 1–3 frases.

## Issue relacionada

Closes #<numero>

## O que foi feito

- Mudança 1
- Mudança 2

## Como testar

Passos objetivos para o revisor validar.

## Observações (opcional)

Decisões, débitos assumidos, prints.
```

- `Closes #N` / `Fixes #N` para fechar a issue no merge.
- "Como testar" obrigatório quando há mudança de comportamento visível.

## Checklist antes de abrir

Branch conforme [`padroes-branch.md`](padroes-branch.md) · título `:emoji: tipo:` · `Closes #N` · typecheck/lint passando · critérios de aceitação da issue atendidos · sem segredos no diff.
