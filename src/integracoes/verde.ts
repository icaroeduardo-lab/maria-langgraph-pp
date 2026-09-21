import type {
  DadosApenado,
  DadosCep,
  DadosPessoa,
  DadosProcesso,
  OrgaoAtendimento,
  OrgaosViolenciaDomestica,
  Plantao,
  ResultadoEncaminhamento,
} from "../shared/types.js";
import { logger } from "../shared/logger.js";
import { contextoAtual } from "../shared/contexto.js";

// TODO: VERDE_JWT_TOKEN é temporário (emitido como app "Tykhe" pelo Verde,
// expira 2026-09-12) — precisa de credencial própria da Maria antes disso.
const VERDE_API_URL = process.env.VERDE_API_URL ?? "https://homologacao.verde.rj.def.br/api/integra";
const VERDE_JWT_TOKEN = process.env.VERDE_JWT_TOKEN ?? "";
const VERDE_CLIENT_ID = process.env.VERDE_CLIENT_ID ?? "";

interface ApenadoResponseVerde {
  codigo?: string;
  mensagem?: string;
  dados?: {
    idSeap?: number;
    nome?: string;
    situacao?: string;
    idPessoa?: number;
    // confirmados ao vivo 2026-09-09 (curl direto no /apenado) — Verde já
    // manda os dois, só não estavam sendo capturados. cpf e unidadePrisional
    // também vêm na resposta real, mas nenhum fluxo precisa deles hoje —
    // não capturados (YAGNI).
    tipoPreso?: string;
    regime?: string;
  };
}

export async function consultarApenadoPorRg(rg: string): Promise<DadosApenado> {
  if (!VERDE_JWT_TOKEN) {
    logger.warn(contextoAtual(), "[verde] VERDE_JWT_TOKEN ausente — modo mock (dev local)");
    // RG "000000000" simula "não encontrado" no mock (pra testar o fluxo de
    // retry sem depender do Verde real) — qualquer outro RG "acha" a pessoa
    // de teste.
    if (rg === "000000000") return { encontrado: false };
    // situacao/tipoPreso/regime sem sufixo "(mock)" de propósito (issue
    // #57) — concluir() (fluxos/pessoaPresa/graph.ts) compara esses 3
    // campos por igualdade estrita contra o que o Verde real devolve, um
    // sufixo quebraria a comparação em teste.
    //
    // Sentinelas de teste (issue #57 — situação/tipo/regime fora do
    // permitido, ou situação com prefixo "EM" pra testar a normalização),
    // mesmo padrão de "000000000" acima. Qualquer outro RG cai no caso
    // "tudo permitido" (situação ATIVO, tipo CONDENADO, regime SEMIABERTO).
    if (rg === "22222222222") {
      return { encontrado: true, idSeap: 999999, idPessoa: 999999, nome: "Pessoa de Teste (mock)", situacao: "LIBERTADO", tipoPreso: "CONDENADO", regime: "SEMIABERTO" };
    }
    if (rg === "33333333333") {
      return { encontrado: true, idSeap: 999999, idPessoa: 999999, nome: "Pessoa de Teste (mock)", situacao: "ATIVO", tipoPreso: "PROVISÓRIO", regime: "SEMIABERTO" };
    }
    if (rg === "44444444444") {
      return { encontrado: true, idSeap: 999999, idPessoa: 999999, nome: "Pessoa de Teste (mock)", situacao: "ATIVO", tipoPreso: "CONDENADO", regime: "ABERTO" };
    }
    if (rg === "55555555555") {
      return { encontrado: true, idSeap: 999999, idPessoa: 999999, nome: "Pessoa de Teste (mock)", situacao: "EM RESDOM", tipoPreso: "CONDENADO", regime: "FECHADO" };
    }
    return {
      encontrado: true,
      idSeap: 999999,
      idPessoa: 999999,
      nome: "Pessoa de Teste (mock)",
      situacao: "ATIVO",
      tipoPreso: "CONDENADO",
      regime: "SEMIABERTO",
    };
  }
  const inicio = Date.now();
  try {
    const res = await fetch(`${VERDE_API_URL}/apenado`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${VERDE_JWT_TOKEN}`,
        "x-client-id": VERDE_CLIENT_ID,
      },
      body: JSON.stringify({ rg }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      logger.warn({ ...contextoAtual(), status: res.status, evento: "verde_chamada", chamada: "apenado", resultado: "nao_ok", duracaoMs: Date.now() - inicio }, "[verde] apenado: HTTP não-ok");
      return { encontrado: false };
    }
    const corpo = (await res.json()) as ApenadoResponseVerde;
    // RG não encontrado: Verde devolve "dados": {} (objeto VAZIO, não null/
    // ausente — confirmado ao vivo 2026-08-28) — checar só `!corpo.dados`
    // não pega isso, `{}` é truthy. Checa um campo que só existe se achou
    // de verdade.
    logger.info({ ...contextoAtual(), evento: "verde_chamada", chamada: "apenado", resultado: "sucesso", duracaoMs: Date.now() - inicio }, "[verde] apenado: chamada concluída");
    if (!corpo.dados || corpo.dados.idPessoa === undefined) return { encontrado: false };
    return {
      encontrado: true,
      idSeap: corpo.dados.idSeap,
      idPessoa: corpo.dados.idPessoa,
      nome: corpo.dados.nome,
      situacao: corpo.dados.situacao,
      tipoPreso: corpo.dados.tipoPreso,
      regime: corpo.dados.regime,
    };
  } catch (err) {
    logger.error({ ...contextoAtual(), err, evento: "verde_chamada", chamada: "apenado", resultado: "erro", duracaoMs: Date.now() - inicio }, "[verde] apenado: falha na chamada");
    return { encontrado: false };
  }
}

interface ProcessoResponseVerde {
  codigo?: string;
  mensagem?: string;
  dados?: {
    id?: number;
    origem?: string;
    instancia?: number;
    nomeAssunto?: string;
    nomeOrgaoJulgador?: string;
    movimentos?: Array<{ titulo?: string; data?: string; descricao?: string; traducao?: string }>;
  };
}

// Consulta o processo pelo número informado (só chamada quando temProcesso:
// true — ver fluxos/pessoaPresa/graph.ts). Diferente de consultarApenadoPorRg,
// NÃO trava o fluxo: erro/não encontrado só fica registrado em
// dadosProcesso.encontrado, sem retry nem pergunta de "tentar de novo" — é
// informação complementar pra Tykhe, não um gate de identificação.
export async function consultarProcesso(numero: string): Promise<DadosProcesso> {
  if (!VERDE_JWT_TOKEN) {
    logger.warn(contextoAtual(), "[verde] VERDE_JWT_TOKEN ausente — modo mock (dev local)");
    // Sentinelas de teste (issue #51 — só SEEU é resolvido pelo bot
    // sozinho): número "000000000" simula processo NÃO ENCONTRADO (sem
    // origem nenhuma); "0000000-00.0000.0.00.0000" simula origem NÃO
    // suportada; qualquer outro número "acha" um processo com origem SEEU.
    // origem precisa ser o valor EXATO "SEEU" (sem sufixo "(mock)") porque
    // `concluir()` compara por igualdade estrita contra o que o Verde real
    // devolve.
    if (numero === "000000000") return { encontrado: false };
    if (numero === "0000000-00.0000.0.00.0000") {
      return { encontrado: true, id: 999999, origem: "e-Proc (mock)", nomeAssunto: "Processo de Teste (mock)" };
    }
    return { encontrado: true, id: 999999, origem: "SEEU", nomeAssunto: "Processo de Teste (mock)" };
  }
  const inicio = Date.now();
  try {
    const res = await fetch(`${VERDE_API_URL}/processo/consultar/${encodeURIComponent(numero)}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${VERDE_JWT_TOKEN}`,
        "x-client-id": VERDE_CLIENT_ID,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      logger.warn({ ...contextoAtual(), status: res.status, evento: "verde_chamada", chamada: "processo", resultado: "nao_ok", duracaoMs: Date.now() - inicio }, "[verde] processo: HTTP não-ok");
      return { encontrado: false };
    }
    const corpo = (await res.json()) as ProcessoResponseVerde;
    logger.info({ ...contextoAtual(), evento: "verde_chamada", chamada: "processo", resultado: "sucesso", duracaoMs: Date.now() - inicio }, "[verde] processo: chamada concluída");
    if (!corpo.dados || corpo.dados.id === undefined) return { encontrado: false };
    return {
      encontrado: true,
      id: corpo.dados.id,
      origem: corpo.dados.origem,
      instancia: corpo.dados.instancia,
      nomeAssunto: corpo.dados.nomeAssunto,
      nomeOrgaoJulgador: corpo.dados.nomeOrgaoJulgador,
      movimentos: corpo.dados.movimentos,
    };
  } catch (err) {
    logger.error({ ...contextoAtual(), err, evento: "verde_chamada", chamada: "processo", resultado: "erro", duracaoMs: Date.now() - inicio }, "[verde] processo: falha na chamada");
    return { encontrado: false };
  }
}

interface PessoaResponseVerde {
  codigo?: string;
  mensagem?: string;
  dados?: {
    idPessoa?: number;
    nome?: string;
    nomeSocial?: string;
    genero?: string;
    endereco?: string;
    // Issue #127 — só cep é usado (pra alimentar consultarCep); a Verde
    // devolve logradouro/bairro/municipio/uf também, mas ninguém lê isso
    // em lógica do fluxo, e os ids equivalentes vêm de /cep, não daqui.
    enderecoDetalhado?: {
      cep?: string;
    };
  };
}

// Consulta dados do assistido (endereço incluso) pelo CPF — usado pelo fluxo
// violenciaDomestica pra saber o município e decidir capital x outras cidades
// (ver fluxos/violenciaDomestica/graph.ts). CPF aceito com ou sem pontuação,
// a própria API do Verde tolera os dois formatos, sem precisar sanitizar aqui.
export async function consultarPessoaPorCpf(cpf: string): Promise<DadosPessoa> {
  if (!VERDE_JWT_TOKEN) {
    logger.warn(contextoAtual(), "[verde] VERDE_JWT_TOKEN ausente — modo mock (dev local)");
    // CPF "00000000000" simula "não encontrado" no mock, mesmo padrão do RG
    // "000000000" em consultarApenadoPorRg — qualquer outro CPF "acha" a
    // pessoa de teste, com município Rio de Janeiro (capital).
    if (cpf === "00000000000") return { encontrado: false };
    return {
      encontrado: true,
      idPessoa: 999999,
      nome: "Pessoa de Teste (mock)",
      genero: "Feminino",
      endereco: "Rua de Teste, 123 (mock)",
      enderecoDetalhado: { cep: "20000-000" },
    };
  }
  const inicio = Date.now();
  try {
    const res = await fetch(`${VERDE_API_URL}/pessoa?cpf=${encodeURIComponent(cpf)}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${VERDE_JWT_TOKEN}`,
        "x-client-id": VERDE_CLIENT_ID,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      // 404 (CPF não encontrado) e 422 (mais de uma pessoa encontrada) caem
      // aqui junto — mesmo tratamento genérico de status não-ok dos outros 2
      // métodos deste arquivo, sem distinguir motivo (repo pequeno, não vale
      // ramificação extra por enquanto).
      logger.warn({ ...contextoAtual(), status: res.status, evento: "verde_chamada", chamada: "pessoa", resultado: "nao_ok", duracaoMs: Date.now() - inicio }, "[verde] pessoa: HTTP não-ok");
      return { encontrado: false };
    }
    const corpo = (await res.json()) as PessoaResponseVerde;
    logger.info({ ...contextoAtual(), evento: "verde_chamada", chamada: "pessoa", resultado: "sucesso", duracaoMs: Date.now() - inicio }, "[verde] pessoa: chamada concluída");
    if (!corpo.dados || corpo.dados.idPessoa === undefined) return { encontrado: false };
    return {
      encontrado: true,
      idPessoa: corpo.dados.idPessoa,
      nome: corpo.dados.nome,
      nomeSocial: corpo.dados.nomeSocial,
      genero: corpo.dados.genero,
      endereco: corpo.dados.endereco,
      enderecoDetalhado: corpo.dados.enderecoDetalhado,
    };
  } catch (err) {
    logger.error({ ...contextoAtual(), err, evento: "verde_chamada", chamada: "pessoa", resultado: "erro", duracaoMs: Date.now() - inicio }, "[verde] pessoa: falha na chamada");
    return { encontrado: false };
  }
}

// bairro/municipio vêm ora null, ora objeto {id,...} (achado ao vivo
// 2026-09-21, testando /cep com CEPs reais só uf veio populado) — leitura
// defensiva, sem assumir shape fixo.
interface CepResponseVerde {
  codigo?: string;
  mensagem?: string;
  dados?: {
    uf?: { id?: number } | null;
    bairro?: { id?: number } | null;
    municipio?: { id?: number } | null;
  };
}

function idDeCampoCep(campo: { id?: number } | null | undefined): number | undefined {
  return campo && typeof campo === "object" ? campo.id : undefined;
}

// Issue #127 — GET /cep/{cep}, separado de /pessoa: devolve ids de
// uf/bairro/município (quando cadastrados) pra quem só tinha o nome em
// texto via /pessoa. idBairro/idMunicipio ficam undefined quando a Verde
// não tem esse dado pro CEP — não é erro, o CEP existe, só falta o
// detalhe (aconteceu com os 2 CEPs reais testados nesta sessão).
export async function consultarCep(cep: string): Promise<DadosCep> {
  if (!VERDE_JWT_TOKEN) {
    logger.warn(contextoAtual(), "[verde] VERDE_JWT_TOKEN ausente — modo mock (dev local)");
    return { encontrado: true, idUf: 19 };
  }
  const inicio = Date.now();
  try {
    const res = await fetch(`${VERDE_API_URL}/cep/${encodeURIComponent(cep)}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${VERDE_JWT_TOKEN}`,
        "x-client-id": VERDE_CLIENT_ID,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      logger.warn({ ...contextoAtual(), status: res.status, evento: "verde_chamada", chamada: "cep", resultado: "nao_ok", duracaoMs: Date.now() - inicio }, "[verde] cep: HTTP não-ok");
      return { encontrado: false };
    }
    const corpo = (await res.json()) as CepResponseVerde;
    logger.info({ ...contextoAtual(), evento: "verde_chamada", chamada: "cep", resultado: "sucesso", duracaoMs: Date.now() - inicio }, "[verde] cep: chamada concluída");
    if (!corpo.dados) return { encontrado: false };
    return {
      encontrado: true,
      idUf: idDeCampoCep(corpo.dados.uf),
      idBairro: idDeCampoCep(corpo.dados.bairro),
      idMunicipio: idDeCampoCep(corpo.dados.municipio),
    };
  } catch (err) {
    logger.error({ ...contextoAtual(), err, evento: "verde_chamada", chamada: "cep", resultado: "erro", duracaoMs: Date.now() - inicio }, "[verde] cep: falha na chamada");
    return { encontrado: false };
  }
}

interface OrgaoResponseVerde {
  codigo?: string;
  mensagem?: string;
  dados?: Array<{
    id?: number;
    nome?: string;
    enderecos?: Array<{
      logradouro?: string;
      numero?: string;
      complemento?: string;
      cep?: string;
      bairro?: string;
      municipio?: string;
      uf?: string;
      idLocalAtendimento?: number;
      horariosUrgencia?: Array<{ diaDaSemana?: string; horaInicio?: string; horaFim?: string; informacaoComplementar?: string }>;
      horariosAtendimentoFormatado?: string;
      horariosUrgenciaFormatado?: string;
    }>;
  }>;
}

// Consulta o(s) órgão(s) certo(s) pra encaminhar um caso de violência
// doméstica, dado o idPessoa — o Verde resolve TUDO internamente pelo
// endereço cadastrado da pessoa (regra de negócio deles, documentada nas
// issues #8485/#10146 do Facilitador: sem RO cai em NUDEM > núcleo de 1º
// atendimento > DP única, com RO cai no Juizado de VD ou DP única
// competente). Sem comparação de município/capital aqui — isso morava no
// nosso lado antes, mas é o Verde quem decide de verdade.
//
// Devolve em ordem de prioridade — fluxos/violenciaDomestica/graph.ts usa
// sempre o primeiro item. RO:true sem NENHUM órgão encontrado é o único
// caso "não encontrado" documentado (RO:false sempre tem fallback).
export async function consultarOrgaosViolenciaDomestica(indicacaoRO: boolean, idPessoa: number): Promise<OrgaosViolenciaDomestica> {
  if (!VERDE_JWT_TOKEN) {
    logger.warn(contextoAtual(), "[verde] VERDE_JWT_TOKEN ausente — modo mock (dev local)");
    // idPessoa 0 (== "pessoa não encontrada" no mock de consultarPessoaPorCpf)
    // + RO:true simula o caso "sem órgão" — só existe nessa combinação,
    // mesmo padrão de sentinela dos outros mocks deste arquivo.
    if (indicacaoRO && idPessoa === 0) {
      return {
        encontrado: false,
        orgaos: [],
        contactarCrc: true,
        mensagemCrc: "Para dar continuidade ao seu atendimento, favor entrar em contato com a Central de Relacionamento com o Cidadão ligando 129",
      };
    }
    const orgao: OrgaoAtendimento = indicacaoRO
      ? {
          id: 274,
          nome: "DP de Defesa da Mulher junto ao Juizado de Violência Doméstica (mock)",
          enderecos: [{ municipio: "Município de Teste", idLocalAtendimento: 222 }],
        }
      : {
          id: 525,
          nome: "Coordenação de Defesa dos Direitos da Mulher (mock)",
          enderecos: [{ municipio: "Rio de Janeiro (mock)", idLocalAtendimento: 1233 }],
        };
    return { encontrado: true, orgaos: [orgao] };
  }
  const inicio = Date.now();
  try {
    const res = await fetch(`${VERDE_API_URL}/orgao/violencia-domestica?indicacaoRO=${indicacaoRO}&idPessoa=${idPessoa}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${VERDE_JWT_TOKEN}`,
        "x-client-id": VERDE_CLIENT_ID,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      logger.warn({ ...contextoAtual(), status: res.status, evento: "verde_chamada", chamada: "orgao-violencia-domestica", resultado: "nao_ok", duracaoMs: Date.now() - inicio }, "[verde] orgao-violencia-domestica: HTTP não-ok");
      return { encontrado: false, orgaos: [] };
    }
    const corpo = (await res.json()) as OrgaoResponseVerde;
    logger.info({ ...contextoAtual(), evento: "verde_chamada", chamada: "orgao-violencia-domestica", resultado: "sucesso", duracaoMs: Date.now() - inicio }, "[verde] orgao-violencia-domestica: chamada concluída");
    // "CONTACTAR_CRC" — código específico do Verde pra "não achei nada,
    // liga 129" (só acontece com RO:true). mensagem já vem pronta deles,
    // pt-BR, direto pro usuário.
    if (corpo.codigo === "CONTACTAR_CRC") {
      return { encontrado: false, orgaos: [], contactarCrc: true, mensagemCrc: corpo.mensagem };
    }
    const orgaos: OrgaoAtendimento[] = (corpo.dados ?? []).map((o) => ({ id: o.id ?? 0, nome: o.nome ?? "", enderecos: o.enderecos }));
    return { encontrado: orgaos.length > 0, orgaos };
  } catch (err) {
    logger.error({ ...contextoAtual(), err, evento: "verde_chamada", chamada: "orgao-violencia-domestica", resultado: "erro", duracaoMs: Date.now() - inicio }, "[verde] orgao-violencia-domestica: falha na chamada");
    return { encontrado: false, orgaos: [] };
  }
}

interface PlantaoResponseVerde {
  codigo?: string;
  mensagem?: string;
  dados?: Array<{ id?: number; tipo?: string }>;
}

// GET /integra/plantao/vigente — sem parâmetros. Lista vazia = fora de
// horário de plantão (fluxo normal de órgão). Não vazia = usa
// consultarOrgaosPlantaoViolenciaDomestica em vez da consulta normal — ver
// fluxos/violenciaDomestica/graph.ts.
export async function consultarPlantaoVigente(): Promise<Plantao[]> {
  if (!VERDE_JWT_TOKEN) {
    logger.warn(contextoAtual(), "[verde] VERDE_JWT_TOKEN ausente — modo mock (dev local)");
    // MOCK_PLANTAO_VIGENTE=true simula plantão ativo — sem isso o mock
    // sempre devolve vazio (não dá pra simular via parâmetro, esse endpoint
    // não recebe nenhum). Só lido em teste/dev, nunca com token real.
    if (process.env.MOCK_PLANTAO_VIGENTE === "true") return [{ id: 1, tipo: "Violência Doméstica (mock)" }];
    return [];
  }
  const inicio = Date.now();
  try {
    const res = await fetch(`${VERDE_API_URL}/plantao/vigente`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${VERDE_JWT_TOKEN}`,
        "x-client-id": VERDE_CLIENT_ID,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      logger.warn({ ...contextoAtual(), status: res.status, evento: "verde_chamada", chamada: "plantao-vigente", resultado: "nao_ok", duracaoMs: Date.now() - inicio }, "[verde] plantao-vigente: HTTP não-ok");
      return [];
    }
    const corpo = (await res.json()) as PlantaoResponseVerde;
    logger.info({ ...contextoAtual(), evento: "verde_chamada", chamada: "plantao-vigente", resultado: "sucesso", duracaoMs: Date.now() - inicio }, "[verde] plantao-vigente: chamada concluída");
    return (corpo.dados ?? []).filter((p) => p.id !== undefined).map((p) => ({ id: p.id as number, tipo: p.tipo }));
  } catch (err) {
    logger.error({ ...contextoAtual(), err, evento: "verde_chamada", chamada: "plantao-vigente", resultado: "erro", duracaoMs: Date.now() - inicio }, "[verde] plantao-vigente: falha na chamada");
    return [];
  }
}

// GET /integra/orgao/plantao/violencia-domestica — mesmo formato de
// resultado de consultarOrgaosViolenciaDomestica (reaproveitado pelo grafo
// sem precisar saber qual dos dois foi chamado). idPlantao é repetível na
// query string (?idPlantao=1&idPlantao=2).
export async function consultarOrgaosPlantaoViolenciaDomestica(idPlantao: number[], idAssistido: number): Promise<OrgaosViolenciaDomestica> {
  if (!VERDE_JWT_TOKEN) {
    logger.warn(contextoAtual(), "[verde] VERDE_JWT_TOKEN ausente — modo mock (dev local)");
    if (idAssistido === 0) {
      return {
        encontrado: false,
        orgaos: [],
        contactarCrc: true,
        mensagemCrc: "Para dar continuidade ao seu atendimento, favor entrar em contato com a Central de Relacionamento com o Cidadão ligando 129",
      };
    }
    return {
      encontrado: true,
      orgaos: [
        {
          id: 999,
          nome: "Órgão de Plantão (mock)",
          enderecos: [{ municipio: "Rio de Janeiro (mock)", idLocalAtendimento: 333 }],
        },
      ],
    };
  }
  const inicio = Date.now();
  try {
    const query = idPlantao.map((id) => `idPlantao=${id}`).join("&");
    const res = await fetch(`${VERDE_API_URL}/orgao/plantao/violencia-domestica?${query}&idAssistido=${idAssistido}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${VERDE_JWT_TOKEN}`,
        "x-client-id": VERDE_CLIENT_ID,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      logger.warn({ ...contextoAtual(), status: res.status, evento: "verde_chamada", chamada: "orgao-plantao-violencia-domestica", resultado: "nao_ok", duracaoMs: Date.now() - inicio }, "[verde] orgao-plantao-violencia-domestica: HTTP não-ok");
      return { encontrado: false, orgaos: [] };
    }
    logger.info({ ...contextoAtual(), evento: "verde_chamada", chamada: "orgao-plantao-violencia-domestica", resultado: "sucesso", duracaoMs: Date.now() - inicio }, "[verde] orgao-plantao-violencia-domestica: chamada concluída");
    const corpo = (await res.json()) as {
      codigo?: string;
      mensagem?: string;
      dados?: NonNullable<OrgaoResponseVerde["dados"]>[number] | NonNullable<OrgaoResponseVerde["dados"]>;
    };
    if (corpo.codigo) {
      // qualquer resposta com `codigo` aqui é erro/"não encontrado" (ex:
      // REQUISICAO_INVALIDA visto ao vivo pra assistido sem endereço) — trata
      // igual ao CONTACTAR_CRC do endpoint normal, mesma UX (handoff humano).
      return { encontrado: false, orgaos: [], contactarCrc: true, mensagemCrc: corpo.mensagem };
    }
    // Doc do Swagger mostra `dados` como objeto único aqui (diferente do
    // endpoint normal, que é array) — normaliza os dois formatos, não
    // confiei 100% na doc depois do que já vimos divergir da realidade.
    const bruto = (corpo as { dados?: unknown }).dados;
    const lista = Array.isArray(bruto) ? bruto : bruto ? [bruto] : [];
    const orgaos: OrgaoAtendimento[] = (lista as Array<{ id?: number; nome?: string; enderecos?: OrgaoAtendimento["enderecos"] }>).map((o) => ({
      id: o.id ?? 0,
      nome: o.nome ?? "",
      enderecos: o.enderecos,
    }));
    return { encontrado: orgaos.length > 0, orgaos };
  } catch (err) {
    logger.error({ ...contextoAtual(), err, evento: "verde_chamada", chamada: "orgao-plantao-violencia-domestica", resultado: "erro", duracaoMs: Date.now() - inicio }, "[verde] orgao-plantao-violencia-domestica: falha na chamada");
    return { encontrado: false, orgaos: [] };
  }
}

interface EncaminhamentoResponseVerde {
  codigo?: string;
  mensagem?: string;
  // id vem aninhado em `dados` (confirmado ao vivo 2026-09-18) — igual ao
  // padrão de pessoa/orgao, diferente do que este endpoint tinha antes
  // (corpo.id na raiz, que nunca existiu de verdade e fazia todo
  // encaminhamento cair em falha_encaminhamento mesmo com HTTP 201 OK).
  dados?: { id?: number; urgente?: boolean };
}

export interface DadosEncaminhamento {
  idPessoa: number;
  idOrgao: number;
  idLocalAtendimento?: number;
  urgente: boolean;
}

// POST /integra/encaminhamento/encaminhar — executa o encaminhamento de
// verdade (cria registro real no Verde). idAssunto NÃO é enviado — confirmado
// com o time do Verde que não é necessário pro fluxo de violência doméstica
// (2026-09-04). preferenciaAtendimento sempre "Remoto" (é chatbot).
export async function criarEncaminhamentoViolenciaDomestica(dados: DadosEncaminhamento): Promise<ResultadoEncaminhamento> {
  if (!VERDE_JWT_TOKEN) {
    logger.warn(contextoAtual(), "[verde] VERDE_JWT_TOKEN ausente — modo mock (dev local)");
    // MOCK_ENCAMINHAMENTO_FALHA=true simula falha — só lido em teste/dev.
    if (process.env.MOCK_ENCAMINHAMENTO_FALHA === "true") return { sucesso: false, erro: "falha simulada (mock)" };
    return { sucesso: true, id: 999999 };
  }
  const inicio = Date.now();
  try {
    const body = {
      idPessoa: dados.idPessoa,
      idOrgao: dados.idOrgao,
      ...(dados.idLocalAtendimento !== undefined ? { idLocalAtendimento: dados.idLocalAtendimento } : {}),
      urgencia: dados.urgente,
      preferenciaAtendimento: "Remoto",
      fluxoEncaminhamento: "VIOLENCIA_DOMESTICA",
      ...(dados.urgente ? { motivoUrgencia: "Violência doméstica com Boletim de Ocorrência registrado" } : {}),
    };
    const res = await fetch(`${VERDE_API_URL}/encaminhamento/encaminhar`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${VERDE_JWT_TOKEN}`,
        "x-client-id": VERDE_CLIENT_ID,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const corpo = (await res.json().catch(() => ({}))) as EncaminhamentoResponseVerde;
    if (!res.ok) {
      logger.error({ ...contextoAtual(), status: res.status, corpo, evento: "verde_chamada", chamada: "encaminhamento", resultado: "nao_ok", duracaoMs: Date.now() - inicio }, "[verde] encaminhamento: HTTP não-ok");
      return { sucesso: false, erro: corpo.mensagem ?? `HTTP ${res.status}` };
    }
    logger.info({ ...contextoAtual(), corpo, evento: "verde_chamada", chamada: "encaminhamento", resultado: "sucesso", duracaoMs: Date.now() - inicio }, "[verde] encaminhamento: chamada concluída");
    return { sucesso: true, id: corpo.dados?.id };
  } catch (err) {
    logger.error({ ...contextoAtual(), err, evento: "verde_chamada", chamada: "encaminhamento", resultado: "erro", duracaoMs: Date.now() - inicio }, "[verde] encaminhamento: falha na chamada");
    return { sucesso: false, erro: "falha na chamada ao Verde" };
  }
}
