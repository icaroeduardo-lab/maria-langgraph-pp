# Fluxo: Violência Doméstica

`flowId`: `cabb2495-4e12-4f4a-9956-3d20649059bc` — código em `src/fluxos/violenciaDomestica/`. Categoria Verde equivalente: `idCategoriaAssuntoVerde = 10113`.

Vítima de violência doméstica buscando ajuda/proteção/encaminhamento jurídico.

![Diagrama do fluxo violência doméstica](https://maria-langgraph-pp-docs-185327115563.s3.amazonaws.com/diagramas/violencia-domestica.png)

## Passo a passo

```
1. "Você é a vítima de violência doméstica?"   (sim/não)
     não → HANDOFF: nao_e_vitima
     sim → 2.
2. "Existe algum processo relacionado ao seu caso?"   (sim/não/número direto)
     sim ou número direto → 3. "Qual o número do processo?" (se não veio direto) → consulta Verde (informativo)
        não encontrado, < 3 tentativas → "Quer tentar de novo?" (sim/não/número direto)
        esgotou (3 tentativas, ou respondeu "não")  → segue mesmo assim, NUNCA vira handoff (é só informativo)
     não → pula pro passo 4
4. "Você já registrou o Boletim de Ocorrência (RO) na delegacia?"   (sim/não)
5. "Qual o seu CPF?"   (texto — pulado se `cpf` já veio em dadosConhecidos)
     → consulta Verde (/pessoa) → dadosPessoa
     → consulta Verde (/cep) com o CEP do endereço → preenche idUf/idBairro/idMunicipio (não bloqueia se faltar)
     → consulta Verde (/plantao/vigente) — plantão ativo agora?
6. consulta órgão certo (plantão OU normal, conforme passo 5) pelo idPessoa + RO
     nenhum órgão encontrado, CPF NÃO encontrado, < 3 tentativas → "Quer tentar de novo o CPF?" (sim/não/CPF direto)
     nenhum órgão encontrado, CPF NÃO encontrado, esgotou        → HANDOFF: cpf_nao_encontrado
     nenhum órgão encontrado, CPF encontrado (RO:true sem órgão) → HANDOFF: sem_orgao_disponivel
     órgão encontrado                                             → 7.
7. cria o encaminhamento DE VERDADE no Verde (POST real, registro criado no sistema deles)
     falhou → HANDOFF: falha_encaminhamento (NÃO finge sucesso pro usuário)
     deu certo → CONCLUÍDO (mensagem com nome do órgão + protocolo)
```

## Regras de negócio

### Motivos de handoff

| Motivo | Quando |
|---|---|
| `nao_e_vitima` | Respondeu "não" na 1ª pergunta. |
| `sem_orgao_disponivel` | Pessoa encontrada, mas o Verde não achou nenhum órgão pra ela (só acontece com RO:true — sem RO sempre tem fallback). Vem com `mensagemCrc` pronta do Verde ("...ligar 129"). |
| `cpf_nao_encontrado` | Esgotou as 3 tentativas de CPF sem achar a pessoa (issue #72) — motivo específico, não confunde com `sem_orgao_disponivel` (que é pra pessoa ENCONTRADA). |
| `falha_encaminhamento` | Achou o órgão certo, mas o `POST /encaminhamento/encaminhar` de verdade falhou. Nunca inventa sucesso — manda pra atendente confirmar manualmente. |

### Quem decide o órgão: a Verde, não a Maria

`consultarOrgaosViolenciaDomestica(indicacaoRO, idPessoa)` manda só **RO (sim/não) + idPessoa** — o Verde resolve internamente pelo endereço cadastrado da pessoa (capital x outras cidades, DP x Juizado x NUDEM). Não tem comparação de município no nosso lado — isso morava aqui antes e foi removido quando confirmado que o Verde já decide isso de verdade (regra deles, documentada nas issues #8485/#10146 do Facilitador deles: sem RO cai em NUDEM > núcleo de 1º atendimento > DP única; com RO cai no Juizado de VD ou DP única competente).

### Plantão muda a regra de órgão

Antes de consultar órgão, o fluxo checa `GET /plantao/vigente` (sem parâmetro, plantões ativos agora). Se não vazio, usa `consultarOrgaosPlantaoViolenciaDomestica` (endpoint diferente, nem recebe RO) em vez da consulta normal.

### Urgência = já tem RO

`temRegistroOcorrencia: true` vira `urgencia: true` no `POST /encaminhamento/encaminhar` (com `motivoUrgencia` fixo) — muda a mensagem final ("vou encaminhar com urgência... sem necessidade de agendamento" vs. o texto padrão) e o `tipoEncaminhamento` exposto (`urgente`/`padrao`).

## Tolerâncias (achadas ao vivo)

- **Sim/não tolerante** — mesma tolerância de pessoa presa (`"sim"`/`"s"`/`"yes"`, com/sem acento).
- **Número de processo/CPF digitado direto** — tanto na pergunta inicial (`Existe algum processo?`, issue #110) quanto nas perguntas de retry (`Quer tentar de novo?`, issue #77): se o texto bate o formato esperado (processo = 20 dígitos, CPF = 11 dígitos), usa direto como o valor, pulando a pergunta seguinte.
- **CPF pré-preenchido** — se `dadosConhecidos.cpf` já veio no `POST /atendimentos` (contrato com a Tykhe), não pergunta CPF de novo. Só vale na 1ª tentativa (`tentativasCpf === 0`) — um retry sempre pergunta de novo, nunca reusa o CPF que já falhou.

## Dados do Verde usados

- `GET /pessoa?cpf=` — `idPessoa`, `nome`, `nomeSocial`, `genero`, `endereco`, `enderecoDetalhado.cep`.
- `GET /cep/{cep}` — `idUf`/`idBairro`/`idMunicipio` (issue #127; `idBairro`/`idMunicipio` podem vir ausentes mesmo com o CEP existindo, quando a Verde não tem esse detalhe cadastrado).
- `GET /plantao/vigente` — lista de plantões ativos agora.
- `GET /orgao/violencia-domestica?indicacaoRO=&idPessoa=` (ou `/orgao/plantao/violencia-domestica` em horário de plantão) — órgão(s) de destino, em ordem de prioridade.
- `POST /encaminhamento/encaminhar` — cria o encaminhamento real.

Ver `docs/integracao-verde.md` pros detalhes de cada chamada (shapes de resposta, bugs já encontrados).
