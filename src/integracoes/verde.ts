import type { DadosApenado, DadosPessoa, DadosProcesso, OrgaoAtendimento, OrgaosViolenciaDomestica } from "../shared/types.js";
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
  };
}

export async function consultarApenadoPorRg(rg: string): Promise<DadosApenado> {
  if (!VERDE_JWT_TOKEN) {
    logger.warn(contextoAtual(), "[verde] VERDE_JWT_TOKEN ausente — modo mock (dev local)");
    // RG "000000000" simula "não encontrado" no mock (pra testar o fluxo de
    // retry sem depender do Verde real) — qualquer outro RG "acha" a pessoa
    // de teste.
    if (rg === "000000000") return { encontrado: false };
    return { encontrado: true, idSeap: 999999, idPessoa: 999999, nome: "Pessoa de Teste (mock)", situacao: "ATIVO" };
  }
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
      logger.warn({ ...contextoAtual(), status: res.status }, "[verde] apenado: HTTP não-ok");
      return { encontrado: false };
    }
    const corpo = (await res.json()) as ApenadoResponseVerde;
    // RG não encontrado: Verde devolve "dados": {} (objeto VAZIO, não null/
    // ausente — confirmado ao vivo 2026-08-28) — checar só `!corpo.dados`
    // não pega isso, `{}` é truthy. Checa um campo que só existe se achou
    // de verdade.
    if (!corpo.dados || corpo.dados.idPessoa === undefined) return { encontrado: false };
    return {
      encontrado: true,
      idSeap: corpo.dados.idSeap,
      idPessoa: corpo.dados.idPessoa,
      nome: corpo.dados.nome,
      situacao: corpo.dados.situacao,
    };
  } catch (err) {
    logger.error({ ...contextoAtual(), err }, "[verde] apenado: falha na chamada");
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
    return { encontrado: true, id: 999999, origem: "e-Proc (mock)", nomeAssunto: "Processo de Teste" };
  }
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
      logger.warn({ ...contextoAtual(), status: res.status }, "[verde] processo: HTTP não-ok");
      return { encontrado: false };
    }
    const corpo = (await res.json()) as ProcessoResponseVerde;
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
    logger.error({ ...contextoAtual(), err }, "[verde] processo: falha na chamada");
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
    enderecoDetalhado?: {
      logradouro?: string;
      numero?: string;
      complemento?: string;
      bairro?: string;
      municipio?: string;
      uf?: string;
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
      enderecoDetalhado: { bairro: "Centro", municipio: "Rio de Janeiro", uf: "RJ", cep: "20000-000" },
    };
  }
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
      logger.warn({ ...contextoAtual(), status: res.status }, "[verde] pessoa: HTTP não-ok");
      return { encontrado: false };
    }
    const corpo = (await res.json()) as PessoaResponseVerde;
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
    logger.error({ ...contextoAtual(), err }, "[verde] pessoa: falha na chamada");
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
      logger.warn({ ...contextoAtual(), status: res.status }, "[verde] orgao-violencia-domestica: HTTP não-ok");
      return { encontrado: false, orgaos: [] };
    }
    const corpo = (await res.json()) as OrgaoResponseVerde;
    // "CONTACTAR_CRC" — código específico do Verde pra "não achei nada,
    // liga 129" (só acontece com RO:true). mensagem já vem pronta deles,
    // pt-BR, direto pro usuário.
    if (corpo.codigo === "CONTACTAR_CRC") {
      return { encontrado: false, orgaos: [], contactarCrc: true, mensagemCrc: corpo.mensagem };
    }
    const orgaos: OrgaoAtendimento[] = (corpo.dados ?? []).map((o) => ({ id: o.id ?? 0, nome: o.nome ?? "", enderecos: o.enderecos }));
    return { encontrado: orgaos.length > 0, orgaos };
  } catch (err) {
    logger.error({ ...contextoAtual(), err }, "[verde] orgao-violencia-domestica: falha na chamada");
    return { encontrado: false, orgaos: [] };
  }
}
